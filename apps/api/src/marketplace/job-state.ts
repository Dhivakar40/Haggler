import type { JobStatus } from '@prisma/client';
import { ACTIVE_JOB_STATES } from '@haggler/shared';
import { CodedException } from '../common/http-errors';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@haggler/shared';

export type Actor = 'CUSTOMER' | 'WORKER' | 'SYSTEM';

/**
 * The job state machine (D3, revised D-087 "Phase Flow-Final"). Every status change goes
 * through `assertTransition`, so a client can never jump a job to a state the rules do not
 * allow, and only the right party can move it.
 *
 * Current flow (D-087):
 *   REQUESTED -> BROADCASTING -> MATCHED -> EN_ROUTE -> ARRIVED -> QUOTING
 *        -> AGREED -> IN_PROGRESS -> COMPLETED_BY_WORKER -> CONFIRMED_BY_CUSTOMER
 *   plus QUOTE_REJECTED, PAUSED_PARTS, CANCELLED, NO_SHOW_WORKER, NO_SHOW_CUSTOMER, DISPUTED,
 *   REFUNDED.
 *
 * The price is no longer agreed at match time — the Ranger travels on spec, diagnoses on site
 * (QUOTING), and only AGREED once the customer accepts that quote; by then the Ranger is already
 * there, so AGREED goes straight to IN_PROGRESS, not EN_ROUTE. A rejected quote is
 * QUOTE_REJECTED, not CANCELLED, so the visit-fee settlement it triggers stays unambiguous in
 * reporting. COMPLETED_BY_WORKER -> CONFIRMED_BY_CUSTOMER now also allows actor WORKER: payment
 * happens first, then the Ranger enters the completion code the customer shares — the Ranger is
 * the one making that final move, not the customer.
 *
 * Earlier edges (D-080 A3's auto-agree, D3's negotiation, the old price-before-travel order)
 * stay in the table below so a job already mid-flow under an earlier version keeps working;
 * no new job is routed through them. See job-state.spec.ts's "earlier-flow" describe block.
 *
 * Trace: a Ranger tries to start a job that is only AGREED under the new flow. AGREED allows
 * {EN_ROUTE, IN_PROGRESS, CANCELLED}; IN_PROGRESS is among them now (the Ranger is already on
 * site), so the move succeeds — contrast the pre-D-087 trace, where only EN_ROUTE was allowed.
 */
const C: Actor = 'CUSTOMER';
const W: Actor = 'WORKER';
const S: Actor = 'SYSTEM';

export const TRANSITIONS: Record<JobStatus, Partial<Record<JobStatus, Actor[]>>> = {
  REQUESTED: { BROADCASTING: [S], CANCELLED: [C, S] },
  BROADCASTING: { MATCHED: [W], CANCELLED: [C, S] },
  // AGREED:[S] is the D-080 auto-agree edge, kept for a pre-D-087 job only; a new job matches
  // and heads straight to EN_ROUTE, with no price agreed yet.
  MATCHED: { AGREED: [S], NEGOTIATING: [C, W], EN_ROUTE: [W], CANCELLED: [C, W, S] },
  NEGOTIATING: { AGREED: [C, W], CANCELLED: [C, W, S] },
  // EN_ROUTE:[W] here is the pre-D-087 "price agreed, now travelling" edge; IN_PROGRESS:[W] is
  // new — once the Ranger is already on site (D-087), an accepted quote starts work at once.
  AGREED: { EN_ROUTE: [W], IN_PROGRESS: [W], CANCELLED: [C, W, S] },
  EN_ROUTE: { ARRIVED: [W], CANCELLED: [C, W], NO_SHOW_WORKER: [C] },
  // IN_PROGRESS:[W] here is the pre-D-087 edge (no quote step); QUOTING:[W] is the new one.
  ARRIVED: { IN_PROGRESS: [W], QUOTING: [W], CANCELLED: [C, W], NO_SHOW_CUSTOMER: [W] },
  QUOTING: { AGREED: [C], QUOTE_REJECTED: [C], CANCELLED: [C, W] },
  IN_PROGRESS: { COMPLETED_BY_WORKER: [W], DISPUTED: [C, W], PAUSED_PARTS: [W] },
  PAUSED_PARTS: { IN_PROGRESS: [W, S], CANCELLED: [C, W, S] },
  // CONFIRMED_BY_CUSTOMER:[C,S] is the pre-D-087 edge; [W] is new — the Ranger enters the
  // completion code the customer shares, after paying, which is what actually closes the job.
  COMPLETED_BY_WORKER: { CONFIRMED_BY_CUSTOMER: [C, S, W], DISPUTED: [C, W] },
  CONFIRMED_BY_CUSTOMER: { DISPUTED: [C, W], REFUNDED: [S] },
  CANCELLED: {},
  // D-093 (K3): a no-show job had no path forward at all — found while verifying auto-
  // reassignment "still exists" per the master prompt, and it turned out never to have existed.
  // BROADCASTING:[C] is the customer asking to be rematched with a different Ranger; nothing has
  // been paid yet at this point in either flow, so there is no refund step needed first.
  NO_SHOW_WORKER: { REFUNDED: [S], BROADCASTING: [C] },
  NO_SHOW_CUSTOMER: {},
  DISPUTED: { REFUNDED: [S], CONFIRMED_BY_CUSTOMER: [S] },
  REFUNDED: {},
  QUOTE_REJECTED: {},
};

export function canTransition(from: JobStatus, to: JobStatus, actor: Actor): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export function allowedNext(from: JobStatus, actor: Actor): JobStatus[] {
  return Object.entries(TRANSITIONS[from] ?? {})
    .filter(([, actors]) => actors?.includes(actor))
    .map(([to]) => to as JobStatus);
}

export function assertTransition(from: JobStatus, to: JobStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) {
    throw new CodedException(
      HttpStatus.CONFLICT,
      ERROR_CODES.CONFLICT,
      `A job that is ${from} cannot become ${to} by ${actor}.`,
      { code: 'INVALID_TRANSITION', from, to, actor },
    );
  }
}

export const isActiveStatus = (s: JobStatus): boolean =>
  (ACTIVE_JOB_STATES as readonly string[]).includes(s);

/** Statuses from which the customer may still cancel without a dispute, through the generic
 * LifecycleService.cancel(). D-093 (K3): QUOTING and PAUSED_PARTS are deliberately NOT here,
 * even though job-state.ts's own TRANSITIONS table allows a customer-actor move to CANCELLED
 * from both — that permissiveness exists for QuoteBuilderService.reject() and PartsPauseService.
 * rejectExtension() to use directly, each of which freezes a visit fee first. Generic cancel()
 * never charges that fee (it only computes cancellationFeeApplies for EN_ROUTE/ARRIVED), so
 * including these two here would let a customer skip the visit fee entirely by calling /cancel
 * instead of /quote/reject or /pause/reject — found while verifying this cancellation path
 * still behaved correctly after Sub-phases G/I added those two statuses (see docs/DECISIONS.md
 * D-093). cancel() refuses both with NOT_CANCELLABLE, same as any other closed-off status. */
export const CUSTOMER_CANCELLABLE: JobStatus[] = [
  'REQUESTED',
  'BROADCASTING',
  'MATCHED',
  'NEGOTIATING',
  'AGREED',
  'EN_ROUTE',
  'ARRIVED',
];
