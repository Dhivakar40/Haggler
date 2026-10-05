import {
  computeLeagueTier,
  DEFAULT_LEAGUE_THRESHOLDS,
  isValidThresholds,
  LEAGUE_ORDER,
  leagueProgress,
  ratingAverage,
} from './league-tier';

describe('ratingAverage', () => {
  it('is null-safe: zero ratings gives 0, never divides by zero', () => {
    expect(ratingAverage(0, 0)).toBe(0);
  });
  it('averages sum over count', () => {
    expect(ratingAverage(23, 5)).toBe(4.6);
  });
});

describe('computeLeagueTier', () => {
  it('every Ranger starts WOOD with no jobs and no ratings', () => {
    expect(computeLeagueTier(0, 0, 0, 0, 0)).toBe('WOOD');
  });

  it('one completed job reaches STONE, the first real rung', () => {
    expect(computeLeagueTier(1, 0, 0, 0, 0)).toBe('STONE');
  });

  it('jobs alone are not enough: a rating-count floor is required above COPPER', () => {
    // 200 jobs, avg 5.0, but only 2 ratings (below BRONZE's floor of 3): capped at COPPER
    // (COPPER's own floor is 1 rating).
    expect(computeLeagueTier(200, 10, 2, 0, 0)).toBe('COPPER');
  });

  it('a low average blocks every tier that needs one, down to STONE', () => {
    // 200 jobs, 50 ratings, but averaging 3.0 — below even COPPER's 3.5 floor. STONE has no
    // rating requirement at all, so that is as far as a low average alone can fall.
    expect(computeLeagueTier(200, 150, 50, 0, 0)).toBe('STONE');
  });

  it('climbs the ladder exactly at each threshold', () => {
    expect(computeLeagueTier(10, 12, 3, 0, 0)).toBe('BRONZE'); // avg 4.0, exactly at the floor
    expect(computeLeagueTier(20, 26, 6, 0, 0)).toBe('SILVER'); // avg 4.33
    expect(computeLeagueTier(40, 45, 10, 0, 0)).toBe('GOLD'); // avg 4.5
    expect(computeLeagueTier(80, 85, 18, 0, 0)).toBe('PLATINUM'); // avg 4.72
    expect(computeLeagueTier(150, 144, 30, 0, 0)).toBe('DIAMOND'); // avg 4.8
    expect(computeLeagueTier(300, 294, 60, 0, 0)).toBe('LEGENDARY'); // avg 4.9
  });

  it('one job short of a tier keeps the previous tier', () => {
    // Same rating profile as GOLD above (avg 4.5, 10 ratings — enough for GOLD), but 39 jobs
    // instead of 40: falls back to SILVER.
    expect(computeLeagueTier(39, 45, 10, 0, 0)).toBe('SILVER');
  });

  it('a high cancellation rate caps the league even with a perfect rating otherwise', () => {
    // 10 completed, 5 cancelled by the worker -> 50% cancellation rate. BRONZE (18%) and COPPER
    // (25%) both refuse it despite avg 5.0; only STONE's unlimited ceiling accepts it.
    expect(computeLeagueTier(10, 50, 10, 5, 0)).toBe('STONE');
  });

  it('cancellation rate is bad-outcomes-per-completed-job, not diluted by volume', () => {
    // 1 completed job, 1 cancellation: a 100% rate, not "50% of 2 attempts" — still clears STONE,
    // the only tier with no ceiling on it.
    expect(computeLeagueTier(1, 5, 1, 1, 0)).toBe('STONE');
  });

  it('dispute rate is wired in but inert today: a nonzero jobsDisputed cannot block any tier yet', () => {
    // Every DEFAULT_LEAGUE_THRESHOLDS entry has maxDisputeRate: 1, so this must equal the
    // otherwise-identical case with jobsDisputed: 0 (D-076: no live flow sets JobStatus.DISPUTED).
    const withDisputes = computeLeagueTier(150, 144, 30, 0, 149);
    const withoutDisputes = computeLeagueTier(150, 144, 30, 0, 0);
    expect(withDisputes).toBe(withoutDisputes);
    expect(withDisputes).toBe('DIAMOND');
  });

  it('DEFAULT_LEAGUE_THRESHOLDS ends in an all-zero WOOD floor, so every Ranger has a league', () => {
    const last = DEFAULT_LEAGUE_THRESHOLDS[DEFAULT_LEAGUE_THRESHOLDS.length - 1];
    expect(last).toMatchObject({ tier: 'WOOD', minJobs: 0, minRatingCount: 0, minRatingAvg: 0 });
  });

  it('thresholds are strictly descending in requirements from LEGENDARY down to WOOD', () => {
    for (let i = 1; i < DEFAULT_LEAGUE_THRESHOLDS.length; i++) {
      const prev = DEFAULT_LEAGUE_THRESHOLDS[i - 1]!;
      const cur = DEFAULT_LEAGUE_THRESHOLDS[i]!;
      expect(cur.minJobs).toBeLessThanOrEqual(prev.minJobs);
      expect(cur.minRatingCount).toBeLessThanOrEqual(prev.minRatingCount);
      expect(cur.minRatingAvg).toBeLessThanOrEqual(prev.minRatingAvg);
      expect(cur.maxCancellationRate).toBeGreaterThanOrEqual(prev.maxCancellationRate);
    }
  });

  it('every threshold tier appears exactly once, in LEAGUE_ORDER, descending', () => {
    const tiers = DEFAULT_LEAGUE_THRESHOLDS.map((t) => t.tier);
    expect(new Set(tiers).size).toBe(tiers.length);
    expect(tiers).toEqual([...LEAGUE_ORDER].reverse());
  });

  it('a custom, smaller threshold list is honoured (ops override via system_config)', () => {
    const tiny = [
      {
        tier: 'GOLD' as const,
        minJobs: 2,
        minRatingCount: 1,
        minRatingAvg: 3,
        maxCancellationRate: 1,
        maxDisputeRate: 1,
      },
      {
        tier: 'WOOD' as const,
        minJobs: 0,
        minRatingCount: 0,
        minRatingAvg: 0,
        maxCancellationRate: 1,
        maxDisputeRate: 1,
      },
    ];
    expect(computeLeagueTier(2, 3, 1, 0, 0, tiny)).toBe('GOLD');
    expect(computeLeagueTier(1, 3, 1, 0, 0, tiny)).toBe('WOOD');
  });
});

