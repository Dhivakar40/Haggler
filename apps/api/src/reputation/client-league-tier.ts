import type { ClientLeagueTierName } from '@prisma/client';

/**
 * A client's league (Phase 12, D-077): the customer-side mirror of the Ranger league system
 * (reputation/league-tier.ts), using the ratings Rangers already leave for customers (collected
 * since Phase 4, previously unused — see D-047) plus completed-booking count and a cancellation
 * ceiling. Deliberately no dispute-rate factor: the brief names three inputs for this ladder
 * (completed bookings, rating given by Rangers, no-show/cancellation rate), not four — unlike the
 * Ranger ladder, there is no "jobsDisputed future feature" hook to mirror here.
 *
 * Thresholds are placeholders for ops/product to tune, same status as every other threshold table
 * in this codebase. Deliberately lower job-count floors than the Ranger ladder: a customer books
 * occasionally, a Ranger works constantly, so the same raw counts would mean very different things.
 */
export interface ClientLeagueThreshold {
  tier: ClientLeagueTierName;
  minBookings: number;
  minRatingCount: number;
  minRatingAvg: number;
  maxCancellationRate: number;
}

/** Checked in order; the first one a client qualifies for wins. Must end in a tier with all-zero
 * requirements (NEWCOMER) so every client has a league. */
export const DEFAULT_CLIENT_LEAGUE_THRESHOLDS: readonly ClientLeagueThreshold[] = [
  { tier: 'LEGEND', minBookings: 100, minRatingCount: 20, minRatingAvg: 4.8, maxCancellationRate: 0.05 },
  { tier: 'PATRON', minBookings: 50, minRatingCount: 12, minRatingAvg: 4.6, maxCancellationRate: 0.08 },
  { tier: 'CHAMPION', minBookings: 25, minRatingCount: 8, minRatingAvg: 4.4, maxCancellationRate: 0.12 },
  { tier: 'ELITE', minBookings: 12, minRatingCount: 5, minRatingAvg: 4.2, maxCancellationRate: 0.15 },
  { tier: 'LOYAL', minBookings: 6, minRatingCount: 3, minRatingAvg: 4.0, maxCancellationRate: 0.2 },
  { tier: 'TRUSTED', minBookings: 3, minRatingCount: 2, minRatingAvg: 3.5, maxCancellationRate: 0.25 },
  { tier: 'PREFERRED', minBookings: 2, minRatingCount: 1, minRatingAvg: 3.0, maxCancellationRate: 0.35 },
  { tier: 'REGULAR', minBookings: 1, minRatingCount: 0, minRatingAvg: 0, maxCancellationRate: 1 },
  { tier: 'NEWCOMER', minBookings: 0, minRatingCount: 0, minRatingAvg: 0, maxCancellationRate: 1 },
];

/** Ascending order of every client league, lowest first. */
export const CLIENT_LEAGUE_ORDER: readonly ClientLeagueTierName[] = [
  'NEWCOMER',
  'REGULAR',
  'PREFERRED',
  'TRUSTED',
  'LOYAL',
  'ELITE',
  'CHAMPION',
  'PATRON',
  'LEGEND',
];

export const clientRatingAverage = (ratingSum: number, ratingCount: number): number =>
  ratingCount > 0 ? ratingSum / ratingCount : 0;

/** Same bad-outcomes-per-completed-booking reasoning as league-tier.ts's safeRate: a cancellation
 * never increments bookingsCompleted, so volume cannot dilute the rate toward zero. */
const safeRate = (bad: number, completed: number): number =>
  completed > 0 ? bad / completed : bad > 0 ? 1 : 0;

export function computeClientLeagueTier(
  bookingsCompleted: number,
  ratingSum: number,
  ratingCount: number,
  bookingsCancelledByCustomer: number,
  thresholds: readonly ClientLeagueThreshold[] = DEFAULT_CLIENT_LEAGUE_THRESHOLDS,
): ClientLeagueTierName {
  const avg = clientRatingAverage(ratingSum, ratingCount);
  const cancellationRate = safeRate(bookingsCancelledByCustomer, bookingsCompleted);
  for (const t of thresholds) {
    if (
      bookingsCompleted >= t.minBookings &&
      ratingCount >= t.minRatingCount &&
      avg >= t.minRatingAvg &&
      cancellationRate <= t.maxCancellationRate
    )
      return t.tier;
  }
  return 'NEWCOMER'; // unreachable if thresholds end in an all-zero tier, but never crash on a bad config
}

export interface ClientLeagueProgress {
  current: ClientLeagueTierName;
  /** null only at LEGEND, the top of the ladder. */
  next: ClientLeagueTierName | null;
  /** 0..1, bounded by whichever requirement for `next` is furthest from being met. */
  progress: number;
}

export function clientLeagueProgress(
  bookingsCompleted: number,
  ratingSum: number,
  ratingCount: number,
  bookingsCancelledByCustomer: number,
  thresholds: readonly ClientLeagueThreshold[] = DEFAULT_CLIENT_LEAGUE_THRESHOLDS,
): ClientLeagueProgress {
  const current = computeClientLeagueTier(
    bookingsCompleted,
    ratingSum,
    ratingCount,
    bookingsCancelledByCustomer,
    thresholds,
  );
  const currentIdx = CLIENT_LEAGUE_ORDER.indexOf(current);
  const next = CLIENT_LEAGUE_ORDER[currentIdx + 1] ?? null;
  if (!next) return { current, next: null, progress: 1 };

  const target = thresholds.find((t) => t.tier === next);
  if (!target) return { current, next, progress: 0 };

  const avg = clientRatingAverage(ratingSum, ratingCount);
  const cancellationRate = safeRate(bookingsCancelledByCustomer, bookingsCompleted);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const factors = [
    target.minBookings > 0 ? clamp01(bookingsCompleted / target.minBookings) : 1,
    target.minRatingCount > 0 ? clamp01(ratingCount / target.minRatingCount) : 1,
    target.minRatingAvg > 0 ? clamp01(avg / target.minRatingAvg) : 1,
    cancellationRate <= target.maxCancellationRate ? 1 : 0,
  ];
  return { current, next, progress: Math.min(...factors) };
}

/** True if a set of thresholds is well-formed enough to trust (used when reading an admin override). */
export function isValidClientThresholds(v: unknown): v is ClientLeagueThreshold[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        typeof (t as ClientLeagueThreshold).tier === 'string' &&
        typeof (t as ClientLeagueThreshold).minBookings === 'number' &&
        typeof (t as ClientLeagueThreshold).minRatingCount === 'number' &&
        typeof (t as ClientLeagueThreshold).minRatingAvg === 'number' &&
        typeof (t as ClientLeagueThreshold).maxCancellationRate === 'number',
    )
  );
}
