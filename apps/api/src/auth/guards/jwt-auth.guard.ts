import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { prisma, UserRole } from '@fixly/database';
import { Request } from 'express';
import { env } from '@fixly/config';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AuthTokenPayload, AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token, {
        secret: env.JWT_ACCESS_SECRET,
      });
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, suspendedAt: true },
      });

      if (!user || user.suspendedAt || user.role !== payload.role) {
        throw new UnauthorizedException('Invalid authentication');
      }

      request.user = {
        id: user.id,
        email: user.email,
        role: user.role as UserRole,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid authentication');
    }
  }

  private extractToken(request: Request): string | undefined {
    const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
    if (cookieToken) {
      return cookieToken;
    }

    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }
}
