import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthTokenType, Prisma, prisma, UserRole } from '@fixly/database';
import { env } from '@fixly/config';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokenPayload, AuthenticatedUser } from './auth.types';
import { JobsService } from '../jobs/jobs.service';
import { createCsrfToken, timingSafeEqualString } from '../common/csrf';

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly jobsService: JobsService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: input.role === UserRole.PROVIDER ? UserRole.PROVIDER : UserRole.CUSTOMER,
        profile: { create: { displayName: input.displayName.trim() } },
      },
      select: { id: true, email: true, role: true, profile: true },
    });

    const verification = await this.createAuthToken(user.id, AuthTokenType.EMAIL_VERIFICATION, 24);
    await this.jobsService.enqueueTransactionalEmail({
      to: user.email,
      subject: 'Verify your Fixly email',
      text: `Verify your email: ${env.WEB_URL}/verify-email?token=${verification.rawToken}`,
      idempotencyKey: `email-verification:${verification.tokenId}`,
    });

    return this.issueSession({ id: user.id, email: user.email, role: user.role });
  }

  async login(input: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true, email: true, role: true, passwordHash: true, suspendedAt: true },
    });

    if (!user || user.suspendedAt || !(await this.verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.passwordHash.startsWith('$argon2')) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.hashPassword(input.password) },
      });
    }

    return this.issueSession({ id: user.id, email: user.email, role: user.role });
  }

  async refresh(refreshToken: string) {
    let payload: AuthTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(refreshToken, {
        secret: env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await prisma.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: { select: { id: true, email: true, role: true, suspendedAt: true } } },
    });

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.suspendedAt ||
      !timingSafeEqualString(session.refreshTokenHash, this.hashToken(refreshToken))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Presenting an already-rotated token means the token leaked (or the whole
    // family was replayed). Burn the family rather than issuing a new session.
    if (session.revokedAt) {
      await prisma.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Only the request that wins this conditional update may rotate; a
    // concurrent refresh with the same token sees count 0 and is rejected.
    const claimed = await prisma.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueSession(session.user, session.familyId);
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) {
      let payload: AuthTokenPayload;
      try {
        payload = await this.jwtService.verifyAsync<AuthTokenPayload>(refreshToken, {
          secret: env.JWT_REFRESH_SECRET,
        });
      } catch {
        return;
      }
      await prisma.authSession.updateMany({
        where: { id: payload.sessionId, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async verifyEmail(token: string) {
    await prisma.$transaction(async (transaction) => {
      const authToken = await this.consumeAuthToken(transaction, token, AuthTokenType.EMAIL_VERIFICATION);
      await transaction.user.update({
        where: { id: authToken.userId },
        data: { emailVerifiedAt: new Date() },
      });
    });
    return { success: true };
  }

  async requestPasswordReset(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) {
      return { success: true };
    }

    await prisma.authToken.updateMany({
      where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET, usedAt: null },
      data: { usedAt: new Date() },
    });
    const reset = await this.createAuthToken(user.id, AuthTokenType.PASSWORD_RESET, 1);
    await this.jobsService.enqueueTransactionalEmail({
      to: user.email,
      subject: 'Reset your Fixly password',
      text: `Reset your password: ${env.WEB_URL}/reset-password?token=${reset.rawToken}`,
      idempotencyKey: `password-reset:${reset.tokenId}`,
    });
    return { success: true };
  }

  async resetPassword(token: string, password: string) {
    // Cheap existence probe first so a garbage token cannot force an Argon2 hash.
    const tokenHash = this.hashToken(token);
    const exists = await prisma.authToken.findFirst({
      where: { tokenHash, type: AuthTokenType.PASSWORD_RESET, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!exists) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const passwordHash = await this.hashPassword(password);
    await prisma.$transaction(async (transaction) => {
      const authToken = await this.consumeAuthToken(transaction, token, AuthTokenType.PASSWORD_RESET);
      await transaction.user.update({ where: { id: authToken.userId }, data: { passwordHash } });
      await transaction.authSession.updateMany({
        where: { userId: authToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.authToken.updateMany({
        where: { userId: authToken.userId, type: AuthTokenType.PASSWORD_RESET, usedAt: null },
        data: { usedAt: new Date() },
      });
    });
    return { success: true };
  }

  private async hashPassword(password: string): Promise<string> {
    return String(await argon2.hash(password, ARGON_OPTIONS));
  }

  private async verifyPassword(hash: string, password: string) {
    try {
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, password);
      }
      const bcrypt = await import('bcryptjs');
      const valid = await bcrypt.compare(password, hash);
      return valid;
    } catch {
      return false;
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createAuthToken(userId: string, type: AuthTokenType, ttlHours: number) {
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);
    const created = await prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
      },
      select: { id: true },
    });
    return { rawToken, tokenId: created.id };
  }

  /**
   * Marks the token used and returns it only if this call was the one that
   * flipped `usedAt`, so concurrent redemptions of the same link cannot both
   * succeed.
   */
  private async consumeAuthToken(
    transaction: Prisma.TransactionClient,
    rawToken: string,
    type: AuthTokenType,
  ) {
    const tokenHash = this.hashToken(rawToken);
    const candidate = await transaction.authToken.findFirst({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true },
    });
    if (!candidate) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const claimed = await transaction.authToken.updateMany({
      where: { id: candidate.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return candidate;
  }

  private async issueSession(user: AuthenticatedUser, familyId: string = randomUUID()) {
    const sessionId = randomUUID();
    const payload: AuthTokenPayload = { sub: user.id, role: user.role, sessionId };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: env.JWT_REFRESH_SECRET,
      expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_TTL_DAYS);

    await prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId,
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, user, csrfToken: createCsrfToken(sessionId) };
  }
}
