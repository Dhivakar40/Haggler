/**
 * Ranger ranking for broadcast waves (D3). Score is a weighted sum of four parts, each 0..1:
 *
 *   distance    closer is better            1 - distance / radius
 *   league      higher league is better     leagueIndex / 8        (WOOD 0 ... LEGENDARY 8, D-076)
 *   fairness    fewer recent jobs is better 1 / (1 + jobsLast7d)   (new Rangers get a fair share)
 *   acceptance  reliable is better          (accepted + 2) / (received + 4)
 *
 * The "+2 / +4" is Laplace smoothing: a brand-new Ranger (0 of 0) scores 0.5, not 0 and not 1, so
 * one lucky or unlucky offer does not swing their ranking.
 *
 * Trace (radius 5000 m, default weights .4/.2/.2/.2):
 *   Asha:  800 m, SILVER(4/8), 12 jobs this week, accepted 9 of 10
 *          distance .84, league .5, fairness .077, acceptance (9+2)/(10+4)=.786
 *          score = .4*.84 + .2*.5 + .2*.077 + .2*.786 = .336+.1+.015+.157 = .608
 *   Ravi: 2200 m, WOOD(0/8),  0 jobs this week, no history
 *          distance .56, league 0, fairness 1, acceptance .5
 *          score = .224 + 0 + .2 + .1 = .524   -> close behind Asha despite being new and farther
 * Boosted/"Promoted" listings never touch this (D4): there is no input for it.
 */
export const LEAGUE_INDEX: Record<string, number> = {
  WOOD: 0,
  STONE: 1,
  COPPER: 2,
  BRONZE: 3,
  SILVER: 4,
  GOLD: 5,
  PLATINUM: 6,
  DIAMOND: 7,
  LEGENDARY: 8,
};

export interface Candidate {
  userId: string;
  distanceM: number;
  league: string;
  jobsLast7d: number;
  offersReceived: number;
  offersAccepted: number;
  gender: 'FEMALE' | 'MALE' | 'OTHER' | null;
}

export interface RankingWeights {
  distance: number;
  league: number;
  fairness: number;
  acceptance: number;
  /** Extra score when the Ranger matches the customer's gender preference. Soft: never a filter. */
  genderBonus: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  distance: 0.4,
  league: 0.2,
  fairness: 0.2,
  acceptance: 0.2,
  genderBonus: 0.1,
};

export interface RankingContext {
  radiusM: number;
  genderPreference: 'ANY' | 'FEMALE' | 'MALE';
  weights?: RankingWeights;
}

export function scoreCandidate(c: Candidate, ctx: RankingContext): number {
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const distance = Math.max(0, 1 - c.distanceM / ctx.radiusM);
  const league = (LEAGUE_INDEX[c.league] ?? 0) / 8;
  const fairness = 1 / (1 + Math.max(0, c.jobsLast7d));
  const acceptance = (c.offersAccepted + 2) / (c.offersReceived + 4);
  const genderMatch = ctx.genderPreference !== 'ANY' && c.gender === ctx.genderPreference ? 1 : 0;
  return (
    w.distance * distance +
    w.league * league +
    w.fairness * fairness +
    w.acceptance * acceptance +
    w.genderBonus * genderMatch
  );
}

/** Highest score first. Ties break on userId so the order is deterministic (and testable). */
export function rankCandidates(
  cands: Candidate[],
  ctx: RankingContext,
): (Candidate & { score: number })[] {
  return cands
    .map((c) => ({ ...c, score: scoreCandidate(c, ctx) }))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
}
