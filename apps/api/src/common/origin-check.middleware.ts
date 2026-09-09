import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from '@fixly/config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    // Stripe webhooks have no browser Origin; they are authenticated by signature.
    if (request.path.endsWith('/payments/webhook') || request.originalUrl.includes('/payments/webhook')) {
      next();
      return;
    }

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const allowed = new URL(env.WEB_URL).origin;

    if (origin) {
      if (origin !== allowed) {
        throw new ForbiddenException('Invalid request origin');
      }
      next();
      return;
    }

    if (referer) {
      try {
        if (new URL(referer).origin !== allowed) {
          throw new ForbiddenException('Invalid request origin');
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        throw new ForbiddenException('Invalid request origin');
      }
      next();
      return;
    }

    // Allow non-browser clients (mobile/server) that send neither Origin nor Referer.
    next();
  }
}
