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
      ['MATCHED', 'NEGOTIATING', 'CUSTOMER'],
      ['NEGOTIATING', 'AGREED', 'WORKER'],
      ['AGREED', 'EN_ROUTE', 'WORKER'],
      ['EN_ROUTE', 'ARRIVED', 'WORKER'],
      ['ARRIVED', 'IN_PROGRESS', 'WORKER'],
      ['IN_PROGRESS', 'COMPLETED_BY_WORKER', 'WORKER'],
      ['COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'CUSTOMER'],
    ];
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it('the wrong party is refused: a customer cannot mark the Ranger en route, a Ranger cannot confirm', () => {
    expect(canTransition('AGREED', 'EN_ROUTE', 'CUSTOMER')).toBe(false);
    expect(canTransition('COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'WORKER')).toBe(false);
    expect(canTransition('BROADCASTING', 'MATCHED', 'CUSTOMER')).toBe(false); // only a Ranger can accept
  });

  it('skipping steps is refused', () => {
    expect(canTransition('AGREED', 'IN_PROGRESS', 'WORKER')).toBe(false);
    expect(canTransition('MATCHED', 'EN_ROUTE', 'WORKER')).toBe(false);
    expect(canTransition('EN_ROUTE', 'IN_PROGRESS', 'WORKER')).toBe(false);
    expect(canTransition('BROADCASTING', 'AGREED', 'WORKER')).toBe(false);
  });

  it('terminal states allow nothing (except refunds) so a finished job cannot be revived', () => {
    for (const s of ['CANCELLED', 'NO_SHOW_CUSTOMER', 'REFUNDED'] as JobStatus[]) {
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

  it('nobody can cancel once work has started (they must raise a dispute instead)', () => {
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'WORKER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'DISPUTED', 'CUSTOMER')).toBe(true);
  });

  it('assertTransition throws a 409 with the reason', () => {
    expect(() => assertTransition('AGREED', 'IN_PROGRESS', 'WORKER')).toThrow(
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
