import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuthTokenType, prisma, UserRole } from '@fixly/database';
import { env } from '@fixly/config';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokenPayload, AuthenticatedUser } from './auth.types';
import { JobsService } from '../jobs/jobs.service';

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
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.suspendedAt ||
      session.refreshTokenHash !== this.hashToken(refreshToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueSession(session.user);
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
    const authToken = await this.consumeAuthToken(token, AuthTokenType.EMAIL_VERIFICATION);
    await prisma.user.update({
      where: { id: authToken.userId },
      data: { emailVerifiedAt: new Date() },
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
    });
    return { success: true };
  }

  async resetPassword(token: string, password: string) {
    const authToken = await this.consumeAuthToken(token, AuthTokenType.PASSWORD_RESET);
    const passwordHash = await this.hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: authToken.userId }, data: { passwordHash } }),
      prisma.authSession.updateMany({
        where: { userId: authToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
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
    await prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
      },
    });
    return { rawToken };
  }

  private async consumeAuthToken(rawToken: string, type: AuthTokenType) {
    const tokenHash = this.hashToken(rawToken);
    const authToken = await prisma.authToken.findFirst({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!authToken) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    await prisma.authToken.update({ where: { id: authToken.id }, data: { usedAt: new Date() } });
    return authToken;
  }

  private async issueSession(user: AuthenticatedUser) {
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
        refreshTokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, user };
  }
}
