import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Phase Commerce (B2): the platform fee, replacing the token system. Stored in system_config,
 * same cached-read pattern as MarketplaceConfig, so ops can change the default without a deploy. */
export interface FeeSettings {
  /** Basis points of the service price, e.g. 1000 = 10%. */
  platform_fee_bps: number;
  /** Floor so a very cheap job still carries a meaningful fee. */
  platform_fee_min_paise: number;
  /** B5: a small discount off the total for paying online instead of cash. */
  online_payment_discount_bps: number;
  /** B4: a Ranger's new jobs pause once unpaid cash-job dues reach this amount. */
  worker_dues_threshold_paise: number;
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  platform_fee_bps: 1000, // 10% default, per the master prompt's decision
  platform_fee_min_paise: 2000, // ₹20 floor
  online_payment_discount_bps: 200, // 2%
  worker_dues_threshold_paise: 50_000, // ₹500
};

@Injectable()
export class FeeService {
  private cache: { at: number; value: FeeSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<FeeSettings> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: Object.keys(DEFAULT_FEE_SETTINGS) } },
    });
    const merged: Record<string, unknown> = { ...DEFAULT_FEE_SETTINGS };
    for (const r of rows) {
      if (typeof r.value === 'number') merged[r.key] = r.value;
    }
    const value = merged as unknown as FeeSettings;
    this.cache = { at: now, value };
    return value;
  }

  refresh(): void {
    this.cache = null;
  }

  /** The platform fee for one job: `categoryFeeBps` overrides the global default when set
   * (ServiceCategory.feeBps), floored at `platform_fee_min_paise` so cheap jobs aren't fee-free. */
  async computeFeePaise(pricePaise: number, categoryFeeBps: number | null): Promise<number> {
    const cfg = await this.get();
    const bps = categoryFeeBps ?? cfg.platform_fee_bps;
    const raw = Math.round((pricePaise * bps) / 10_000);
    return Math.max(raw, cfg.platform_fee_min_paise);
  }
}
