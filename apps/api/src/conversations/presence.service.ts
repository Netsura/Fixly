import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '@fixly/config';

@Injectable()
export class PresenceService {
  private readonly redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  private readonly key = 'fixly:presence';
  private readonly ttlSeconds = 60 * 10;

  async connect(userId: string) {
    const count = await this.redis.hincrby(this.key, userId, 1);
    await this.redis.expire(this.key, this.ttlSeconds);
    await this.redis.setex(this.userKey(userId), this.ttlSeconds, String(Math.max(count, 1)));
    return count;
  }

  async disconnect(userId: string) {
    const count = await this.redis.hincrby(this.key, userId, -1);
    if (count <= 0) {
      await this.redis.hdel(this.key, userId);
      await this.redis.del(this.userKey(userId));
      return 0;
    }
    await this.redis.setex(this.userKey(userId), this.ttlSeconds, String(count));
    await this.redis.expire(this.key, this.ttlSeconds);
    return count;
  }

  async isOnline(userId: string) {
    const value = await this.redis.get(this.userKey(userId));
    if (value) return Number(value) > 0;
    const count = Number((await this.redis.hget(this.key, userId)) ?? 0);
    return count > 0;
  }

  async areOnline(userIds: string[]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    const result: Record<string, boolean> = {};
    if (!unique.length) return result;
    const values = await this.redis.mget(...unique.map((id) => this.userKey(id)));
    unique.forEach((id, index) => {
      result[id] = Number(values[index] ?? 0) > 0;
    });
    return result;
  }

  private userKey(userId: string) {
    return `${this.key}:user:${userId}`;
  }
}
