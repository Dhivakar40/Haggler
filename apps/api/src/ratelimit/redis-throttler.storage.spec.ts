import { RedisThrottlerStorage } from './redis-throttler.storage';

/** A fake Redis that behaves like INCR/PTTL/PEXPIRE, so the blocking rule is unit-tested. */
function fakeRedis(up = true) {
  const counts = new Map<string, number>();
  const client = {
    multi: () => {
      let key = '';
      const chain = {
        incr: (k: string) => {
          key = k;
          counts.set(k, (counts.get(k) ?? 0) + 1);
          return chain;
        },
        pttl: () => chain,
        exec: async () => [
          [null, counts.get(key)],
          [null, 30_000],
        ],
      };
      return chain;
    },
    pexpire: jest.fn(async () => 1),
  };
  return { ping: async () => up, client } as never;
}

describe('RedisThrottlerStorage', () => {
  it('allows up to the limit, then reports isBlocked with the time left', async () => {
    const s = new RedisThrottlerStorage(fakeRedis());
    for (let i = 1; i <= 3; i++) {
      const r = await s.increment('ip:1', 60_000, 3);
      expect(r).toMatchObject({ totalHits: i, isBlocked: false, timeToBlockExpire: 0 });
    }
    const fourth = await s.increment('ip:1', 60_000, 3);
    expect(fourth).toMatchObject({
      totalHits: 4,
      isBlocked: true,
      timeToExpire: 30,
      timeToBlockExpire: 30,
    });
  });

  it('keeps separate counters per key', async () => {
    const s = new RedisThrottlerStorage(fakeRedis());
    await s.increment('a', 60_000, 1);
    expect((await s.increment('b', 60_000, 1)).isBlocked).toBe(false);
    expect((await s.increment('a', 60_000, 1)).isBlocked).toBe(true);
  });

  it('when Redis is down it still blocks (in-memory), instead of failing open', async () => {
    const s = new RedisThrottlerStorage(fakeRedis(false));
    expect((await s.increment('ip:2', 60_000, 2)).isBlocked).toBe(false);
    expect((await s.increment('ip:2', 60_000, 2)).isBlocked).toBe(false);
    expect((await s.increment('ip:2', 60_000, 2)).isBlocked).toBe(true);
  });

  it('the in-memory window resets after it expires', async () => {
    jest.useFakeTimers();
    const s = new RedisThrottlerStorage(fakeRedis(false));
    await s.increment('ip:3', 1000, 1);
    expect((await s.increment('ip:3', 1000, 1)).isBlocked).toBe(true);
    jest.advanceTimersByTime(1500);
    expect((await s.increment('ip:3', 1000, 1)).isBlocked).toBe(false);
    jest.useRealTimers();
  });
});