describe('leagueProgress', () => {
  it('a brand-new Ranger is at WOOD, 0% toward STONE (needs 1 job)', () => {
    expect(leagueProgress(0, 0, 0, 0, 0)).toEqual({ current: 'WOOD', next: 'STONE', progress: 0 });
  });

  it('STONE requires nothing further, so reaching it is already 100% progress to itself', () => {
    expect(leagueProgress(1, 0, 0, 0, 0)).toMatchObject({ current: 'STONE', next: 'COPPER' });
  });

  it('progress is bounded by the slowest-moving factor, not the average of all of them', () => {
    // At BRONZE heading to SILVER (needs 20 jobs, 6 ratings, avg 4.3): 10/20 jobs = 50% but only
    // 3/6 ratings = 50% too and avg already clears 4.3 (=1). Bound is min(.5, .5, 1) = .5.
    const p = leagueProgress(10, 13, 3, 0, 0); // avg 4.33
    expect(p).toMatchObject({ current: 'BRONZE', next: 'SILVER' });
    expect(p.progress).toBeCloseTo(0.5, 2);
  });

  it('a rate ceiling the Ranger already fails counts as 0 progress on that factor, not partial credit', () => {
    // At COPPER heading to BRONZE (needs 10 jobs, 3 ratings, avg 4.0, max 18% cancellation).
    // Jobs/ratings/avg are all already satisfied, but a 20% cancellation rate clears COPPER's 25%
    // ceiling (so COPPER is reached) while failing BRONZE's stricter 18% ceiling.
    const p = leagueProgress(10, 50, 10, 2, 0); // avg 5.0, cancellationRate 20%
    expect(p).toMatchObject({ current: 'COPPER', next: 'BRONZE', progress: 0 });
  });

  it('LEGENDARY has no next league: progress is 1 and next is null', () => {
    expect(leagueProgress(300, 294, 60, 0, 0)).toEqual({
      current: 'LEGENDARY',
      next: null,
      progress: 1,
    });
  });
});

describe('isValidThresholds', () => {
  it('accepts a well-formed array', () => {
    expect(isValidThresholds(DEFAULT_LEAGUE_THRESHOLDS)).toBe(true);
  });
  it('rejects non-arrays, empty arrays, and malformed entries', () => {
    expect(isValidThresholds(null)).toBe(false);
    expect(isValidThresholds(undefined)).toBe(false);
    expect(isValidThresholds('WOOD')).toBe(false);
    expect(isValidThresholds([])).toBe(false);
    expect(isValidThresholds([{ tier: 'GOLD' }])).toBe(false);
    expect(
      isValidThresholds([
        {
          tier: 'GOLD',
          minJobs: '5',
          minRatingCount: 1,
          minRatingAvg: 4,
          maxCancellationRate: 1,
          maxDisputeRate: 1,
        },
      ]),
    ).toBe(false);
    // Missing the new D-076 fields (an old-shaped badge threshold) is also invalid.
    expect(
      isValidThresholds([{ tier: 'GOLD', minJobs: 5, minRatingCount: 1, minRatingAvg: 4 }]),
    ).toBe(false);
  });
});
