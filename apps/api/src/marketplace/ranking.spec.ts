import { type Candidate, rankCandidates, scoreCandidate } from './ranking';

const base: Candidate = {
  userId: 'a',
  distanceM: 1000,
  badgeTier: 'BRONZE',
  jobsLast7d: 0,
  offersReceived: 0,
  offersAccepted: 0,
  gender: null,
};
const ctx = { radiusM: 5000, genderPreference: 'ANY' as const };

describe('scoreCandidate', () => {
  it('matches the worked example (Asha .558, Ravi .524)', () => {
    const asha = {
      ...base,
      userId: 'asha',
      distanceM: 800,
      badgeTier: 'SILVER',
      jobsLast7d: 12,
      offersReceived: 10,
      offersAccepted: 9,
    };
    const ravi = { ...base, userId: 'ravi', distanceM: 2200 };
    expect(scoreCandidate(asha, ctx)).toBeCloseTo(0.558, 2);
    expect(scoreCandidate(ravi, ctx)).toBeCloseTo(0.524, 2);
  });

  it('closer beats farther, all else equal', () => {
    expect(scoreCandidate({ ...base, distanceM: 500 }, ctx)).toBeGreaterThan(
      scoreCandidate({ ...base, distanceM: 3000 }, ctx),
    );
  });

  it('a higher badge tier beats a lower one, all else equal', () => {
    expect(scoreCandidate({ ...base, badgeTier: 'GOLD' }, ctx)).toBeGreaterThan(
      scoreCandidate({ ...base, badgeTier: 'BRONZE' }, ctx),
    );
  });

  it('fairness: a Ranger with fewer recent jobs gets a boost', () => {
    expect(scoreCandidate({ ...base, jobsLast7d: 0 }, ctx)).toBeGreaterThan(
      scoreCandidate({ ...base, jobsLast7d: 20 }, ctx),
    );
  });

  it('acceptance is smoothed: 0 of 0 = 0.5, 1 of 1 is not a perfect score, 0 of 10 is low', () => {
    const acc = (accepted: number, received: number) =>
      scoreCandidate(
        {
          ...base,
          distanceM: 5000,
          badgeTier: 'BRONZE',
          jobsLast7d: 1e9,
          offersAccepted: accepted,
          offersReceived: received,
        },
        ctx,
      ) / 0.2;
    expect(acc(0, 0)).toBeCloseTo(0.5, 2);
    expect(acc(1, 1)).toBeCloseTo(0.6, 2); // (1+2)/(1+4)
    expect(acc(0, 10)).toBeCloseTo(2 / 14, 2);
  });

  it('distance never goes negative beyond the radius', () => {
    expect(scoreCandidate({ ...base, distanceM: 99_999 }, ctx)).toBeGreaterThanOrEqual(0);
  });

  it('gender preference is a soft bonus: it can lift a match but never removes anyone', () => {
    const f = { ...base, userId: 'f', gender: 'FEMALE' as const };
    const m = { ...base, userId: 'm', gender: 'MALE' as const };
    const ranked = rankCandidates([m, f], { ...ctx, genderPreference: 'FEMALE' });
    expect(ranked.map((r) => r.userId)).toEqual(['f', 'm']); // preferred first
    expect(ranked).toHaveLength(2); // the other is still there
    expect(rankCandidates([m, f], ctx).map((r) => r.score)).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('a strong non-preferred Ranger can still outrank a weak preferred one', () => {
    const weakPreferred = {
      ...base,
      userId: 'weak',
      gender: 'FEMALE' as const,
      distanceM: 4800,
      jobsLast7d: 30,
    };
    const strong = {
      ...base,
      userId: 'strong',
      gender: 'MALE' as const,
      distanceM: 200,
      badgeTier: 'DIAMOND',
    };
    expect(
      rankCandidates([weakPreferred, strong], { ...ctx, genderPreference: 'FEMALE' })[0]?.userId,
    ).toBe('strong');
  });
});

describe('rankCandidates', () => {
  it('is deterministic on ties (by userId)', () => {
    const a = rankCandidates(
      [
        { ...base, userId: 'b' },
        { ...base, userId: 'a' },
      ],
      ctx,
    );
    expect(a.map((r) => r.userId)).toEqual(['a', 'b']);
  });
  it('sorts best first', () => {
    const r = rankCandidates(
      [
        { ...base, userId: 'far', distanceM: 4500 },
        { ...base, userId: 'near', distanceM: 100 },
      ],
      ctx,
    );
    expect(r[0]?.userId).toBe('near');
  });
});
