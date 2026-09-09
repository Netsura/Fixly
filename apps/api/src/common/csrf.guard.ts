import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../auth/auth.constants';
import { AuthTokenPayload } from '../auth/auth.types';
import { CSRF_COOKIE, CSRF_HEADER, timingSafeEqualString, verifyCsrfToken } from './csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Endpoints that establish a session or are authenticated by something other
 * than the session cookie. They cannot require a CSRF token because the caller
 * does not have one yet; Origin checking plus rate limiting covers them.
 */
const EXEMPT_PATHS = [
  '/auth/register',
  '/auth/login',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/payments/webhook',
];

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const path = request.path || request.originalUrl || '';
    if (EXEMPT_PATHS.some((exempt) => path.endsWith(exempt))) return true;

    const cookies = (request.cookies ?? {}) as Record<string, string | undefined>;
    const sessionToken = cookies[ACCESS_TOKEN_COOKIE] ?? cookies[REFRESH_TOKEN_COOKIE];

    // Bearer-token and unauthenticated callers carry no ambient credential, so
    // there is nothing for a cross-site request to ride on.
    if (!sessionToken) return true;

    const sessionId = this.readSessionId(sessionToken);
    if (!sessionId) return true;

    const cookieToken = cookies[CSRF_COOKIE];
    const headerToken = this.readHeader(request);
    if (!cookieToken || !headerToken || !timingSafeEqualString(cookieToken, headerToken)) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    if (!verifyCsrfToken(cookieToken, sessionId)) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    return true;
  }

  /**
   * The session id only identifies which session the CSRF token must be bound
   * to; the JWT's own authenticity is enforced later by JwtAuthGuard, so an
   * expired token (the refresh case) is still usable here.
   */
  private readSessionId(token: string) {
    try {
      const payload = this.jwtService.decode<AuthTokenPayload | null>(token);
      return payload?.sessionId;
    } catch {
      return undefined;
    }
  }

  private readHeader(request: Request) {
    const value = request.headers[CSRF_HEADER];
    return Array.isArray(value) ? value[0] : value;
  }
}
