import type { JobStatus } from '@prisma/client';
import { ACTIVE_JOB_STATES } from '@haggler/shared';
import { CodedException } from '../common/http-errors';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@haggler/shared';

export type Actor = 'CUSTOMER' | 'WORKER' | 'SYSTEM';

/**
 * The job state machine (D3). Every status change goes through `assertTransition`, so a client can
 * never jump a job to a state the rules do not allow, and only the right party can move it.
 *
 *   REQUESTED -> BROADCASTING -> MATCHED -> NEGOTIATING -> AGREED -> EN_ROUTE -> ARRIVED
 *        -> IN_PROGRESS -> COMPLETED_BY_WORKER -> CONFIRMED_BY_CUSTOMER
 *   plus CANCELLED, NO_SHOW_WORKER, NO_SHOW_CUSTOMER, DISPUTED, REFUNDED.
 *
 * Trace: a Ranger tries to start a job that is only AGREED. AGREED allows {EN_ROUTE, CANCELLED};
 * IN_PROGRESS is not among them, so the move is refused with 409 INVALID_TRANSITION.
 */
const C: Actor = 'CUSTOMER';
const W: Actor = 'WORKER';
const S: Actor = 'SYSTEM';

export const TRANSITIONS: Record<JobStatus, Partial<Record<JobStatus, Actor[]>>> = {
  REQUESTED: { BROADCASTING: [S], CANCELLED: [C, S] },
  BROADCASTING: { MATCHED: [W], CANCELLED: [C, S] },
  MATCHED: { NEGOTIATING: [C, W], CANCELLED: [C, W, S] },
  NEGOTIATING: { AGREED: [C, W], CANCELLED: [C, W, S] },
  AGREED: { EN_ROUTE: [W], CANCELLED: [C, W, S] },
  EN_ROUTE: { ARRIVED: [W], CANCELLED: [C, W], NO_SHOW_WORKER: [C] },
  ARRIVED: { IN_PROGRESS: [W], CANCELLED: [C, W], NO_SHOW_CUSTOMER: [W] },
  IN_PROGRESS: { COMPLETED_BY_WORKER: [W], DISPUTED: [C, W] },
  COMPLETED_BY_WORKER: { CONFIRMED_BY_CUSTOMER: [C, S], DISPUTED: [C, W] },
  CONFIRMED_BY_CUSTOMER: { DISPUTED: [C, W], REFUNDED: [S] },
  CANCELLED: {},
  NO_SHOW_WORKER: { REFUNDED: [S] },
  NO_SHOW_CUSTOMER: {},
  DISPUTED: { REFUNDED: [S], CONFIRMED_BY_CUSTOMER: [S] },
  REFUNDED: {},
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

/** Statuses from which the customer may still cancel without a dispute. */
export const CUSTOMER_CANCELLABLE: JobStatus[] = [
  'REQUESTED',
  'BROADCASTING',
  'MATCHED',
  'NEGOTIATING',
  'AGREED',
  'EN_ROUTE',
  'ARRIVED',
];
