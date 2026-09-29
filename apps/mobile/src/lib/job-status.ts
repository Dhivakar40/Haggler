import type { JobDto } from '@haggler/shared';

export type Role = 'CUSTOMER' | 'WORKER';

export const ACTIVE_STATES = [
  'MATCHED',
  'NEGOTIATING',
  'AGREED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
] as const;
export const isActive = (status: string): boolean =>
  (ACTIVE_STATES as readonly string[]).includes(status);
export const isTerminal = (status: string): boolean =>
  [
    'CONFIRMED_BY_CUSTOMER',
    'CANCELLED',
    'NO_SHOW_WORKER',
    'NO_SHOW_CUSTOMER',
    'REFUNDED',
    'DISPUTED',
  ].includes(status);

/** The customer waits on the request screen until a Ranger accepts. */
export const isWaitingForRanger = (job: Pick<JobDto, 'status'>): boolean =>
  job.status === 'REQUESTED' || job.status === 'BROADCASTING';

/** Broadcast has run out of waves: the customer chooses to re-broadcast or cancel. */
export function isTimedOut(job: Pick<JobDto, 'status' | 'broadcast'>, now: number): boolean {
  const deadline = job.broadcast?.deadline ? new Date(job.broadcast.deadline).getTime() : null;
  return job.status === 'BROADCASTING' && deadline !== null && now >= deadline;
}

/** Whole seconds left until `iso`, never negative. */
export const secondsUntil = (iso: string | null, now: number): number =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0;

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The single pending offer that is still open, if any. */
export function pendingOffer(job: Pick<JobDto, 'offers'>, now: number) {
  return job.offers.find((o) => o.status === 'PENDING' && new Date(o.expiresAt).getTime() > now);
}

export const isOutsideBand = (
  amountPaise: number,
  band: { minPaise: number; maxPaise: number },
): boolean => amountPaise < band.minPaise || amountPaise > band.maxPaise;

/** i18n keys for the status headline, most specific first: a Ranger-specific wording, then the general one. */
export function statusKeys(job: Pick<JobDto, 'status' | 'viewerRole'>): string[] {
  const general = `job.status.${job.status}`;
  return job.viewerRole === 'WORKER' ? [`job.statusRanger.${job.status}`, general] : [general];
}
