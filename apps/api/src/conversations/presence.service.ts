import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '@fixly/config';

@Injectable()
export class PresenceService {
  private readonly redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  private readonly key = 'fixly:presence';

  connect(userId: string) {
    return this.redis.hincrby(this.key, userId, 1);
  }

  async disconnect(userId: string) {
    const count = await this.redis.hincrby(this.key, userId, -1);
    if (count <= 0) await this.redis.hdel(this.key, userId);
    return Math.max(count, 0);
  }
}
