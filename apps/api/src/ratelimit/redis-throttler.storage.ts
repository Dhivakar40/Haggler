import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { RedisService } from '../redis/redis.service';

/**
 * Global per-IP throttler storage. Redis makes the limit hold across API instances (D-022).
 * If Redis is down we fall back to a per-process memory window instead of failing open.
 *
 * The guard trusts the storage to say whether the caller is blocked (`isBlocked`), so this class
 * must compare hits against `limit` itself. (An earlier version forgot to, and never blocked.)
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly memory = new Map<string, { hits: number; expiresAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttlMs: number, limit: number): Promise<ThrottlerStorageRecord> {
    try {
      if (!(await this.redis.ping())) throw new Error('redis unavailable');
      const redisKey = `throttle:${key}`;
      const res = await this.redis.client.multi().incr(redisKey).pttl(redisKey).exec();
      const hits = Number(res?.[0]?.[1] ?? 1);
      let pttl = Number(res?.[1]?.[1] ?? -1);
      if (hits === 1 || pttl < 0) {
        await this.redis.client.pexpire(redisKey, ttlMs);
        pttl = ttlMs;
      }
      return this.record(hits, pttl, limit);
    } catch {
      return this.incrementInMemory(key, ttlMs, limit);
    }
  }

  private incrementInMemory(key: string, ttlMs: number, limit: number): ThrottlerStorageRecord {
    const now = Date.now();
    const entry = this.memory.get(key);
    const live = entry && entry.expiresAt > now ? entry : { hits: 0, expiresAt: now + ttlMs };
    live.hits += 1;
    this.memory.set(key, live);
    return this.record(live.hits, live.expiresAt - now, limit);
  }

  /**
   * Trace (limit 20, window 60 s): hits 1..20 -> allowed; hit 21 -> isBlocked, retry in the
   * remaining window (e.g. 41 s).
   */
  private record(totalHits: number, pttlMs: number, limit: number): ThrottlerStorageRecord {
    const timeToExpire = Math.ceil(pttlMs / 1000);
    const isBlocked = totalHits > limit;
    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? timeToExpire : 0 };
  }
}
