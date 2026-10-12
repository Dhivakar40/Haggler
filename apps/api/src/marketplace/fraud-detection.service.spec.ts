import { FraudDetectionService } from './fraud-detection.service';
import type { FeeService } from './fee.service';

const WORKER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOMER_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const BASE_CFG = {
  fraud_velocity_max_jobs: 5,
  fraud_velocity_window_hours: 24,
  fraud_repeat_pair_max_count: 3,
  fraud_repeat_pair_window_days: 30,
  fraud_min_job_value_paise: 5_000,
};

function job(customerId: string, hoursAgo: number, agreedPricePaise = 10_000) {
  return {
    id: `job-${Math.random()}`,
    customerId,
    confirmedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    agreedPricePaise,
  };
}

function makeDeps(jobs: ReturnType<typeof job>[], cfgOverrides: Partial<typeof BASE_CFG> = {}) {
  const findFirst = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue(undefined);
  const tx = {
    job: { findMany: jest.fn().mockResolvedValue(jobs) },
    fraudReviewItem: { findFirst, create },
  } as unknown as Parameters<FraudDetectionService['checkWorkerPromotion']>[0];
  const fee = { get: jest.fn().mockResolvedValue({ ...BASE_CFG, ...cfgOverrides }) } as unknown as FeeService;
  return { tx, fee, findFirst, create };
}

describe('FraudDetectionService (D-093 Sub-phase K1) — queues only, never changes balances/leagues', () => {
  it('flags VELOCITY when enough jobs were confirmed within the window', async () => {
    const jobs = Array.from({ length: 6 }, (_, i) => job(`cust-${i}`, 1));
    const { tx, fee, create } = makeDeps(jobs);
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'VELOCITY', subjectUserId: WORKER_ID, relatedUserId: null }),
      }),
    );
  });

  it('does not flag VELOCITY when under the threshold', async () => {
    const jobs = Array.from({ length: 4 }, (_, i) => job(`cust-${i}`, 1));
    const { tx, fee, create } = makeDeps(jobs);
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');
    expect(create).not.toHaveBeenCalled();
  });

  it('flags REPEAT_PAIR when one customer accounts for enough of the recent jobs', async () => {
    const jobs = [job(CUSTOMER_A, 1), job(CUSTOMER_A, 2), job(CUSTOMER_A, 3), job(CUSTOMER_B, 4)];
    const { tx, fee, create } = makeDeps(jobs);
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'REPEAT_PAIR',
          subjectUserId: WORKER_ID,
          relatedUserId: CUSTOMER_A,
        }),
      }),
    );
    // CUSTOMER_B only appears once — never flagged.
    expect(create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relatedUserId: CUSTOMER_B }),
      }),
    );
  });

  it('flags LOW_VALUE when most recent jobs are below the minimum', async () => {
    const jobs = [
      job(CUSTOMER_A, 1, 1_000),
      job(CUSTOMER_B, 2, 1_000),
      job(CUSTOMER_A, 3, 1_000),
      job(CUSTOMER_B, 4, 50_000),
    ];
    const { tx, fee, create } = makeDeps(jobs);
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'LOW_VALUE' }) }),
    );
  });

  it('does not re-flag a kind that already has an open item for the same subject', async () => {
    const jobs = Array.from({ length: 6 }, (_, i) => job(`cust-${i}`, 1));
    const { tx, fee, create, findFirst } = makeDeps(jobs);
    findFirst.mockResolvedValue({ id: 'existing-flag' });
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores jobs outside both lookback windows', async () => {
    const jobs = [job(CUSTOMER_A, 24 * 40)]; // 40 days old — outside the 30-day pair window too
    const { tx, fee, create } = makeDeps(jobs);
    const svc = new FraudDetectionService(fee);
    await svc.checkWorkerPromotion(tx, WORKER_ID, 'GOLD');
    expect(create).not.toHaveBeenCalled();
  });
});
