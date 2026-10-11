import { FeeService } from './fee.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('FeeService.computeFeePaise (Phase Commerce B2)', () => {
  const makePrisma = (rows: { key: string; value: unknown }[]) =>
    ({
      systemConfig: { findMany: jest.fn().mockResolvedValue(rows) },
    }) as unknown as PrismaService;

  it('uses the default bps when no category override is set', async () => {
    const svc = new FeeService(makePrisma([]));
    // 10% of ₹1000 = ₹100, well above the ₹20 floor.
    expect(await svc.computeFeePaise(100_000, null)).toBe(10_000);
  });

  it('uses the category override when set', async () => {
    const svc = new FeeService(makePrisma([]));
    // 500 bps = 5% of ₹1000 = ₹50.
    expect(await svc.computeFeePaise(100_000, 500)).toBe(5_000);
  });

  it('floors at platform_fee_min_paise for a cheap job', async () => {
    const svc = new FeeService(makePrisma([]));
    // 10% of ₹50 = ₹5, below the ₹20 floor.
    expect(await svc.computeFeePaise(5_000, null)).toBe(2_000);
  });

  it('reads overridden config from system_config', async () => {
    const svc = new FeeService(
      makePrisma([
        { key: 'platform_fee_bps', value: 2000 },
        { key: 'platform_fee_min_paise', value: 1000 },
      ]),
    );
    // 20% of ₹1000 = ₹200.
    expect(await svc.computeFeePaise(100_000, null)).toBe(20_000);
  });

  it('ignores a non-numeric stored value rather than crashing', async () => {
    const svc = new FeeService(makePrisma([{ key: 'platform_fee_bps', value: 'oops' }]));
    expect(await svc.computeFeePaise(100_000, null)).toBe(10_000); // falls back to the default
  });
});
