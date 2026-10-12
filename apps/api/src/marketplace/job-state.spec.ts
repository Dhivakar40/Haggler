import type { JobStatus } from '@prisma/client';
import { JOB_STATES } from '@haggler/shared';
import { ACTIVE_JOB_STATES } from '@haggler/shared';
import {
  allowedNext,
  assertTransition,
  canTransition,
  isActiveStatus,
  TRANSITIONS,
} from './job-state';

describe('job state machine', () => {
  it('covers every state in the shared list, and only those', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...JOB_STATES].sort());
  });

  it('the happy path is allowed step by step, by the right party', () => {
    const path: [JobStatus, JobStatus, 'CUSTOMER' | 'WORKER' | 'SYSTEM'][] = [
      ['REQUESTED', 'BROADCASTING', 'SYSTEM'],
      ['BROADCASTING', 'MATCHED', 'WORKER'],
      ['MATCHED', 'AGREED', 'SYSTEM'], // D-080 (A3): system auto-agrees at the listed price
      ['AGREED', 'EN_ROUTE', 'WORKER'],
      ['EN_ROUTE', 'ARRIVED', 'WORKER'],
      ['ARRIVED', 'IN_PROGRESS', 'WORKER'],
      ['IN_PROGRESS', 'COMPLETED_BY_WORKER', 'WORKER'],
      ['COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'CUSTOMER'],
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it('the wrong party is refused: a customer cannot mark the Ranger en route', () => {
    expect(canTransition('AGREED', 'EN_ROUTE', 'CUSTOMER')).toBe(false);
    expect(canTransition('BROADCASTING', 'MATCHED', 'CUSTOMER')).toBe(false); // only a Ranger can accept
  });

  it('D-087: the Ranger can now also confirm — they enter the completion code the customer shares', () => {
    expect(canTransition('COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'WORKER')).toBe(true);
  });

  it('skipping steps is refused', () => {
    // D-087: AGREED -> IN_PROGRESS is now a real edge (the new flow's Ranger is already on
    // site by the time a quote is accepted) — EN_ROUTE and MATCHED stay genuinely skippable-free.
    expect(canTransition('MATCHED', 'EN_ROUTE', 'CUSTOMER')).toBe(false);
    expect(canTransition('EN_ROUTE', 'IN_PROGRESS', 'WORKER')).toBe(false);
    expect(canTransition('BROADCASTING', 'AGREED', 'WORKER')).toBe(false);
  });

  it('D-080 (A3): MATCHED -> AGREED is SYSTEM-only (no client can skip straight to AGREED), and NEGOTIATING only still exists to let a pre-D-080 job finish out', () => {
    expect(canTransition('MATCHED', 'AGREED', 'SYSTEM')).toBe(true);
    expect(canTransition('MATCHED', 'AGREED', 'CUSTOMER')).toBe(false);
    expect(canTransition('MATCHED', 'AGREED', 'WORKER')).toBe(false);
    expect(canTransition('NEGOTIATING', 'AGREED', 'CUSTOMER')).toBe(true);
  });

  it('terminal states allow nothing (except refunds) so a finished job cannot be revived', () => {
    for (const s of ['CANCELLED', 'NO_SHOW_CUSTOMER', 'REFUNDED', 'QUOTE_REJECTED'] as JobStatus[]) {
      expect(allowedNext(s, 'CUSTOMER')).toEqual([]);
      expect(allowedNext(s, 'WORKER')).toEqual([]);
      expect(allowedNext(s, 'SYSTEM')).toEqual([]);
    }
    expect(canTransition('CANCELLED', 'BROADCASTING', 'SYSTEM')).toBe(false);
  });

  it('no-show can only be claimed by the right side at the right time', () => {
    expect(canTransition('EN_ROUTE', 'NO_SHOW_WORKER', 'CUSTOMER')).toBe(true);
    expect(canTransition('EN_ROUTE', 'NO_SHOW_WORKER', 'WORKER')).toBe(false);
    expect(canTransition('ARRIVED', 'NO_SHOW_CUSTOMER', 'WORKER')).toBe(true);
    expect(canTransition('AGREED', 'NO_SHOW_CUSTOMER', 'WORKER')).toBe(false);
  });

  it('(D-093 K3) a customer can ask to be rematched after a worker no-show', () => {
    expect(canTransition('NO_SHOW_WORKER', 'BROADCASTING', 'CUSTOMER')).toBe(true);
    expect(canTransition('NO_SHOW_WORKER', 'BROADCASTING', 'WORKER')).toBe(false);
  });

  it('nobody can cancel once work has started (they must raise a dispute instead)', () => {
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'WORKER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'DISPUTED', 'CUSTOMER')).toBe(true);
  });

  it('assertTransition throws a 409 with the reason', () => {
    expect(() => assertTransition('EN_ROUTE', 'IN_PROGRESS', 'WORKER')).toThrow(
      /cannot become IN_PROGRESS/,
    );
    expect(() => assertTransition('AGREED', 'EN_ROUTE', 'WORKER')).not.toThrow();
  });

  it('"active" matches the statuses guarded by the database index', () => {
    for (const s of JOB_STATES) {
      expect(isActiveStatus(s as JobStatus)).toBe(
        (ACTIVE_JOB_STATES as readonly string[]).includes(s),
      );
    }
    expect(isActiveStatus('COMPLETED_BY_WORKER')).toBe(false); // frees the Ranger for new work
    expect(isActiveStatus('IN_PROGRESS')).toBe(true);
  });
});

describe('D-087 (Phase Flow-Final): the quote-first flow', () => {
  it('the new happy path: the Ranger travels on spec, quotes on site, then works', () => {
    const path: [JobStatus, JobStatus, 'CUSTOMER' | 'WORKER' | 'SYSTEM'][] = [
      ['REQUESTED', 'BROADCASTING', 'SYSTEM'],
      ['BROADCASTING', 'MATCHED', 'WORKER'],
      ['MATCHED', 'EN_ROUTE', 'WORKER'], // no price agreed yet
      ['EN_ROUTE', 'ARRIVED', 'WORKER'],
      ['ARRIVED', 'QUOTING', 'WORKER'], // start OTP/selfie/GPS done, quote sent
      ['QUOTING', 'AGREED', 'CUSTOMER'], // quote accepted
      ['AGREED', 'IN_PROGRESS', 'WORKER'], // already on site, work starts at once
      ['IN_PROGRESS', 'COMPLETED_BY_WORKER', 'WORKER'],
      ['COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'WORKER'], // Ranger enters the completion code
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it('only the customer decides the quote; the Ranger cannot accept or reject their own', () => {
    expect(canTransition('QUOTING', 'AGREED', 'WORKER')).toBe(false);
    expect(canTransition('QUOTING', 'QUOTE_REJECTED', 'WORKER')).toBe(false);
  });

  it('a rejected quote is QUOTE_REJECTED, not CANCELLED, and is terminal', () => {
    expect(canTransition('QUOTING', 'QUOTE_REJECTED', 'CUSTOMER')).toBe(true);
    expect(allowedNext('QUOTE_REJECTED', 'CUSTOMER')).toEqual([]);
    expect(allowedNext('QUOTE_REJECTED', 'SYSTEM')).toEqual([]);
  });

  it('a Ranger can pause for parts mid-job, and resume or close from there', () => {
    expect(canTransition('IN_PROGRESS', 'PAUSED_PARTS', 'WORKER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'PAUSED_PARTS', 'CUSTOMER')).toBe(false);
    expect(canTransition('PAUSED_PARTS', 'IN_PROGRESS', 'WORKER')).toBe(true);
    expect(canTransition('PAUSED_PARTS', 'CANCELLED', 'CUSTOMER')).toBe(true);
  });

  it('a customer can still cancel while quoting or paused, without a dispute', () => {
    expect(canTransition('QUOTING', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransition('PAUSED_PARTS', 'CANCELLED', 'CUSTOMER')).toBe(true);
  });

  it('either party can dispute a completed-but-unpaid job (step 12: the customer refuses to pay)', () => {
    expect(canTransition('COMPLETED_BY_WORKER', 'DISPUTED', 'WORKER')).toBe(true);
    expect(canTransition('COMPLETED_BY_WORKER', 'DISPUTED', 'CUSTOMER')).toBe(true);
  });

  it('a pre-D-087 job already AGREED before travel still works through EN_ROUTE as before', () => {
    expect(canTransition('AGREED', 'EN_ROUTE', 'WORKER')).toBe(true);
    expect(canTransition('ARRIVED', 'IN_PROGRESS', 'WORKER')).toBe(true); // skips QUOTING
  });
});
