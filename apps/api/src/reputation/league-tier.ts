import type { LeagueTierName } from '@prisma/client';

/**
 * A Ranger's league (Phase 11, D-076): a Clash-of-Clans-style ladder replacing Phase 4's flat
 * badge tiers, built on the same inputs (completed jobs, average rating) plus two new ones
 * (cancellation rate, dispute rate) — pure and independently testable, like job-state.ts's
 * transition table.
 *
 * Thresholds below are placeholders for ops/product to tune — same status as the seeded DEFAULT
 * price bands (docs/RUNBOOK.md "before launch" checklist) and the badge thresholds they replace —
 * not a promise about how many jobs a real Ranger needs. `minRatingCount` exists so a Ranger with
 * one lucky 5-star review cannot jump straight to the top; they need a track record, not just a
 * good average. `maxCancellationRate`/`maxDisputeRate` exist so volume and a good average alone
 * cannot buy a league a Ranger's reliability doesn't support.
 *
 * Dispute rate is wired in for forward compatibility only: `jobsDisputed` is always 0 today (no
 * flow sets JobStatus.DISPUTED yet, see WorkerStats.jobsDisputed) — `maxDisputeRate` is therefore
 * set to 1 (never binding) at every tier until a real dispute-raising feature exists to feed it.
 */
export interface LeagueThreshold {
  tier: LeagueTierName;
  minJobs: number;
  minRatingCount: number;
  minRatingAvg: number;
  maxCancellationRate: number;
  maxDisputeRate: number;
}

/** Checked in order; the first one a Ranger qualifies for wins. Must end in a tier with all-zero
 * requirements (WOOD) so every Ranger has a league. Ascending: WOOD is the floor, LEGENDARY the
 * ceiling — see schema.prisma's LeagueTierName for the full ordered list. */
export const DEFAULT_LEAGUE_THRESHOLDS: readonly LeagueThreshold[] = [
  {
    tier: 'LEGENDARY',
    minJobs: 300,
    minRatingCount: 60,
    minRatingAvg: 4.9,
    maxCancellationRate: 0.02,
    maxDisputeRate: 1,
  },
  {
    tier: 'DIAMOND',
    minJobs: 150,
    minRatingCount: 30,
    minRatingAvg: 4.8,
    maxCancellationRate: 0.03,
    maxDisputeRate: 1,
  },
  {
    tier: 'PLATINUM',
    minJobs: 80,
    minRatingCount: 18,
    minRatingAvg: 4.7,
    maxCancellationRate: 0.05,
    maxDisputeRate: 1,
  },
  {
    tier: 'GOLD',
    minJobs: 40,
    minRatingCount: 10,
    minRatingAvg: 4.5,
    maxCancellationRate: 0.08,
    maxDisputeRate: 1,
  },
  {
    tier: 'SILVER',
    minJobs: 20,
    minRatingCount: 6,
    minRatingAvg: 4.3,
    maxCancellationRate: 0.12,
    maxDisputeRate: 1,
  },
  {
    tier: 'BRONZE',
    minJobs: 10,
    minRatingCount: 3,
    minRatingAvg: 4.0,
    maxCancellationRate: 0.18,
    maxDisputeRate: 1,
  },
  {
    tier: 'COPPER',
    minJobs: 5,
    minRatingCount: 1,
    minRatingAvg: 3.5,
    maxCancellationRate: 0.25,
    maxDisputeRate: 1,
  },
  {
    tier: 'STONE',
    minJobs: 1,
    minRatingCount: 0,
    minRatingAvg: 0,
    maxCancellationRate: 1,
    maxDisputeRate: 1,
  },
  {
    tier: 'WOOD',
    minJobs: 0,
    minRatingCount: 0,
    minRatingAvg: 0,
    maxCancellationRate: 1,
    maxDisputeRate: 1,
  },
];

/** Ascending order of every league, lowest first — the ladder a Ranger climbs. */
export const LEAGUE_ORDER: readonly LeagueTierName[] = [
  'WOOD',
  'STONE',
  'COPPER',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'DIAMOND',
  'LEGENDARY',
];

export const ratingAverage = (ratingSum: number, ratingCount: number): number =>
  ratingCount > 0 ? ratingSum / ratingCount : 0;

