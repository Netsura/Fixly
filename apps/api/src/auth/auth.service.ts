import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma, UserRole } from '@fixly/database';
import { env } from '@fixly/config';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokenPayload, AuthenticatedUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (transaction) => {
      return transaction.user.create({
        data: {
          email,
          passwordHash,
          role: input.role === UserRole.PROVIDER ? UserRole.PROVIDER : UserRole.CUSTOMER,
          profile: { create: { displayName: input.displayName.trim() } },
        },
        select: { id: true, email: true, role: true, profile: true },
      });
    });

    return this.issueSession({ id: user.id, email: user.email, role: user.role });
  }

  async login(input: LoginDto) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true, email: true, role: true, passwordHash: true, suspendedAt: true },
    });

    if (!user || user.suspendedAt || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
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
      !(await bcrypt.compare(refreshToken, session.refreshTokenHash))
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
        refreshTokenHash: await bcrypt.hash(refreshToken, 12),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, user };
  }
}
