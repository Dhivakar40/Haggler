import { Global, Injectable, Module } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter in Redis.
 *
 * Trace (limit 5 per 3600 s, key "otp:phone:+9198..."):
 *   1st hit: INCR -> 1, we set EXPIRE 3600          -> allowed, count 1
 *   5th hit: INCR -> 5                              -> allowed, count 5
 *   6th hit: INCR -> 6 > 5                          -> denied, retryAfter = remaining TTL
 * Throws when Redis is unavailable so callers can fall back to a database count (D-022).
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    if (!(await this.redis.ping())) throw new Error('redis unavailable');
    const results = await this.redis.client.multi().incr(key).ttl(key).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    let ttl = Number(results?.[1]?.[1] ?? -1);
    if (count === 1 || ttl < 0) {
      await this.redis.client.expire(key, windowSec);
      ttl = windowSec;
    }
    return { allowed: count <= limit, count, retryAfterSec: count <= limit ? 0 : ttl };
  }
}

@Global()
@Module({ providers: [RateLimitService], exports: [RateLimitService] })
export class RateLimitModule {}
