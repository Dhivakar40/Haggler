import { FeeService } from './fee.service';
import type { PrismaService } from '../prisma/prisma.service';

const makePrisma = (rows: { key: string; value: unknown }[]) =>
  ({
    systemConfig: { findMany: jest.fn().mockResolvedValue(rows) },
  }) as unknown as PrismaService;

describe('FeeService.computeFeePaise (Phase Commerce B2, labour-only since D-087)', () => {
  it('uses the default bps when no category override is set', async () => {
    const svc = new FeeService(makePrisma([]));
    // 8% of ₹1000 = ₹80, well above the ₹20 floor.
    expect(await svc.computeFeePaise(100_000, null)).toBe(8_000);
  });

  it('uses the category override when set', async () => {
    const svc = new FeeService(makePrisma([]));
    // 500 bps = 5% of ₹1000 = ₹50.
    expect(await svc.computeFeePaise(100_000, 500)).toBe(5_000);
  });

  it('floors at platform_fee_min_paise for a cheap job', async () => {
    const svc = new FeeService(makePrisma([]));
    // 8% of ₹50 = ₹4, below the ₹20 floor.
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
    expect(await svc.computeFeePaise(100_000, null)).toBe(8_000); // falls back to the default
  });
});

describe('FeeService.get (D-087: booleans and arrays merge too)', () => {
  it('cash is disabled by default', async () => {
    const svc = new FeeService(makePrisma([]));
    expect((await svc.get()).cash_enabled).toBe(false);
  });

  it('an admin-set boolean overrides the default', async () => {
    const svc = new FeeService(makePrisma([{ key: 'cash_enabled', value: true }]));
    expect((await svc.get()).cash_enabled).toBe(true);
  });

  it('ignores a wrong-typed override for a boolean key', async () => {
    const svc = new FeeService(makePrisma([{ key: 'cash_enabled', value: 'yes' }]));
    expect((await svc.get()).cash_enabled).toBe(false);
  });

  it('an admin-set array overrides the default visit-fee bands', async () => {
    const bands = [{ minDistanceM: 0, feePaise: 5000 }];
    const svc = new FeeService(makePrisma([{ key: 'visit_fee_bands', value: bands }]));
    expect((await svc.get()).visit_fee_bands).toEqual(bands);
  });
});

describe('FeeService.ceilingPaise (D-087 G1)', () => {
  it('uses the global default multiple (1.5x) when nothing overrides it', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.ceilingPaise(40_000, null, null)).toBe(60_000);
  });

  it('the item override wins over the category override and the global default', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.ceilingPaise(40_000, 12_000, 20_000)).toBe(48_000); // 1.2x, not 2x or 1.5x
  });

  it('the category override wins over the global default when there is no item override', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.ceilingPaise(40_000, null, 20_000)).toBe(80_000); // 2x
  });
});

describe('FeeService.visitFeePaise (D-087 H4)', () => {
  it('a short distance falls in the first band', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.visitFeePaise(2_000)).toBe(9_900);
  });

  it('a mid distance falls in the second band', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.visitFeePaise(6_000)).toBe(14_900);
  });

  it('exactly on a band boundary counts as that band, not the one below', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.visitFeePaise(15_000)).toBe(19_900);
  });

  it('a long distance falls in the last ("and beyond") band', async () => {
    const svc = new FeeService(makePrisma([]));
    expect(await svc.visitFeePaise(50_000)).toBe(19_900);
  });
});
