import {
  formatCountdown,
  isActive,
  isTerminal,
  isTimedOut,
  isWaitingForRanger,
  secondsUntil,
  statusKeys,
} from './job-status';

const NOW = new Date('2026-09-30T10:00:00Z').getTime();
const iso = (ms: number) => new Date(NOW + ms).toISOString();

describe('job status helpers', () => {
  it('knows active and terminal states', () => {
    expect(isActive('EN_ROUTE')).toBe(true);
    expect(isActive('COMPLETED_BY_WORKER')).toBe(false);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('IN_PROGRESS')).toBe(false);
  });

  it('a broadcast is timed out only when its deadline has passed', () => {
    const job = (deadline: string | null, status = 'BROADCASTING') =>
      ({ status, broadcast: { wave: 3, slaEstimateMinutes: 4, deadline } }) as never;
    expect(isTimedOut(job(iso(60_000)), NOW)).toBe(false);
    expect(isTimedOut(job(iso(-1)), NOW)).toBe(true);
    expect(isTimedOut(job(null), NOW)).toBe(false);
    expect(isTimedOut(job(iso(-1), 'MATCHED'), NOW)).toBe(false);
    expect(isWaitingForRanger({ status: 'REQUESTED' })).toBe(true);
    expect(isWaitingForRanger({ status: 'MATCHED' })).toBe(false);
  });

  it('countdown math', () => {
    expect(secondsUntil(iso(90_500), NOW)).toBe(91);
    expect(secondsUntil(iso(-5000), NOW)).toBe(0);
    expect(secondsUntil(null, NOW)).toBe(0);
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(600)).toBe('10:00');
  });

  it('status keys prefer the Ranger wording for Rangers, then fall back to the general one', () => {
    expect(statusKeys({ status: 'ARRIVED', viewerRole: 'WORKER' })).toEqual([
      'job.statusRanger.ARRIVED',
      'job.status.ARRIVED',
    ]);
    expect(statusKeys({ status: 'ARRIVED', viewerRole: 'CUSTOMER' })).toEqual([
      'job.status.ARRIVED',
    ]);
  });
});
