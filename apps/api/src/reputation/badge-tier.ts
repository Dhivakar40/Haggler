import type { BadgeTierName } from '@prisma/client';

/**
 * A Ranger's badge tier (Phase 4): a trust signal shown to customers everywhere the Ranger's name
 * appears. Pure and independently testable, like job-state.ts's transition table.
 *
 * Thresholds below are placeholders for ops/product to tune — same status as the seeded DEFAULT
 * price bands (docs/RUNBOOK.md "before launch" checklist) — not a promise about how many jobs a
 * real Ranger needs. `minRatingCount` exists so a Ranger with one lucky 5-star review cannot jump
 * straight to DIAMOND; they need a track record, not just a good average.
 */
export interface BadgeThreshold {
  tier: BadgeTierName;
  minJobs: number;
  minRatingCount: number;
  minRatingAvg: number;
}

/** Checked in order; the first one a Ranger qualifies for wins. Must end in a tier with all-zero
 * requirements (BRONZE) so every Ranger has a tier. */
export const DEFAULT_BADGE_THRESHOLDS: readonly BadgeThreshold[] = [
  { tier: 'DIAMOND', minJobs: 100, minRatingCount: 20, minRatingAvg: 4.8 },
  { tier: 'PLATINUM', minJobs: 50, minRatingCount: 10, minRatingAvg: 4.6 },
  { tier: 'GOLD', minJobs: 20, minRatingCount: 5, minRatingAvg: 4.4 },
  { tier: 'SILVER', minJobs: 5, minRatingCount: 3, minRatingAvg: 4.0 },
  { tier: 'BRONZE', minJobs: 0, minRatingCount: 0, minRatingAvg: 0 },
];

export const ratingAverage = (ratingSum: number, ratingCount: number): number =>
  ratingCount > 0 ? ratingSum / ratingCount : 0;

export function computeBadgeTier(
  jobsCompleted: number,
  ratingSum: number,
  ratingCount: number,
  thresholds: readonly BadgeThreshold[] = DEFAULT_BADGE_THRESHOLDS,
): BadgeTierName {
  const avg = ratingAverage(ratingSum, ratingCount);
  for (const t of thresholds) {
    if (jobsCompleted >= t.minJobs && ratingCount >= t.minRatingCount && avg >= t.minRatingAvg)
      return t.tier;
  }
  return 'BRONZE'; // unreachable if thresholds end in an all-zero tier, but never crash on a bad config
}

/** True if a set of thresholds is well-formed enough to trust (used when reading an admin override). */
export function isValidThresholds(v: unknown): v is BadgeThreshold[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof (t as BadgeThreshold).tier === 'string' &&
        typeof (t as BadgeThreshold).minJobs === 'number' &&
        typeof (t as BadgeThreshold).minRatingCount === 'number' &&
        typeof (t as BadgeThreshold).minRatingAvg === 'number',
    )
  );
}
