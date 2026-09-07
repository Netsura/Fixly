import { Injectable } from '@nestjs/common';
import { prisma } from '@fixly/database';
import { env } from '@fixly/config';
import Redis from 'ioredis';
import { getHealthStatus } from './health-status';

@Injectable()
export class HealthService {
  private readonly redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  async check() {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const status = getHealthStatus(database, redis);

    return {
      status,
      service: 'api',
      timestamp: new Date().toISOString(),
      dependencies: { database, redis },
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      await this.redis.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
