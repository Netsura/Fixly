import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import Redis from 'ioredis';
import { env } from '@fixly/config';

type LimitConfig = { limit: number; windowSeconds: number };

const ROUTE_LIMITS: Array<{ match: (method: string, path: string) => boolean; config: LimitConfig }> = [
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/login'), config: { limit: 10, windowSeconds: 300 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/register'), config: { limit: 5, windowSeconds: 600 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/forgot-password'), config: { limit: 5, windowSeconds: 600 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/reset-password'), config: { limit: 5, windowSeconds: 600 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/refresh'), config: { limit: 30, windowSeconds: 60 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/auth/verify-email'), config: { limit: 10, windowSeconds: 600 } },
  { match: (m, p) => m === 'POST' && p.endsWith('/requests'), config: { limit: 20, windowSeconds: 600 } },
  { match: (m, p) => m === 'POST' && p.includes('/payments/create'), config: { limit: 10, windowSeconds: 300 } },
];

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.originalUrl.split('?')[0] ?? request.url;
    const method = request.method.toUpperCase();
    const matched = ROUTE_LIMITS.find((entry) => entry.match(method, path));
    const config = matched?.config ?? { limit: 180, windowSeconds: 60 };
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const key = `rl:${method}:${path}:${ip}`;
    const count = await this.hit(key, config.windowSeconds);
    if (count > config.limit) {
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async hit(key: string, windowSeconds: number) {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      return count;
    } catch {
      const now = Date.now();
      const current = this.memory.get(key);
      if (!current || current.resetAt <= now) {
        this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
        return 1;
      }
      current.count += 1;
      return current.count;
    }
  }
}