/** jobsCompleted is the denominator (not jobsCompleted + jobsCancelledByWorker): a cancellation
 * never increments jobsCompleted, so this stays a strict "bad outcomes per good outcome" rate
 * that cannot be diluted toward zero by also being prolific — a Ranger with 1 completed job and 1
 * cancellation reads as a 100% rate, not 50%. */
const safeRate = (bad: number, completed: number): number =>
  completed > 0 ? bad / completed : bad > 0 ? 1 : 0;

export function computeLeagueTier(
  jobsCompleted: number,
  ratingSum: number,
  ratingCount: number,
  jobsCancelledByWorker: number,
  jobsDisputed: number,
  thresholds: readonly LeagueThreshold[] = DEFAULT_LEAGUE_THRESHOLDS,
): LeagueTierName {
  const avg = ratingAverage(ratingSum, ratingCount);
  const cancellationRate = safeRate(jobsCancelledByWorker, jobsCompleted);
  const disputeRate = safeRate(jobsDisputed, jobsCompleted);
  for (const t of thresholds) {
    if (
      jobsCompleted >= t.minJobs &&
      ratingCount >= t.minRatingCount &&
      avg >= t.minRatingAvg &&
      cancellationRate <= t.maxCancellationRate &&
      disputeRate <= t.maxDisputeRate
    )
      return t.tier;
  }
  return 'WOOD'; // unreachable if thresholds end in an all-zero tier, but never crash on a bad config
}

export interface LeagueProgress {
  current: LeagueTierName;
  /** null only at LEGENDARY, the top of the ladder — there is nothing further to progress toward. */
  next: LeagueTierName | null;
  /** 0..1, bounded by whichever requirement for `next` is furthest from being met (the Ranger
   * needs ALL of them, so the slowest-moving one is what actually gates the promotion). A rate
   * ceiling (cancellation/dispute) counts as already-met (1) or not (0) — there is no partial
   * credit for "a bit too cancellation-prone", only pass/fail against the ceiling. */
  progress: number;
}

/** Drives the Ranger-facing progress bar/meter (Part D). Pure, so the mobile client's own preview
 * of "what would it take" math (if any) can reuse the exact same reasoning. */
export function leagueProgress(
  jobsCompleted: number,
  ratingSum: number,
  ratingCount: number,
  jobsCancelledByWorker: number,
  jobsDisputed: number,
  thresholds: readonly LeagueThreshold[] = DEFAULT_LEAGUE_THRESHOLDS,
): LeagueProgress {
  const current = computeLeagueTier(
    jobsCompleted,
    ratingSum,
    ratingCount,
    jobsCancelledByWorker,
    jobsDisputed,
    thresholds,
  );
  const currentIdx = LEAGUE_ORDER.indexOf(current);
  const next = LEAGUE_ORDER[currentIdx + 1] ?? null;
  if (!next) return { current, next: null, progress: 1 };

  const target = thresholds.find((t) => t.tier === next);
  if (!target) return { current, next, progress: 0 }; // malformed admin override; fail safe, not loud

  const avg = ratingAverage(ratingSum, ratingCount);
  const cancellationRate = safeRate(jobsCancelledByWorker, jobsCompleted);
  const disputeRate = safeRate(jobsDisputed, jobsCompleted);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const factors = [
    target.minJobs > 0 ? clamp01(jobsCompleted / target.minJobs) : 1,
    target.minRatingCount > 0 ? clamp01(ratingCount / target.minRatingCount) : 1,
    target.minRatingAvg > 0 ? clamp01(avg / target.minRatingAvg) : 1,
    cancellationRate <= target.maxCancellationRate ? 1 : 0,
    disputeRate <= target.maxDisputeRate ? 1 : 0,
  ];
  return { current, next, progress: Math.min(...factors) };
}

/** True if a set of thresholds is well-formed enough to trust (used when reading an admin override). */
export function isValidThresholds(v: unknown): v is LeagueThreshold[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof (t as LeagueThreshold).tier === 'string' &&
        typeof (t as LeagueThreshold).minJobs === 'number' &&
        typeof (t as LeagueThreshold).minRatingCount === 'number' &&
        typeof (t as LeagueThreshold).minRatingAvg === 'number' &&
        typeof (t as LeagueThreshold).maxCancellationRate === 'number' &&
        typeof (t as LeagueThreshold).maxDisputeRate === 'number',
    )
  );
}
