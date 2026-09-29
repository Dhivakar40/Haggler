import {
  computeBadgeTier,
  DEFAULT_BADGE_THRESHOLDS,
  isValidThresholds,
  ratingAverage,
} from './badge-tier';

describe('ratingAverage', () => {
  it('is null-safe: zero ratings gives 0, never divides by zero', () => {
    expect(ratingAverage(0, 0)).toBe(0);
  });
  it('averages sum over count', () => {
    expect(ratingAverage(23, 5)).toBe(4.6);
  });
});

describe('computeBadgeTier', () => {
  it('every Ranger starts BRONZE with no jobs and no ratings', () => {
    expect(computeBadgeTier(0, 0, 0)).toBe('BRONZE');
  });

  it('jobs alone are not enough: a rating floor is required for every tier above BRONZE', () => {
    // 200 jobs but only 2 ratings (below SILVER's minRatingCount of 3): still BRONZE.
    expect(computeBadgeTier(200, 10, 2)).toBe('BRONZE');
  });

  it('a low average blocks promotion even with plenty of jobs and ratings', () => {
    // 200 jobs, 50 ratings, but averaging 3.0 (below every non-BRONZE floor): still BRONZE.
    expect(computeBadgeTier(200, 150, 50)).toBe('BRONZE');
  });

  it('climbs the ladder exactly at each threshold', () => {
    expect(computeBadgeTier(5, 12, 3)).toBe('SILVER'); // avg 4.0, exactly at the floor
    expect(computeBadgeTier(20, 88, 20)).toBe('GOLD'); // avg 4.4
    expect(computeBadgeTier(50, 46, 10)).toBe('PLATINUM'); // avg 4.6
    expect(computeBadgeTier(100, 96, 20)).toBe('DIAMOND'); // avg 4.8
  });

  it('one job short of a tier keeps the previous tier', () => {
    expect(computeBadgeTier(19, 88, 20)).toBe('SILVER'); // would be GOLD at 20 jobs
    expect(computeBadgeTier(20, 87, 20)).toBe('SILVER'); // 20 jobs but avg 4.35, just under GOLD's 4.4
  });

  it('a single 5-star review cannot vault a new Ranger to DIAMOND: even 100+ jobs falls to BRONZE without enough ratings', () => {
    expect(computeBadgeTier(100, 5, 1)).toBe('BRONZE'); // avg 5.0, jobsCompleted alone qualifies for every tier, but 1 rating is below even SILVER's floor of 3
  });

  it('rating count gates the top tiers even when jobsCompleted alone would qualify', () => {
    expect(computeBadgeTier(150, 15, 3)).toBe('SILVER'); // avg 5.0, jobs qualify for DIAMOND, but only 3 ratings caps it at SILVER (needs 5/10/20 for GOLD/PLATINUM/DIAMOND)
  });

  it('DEFAULT_BADGE_THRESHOLDS ends in an all-zero BRONZE floor, so every Ranger has a tier', () => {
    const last = DEFAULT_BADGE_THRESHOLDS[DEFAULT_BADGE_THRESHOLDS.length - 1];
    expect(last).toEqual({ tier: 'BRONZE', minJobs: 0, minRatingCount: 0, minRatingAvg: 0 });
  });

  it('thresholds are strictly descending in requirements from DIAMOND down to BRONZE', () => {
    for (let i = 1; i < DEFAULT_BADGE_THRESHOLDS.length; i++) {
      const prev = DEFAULT_BADGE_THRESHOLDS[i - 1]!;
      const cur = DEFAULT_BADGE_THRESHOLDS[i]!;
      expect(cur.minJobs).toBeLessThanOrEqual(prev.minJobs);
      expect(cur.minRatingCount).toBeLessThanOrEqual(prev.minRatingCount);
      expect(cur.minRatingAvg).toBeLessThanOrEqual(prev.minRatingAvg);
    }
  });

  it('a custom, smaller threshold list is honoured (ops override via system_config)', () => {
    const tiny = [
      { tier: 'GOLD' as const, minJobs: 2, minRatingCount: 1, minRatingAvg: 3 },
      { tier: 'BRONZE' as const, minJobs: 0, minRatingCount: 0, minRatingAvg: 0 },
    ];
    expect(computeBadgeTier(2, 3, 1, tiny)).toBe('GOLD');
    expect(computeBadgeTier(1, 3, 1, tiny)).toBe('BRONZE');
  });
});

describe('isValidThresholds', () => {
  it('accepts a well-formed array', () => {
    expect(isValidThresholds(DEFAULT_BADGE_THRESHOLDS)).toBe(true);
  });
  it('rejects non-arrays, empty arrays, and malformed entries', () => {
    expect(isValidThresholds(null)).toBe(false);
    expect(isValidThresholds(undefined)).toBe(false);
    expect(isValidThresholds('BRONZE')).toBe(false);
    expect(isValidThresholds([])).toBe(false);
    expect(isValidThresholds([{ tier: 'GOLD' }])).toBe(false);
    expect(
      isValidThresholds([{ tier: 'GOLD', minJobs: '5', minRatingCount: 1, minRatingAvg: 4 }]),
    ).toBe(false);
  });
});
