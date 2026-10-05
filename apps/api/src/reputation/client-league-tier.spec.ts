import {
  CLIENT_LEAGUE_ORDER,
  clientLeagueProgress,
  clientRatingAverage,
  computeClientLeagueTier,
  DEFAULT_CLIENT_LEAGUE_THRESHOLDS,
  isValidClientThresholds,
} from './client-league-tier';

describe('clientRatingAverage', () => {
  it('is null-safe: zero ratings gives 0, never divides by zero', () => {
    expect(clientRatingAverage(0, 0)).toBe(0);
  });
  it('averages sum over count', () => {
    expect(clientRatingAverage(18, 4)).toBe(4.5);
  });
});

describe('computeClientLeagueTier', () => {
  it('every client starts NEWCOMER with no bookings', () => {
    expect(computeClientLeagueTier(0, 0, 0, 0)).toBe('NEWCOMER');
  });

  it('one completed booking reaches REGULAR, the first real rung', () => {
    expect(computeClientLeagueTier(1, 0, 0, 0)).toBe('REGULAR');
  });

  it('climbs the ladder exactly at each threshold', () => {
    expect(computeClientLeagueTier(2, 3, 1, 0)).toBe('PREFERRED'); // avg 3.0
    expect(computeClientLeagueTier(3, 7, 2, 0)).toBe('TRUSTED'); // avg 3.5
    expect(computeClientLeagueTier(6, 12, 3, 0)).toBe('LOYAL'); // avg 4.0
    expect(computeClientLeagueTier(12, 21, 5, 0)).toBe('ELITE'); // avg 4.2
    expect(computeClientLeagueTier(25, 36, 8, 0)).toBe('CHAMPION'); // avg 4.5
    expect(computeClientLeagueTier(50, 56, 12, 0)).toBe('PATRON'); // avg 4.67
    expect(computeClientLeagueTier(100, 96, 20, 0)).toBe('LEGEND'); // avg 4.8
  });

  it('one booking short of a tier keeps the previous tier', () => {
    // Same rating profile as the CHAMPION case above, but 24 bookings instead of 25.
    expect(computeClientLeagueTier(24, 36, 8, 0)).toBe('ELITE');
  });

  it('a high cancellation rate caps the league well below what bookings/rating alone would reach', () => {
    // 6 bookings, avg 4.0 (would otherwise reach LOYAL), but 2 cancellations -> a 33% rate fails
    // both LOYAL's 20% ceiling and TRUSTED's 25% ceiling; only PREFERRED's 35% ceiling clears it.
    expect(computeClientLeagueTier(6, 24, 6, 2)).toBe('PREFERRED');
  });

  it('cancellation rate is bad-outcomes-per-completed-booking, not diluted by volume', () => {
    expect(computeClientLeagueTier(1, 5, 1, 1)).toBe('REGULAR'); // 100% rate, still clears REGULAR's 100% ceiling
  });

  it('there is no dispute-rate factor for clients, unlike the Ranger ladder', () => {
    DEFAULT_CLIENT_LEAGUE_THRESHOLDS.forEach((t) => {
      expect(t).not.toHaveProperty('maxDisputeRate');
    });
  });

  it('DEFAULT_CLIENT_LEAGUE_THRESHOLDS ends in an all-zero NEWCOMER floor', () => {
    const last = DEFAULT_CLIENT_LEAGUE_THRESHOLDS[DEFAULT_CLIENT_LEAGUE_THRESHOLDS.length - 1];
    expect(last).toMatchObject({ tier: 'NEWCOMER', minBookings: 0, minRatingCount: 0, minRatingAvg: 0 });
  });

  it('thresholds are strictly descending in requirements from LEGEND down to NEWCOMER', () => {
    for (let i = 1; i < DEFAULT_CLIENT_LEAGUE_THRESHOLDS.length; i++) {
      const prev = DEFAULT_CLIENT_LEAGUE_THRESHOLDS[i - 1]!;
      const cur = DEFAULT_CLIENT_LEAGUE_THRESHOLDS[i]!;
      expect(cur.minBookings).toBeLessThanOrEqual(prev.minBookings);
      expect(cur.minRatingCount).toBeLessThanOrEqual(prev.minRatingCount);
      expect(cur.minRatingAvg).toBeLessThanOrEqual(prev.minRatingAvg);
      expect(cur.maxCancellationRate).toBeGreaterThanOrEqual(prev.maxCancellationRate);
    }
  });

  it('every threshold tier appears exactly once, in CLIENT_LEAGUE_ORDER, descending', () => {
    const tiers = DEFAULT_CLIENT_LEAGUE_THRESHOLDS.map((t) => t.tier);
    expect(new Set(tiers).size).toBe(tiers.length);
    expect(tiers).toEqual([...CLIENT_LEAGUE_ORDER].reverse());
  });
});

describe('clientLeagueProgress', () => {
  it('a brand-new client is at NEWCOMER, 0% toward REGULAR (needs 1 booking)', () => {
    expect(clientLeagueProgress(0, 0, 0, 0)).toEqual({
      current: 'NEWCOMER',
      next: 'REGULAR',
      progress: 0,
    });
  });

  it('progress is bounded by the slowest-moving factor', () => {
    // At LOYAL heading to ELITE (needs 12 bookings, 5 ratings, avg 4.2): 6/12 = 50% bookings,
    // 3/5 = 60% ratings, avg already clears 4.2. Bound is min(.5, .6, 1) = .5.
    const p = clientLeagueProgress(6, 24, 3, 0); // avg 8.0 clamped to 1 at the factor level
    expect(p).toMatchObject({ current: 'LOYAL', next: 'ELITE' });
    expect(p.progress).toBeCloseTo(0.5, 2);
  });

  it('LEGEND has no next league: progress is 1 and next is null', () => {
    expect(clientLeagueProgress(100, 96, 20, 0)).toEqual({
      current: 'LEGEND',
      next: null,
      progress: 1,
    });
  });
});

describe('isValidClientThresholds', () => {
  it('accepts a well-formed array', () => {
    expect(isValidClientThresholds(DEFAULT_CLIENT_LEAGUE_THRESHOLDS)).toBe(true);
  });
  it('rejects non-arrays, empty arrays, and malformed entries', () => {
    expect(isValidClientThresholds(null)).toBe(false);
    expect(isValidClientThresholds([])).toBe(false);
    expect(isValidClientThresholds([{ tier: 'PATRON' }])).toBe(false);
  });
});
