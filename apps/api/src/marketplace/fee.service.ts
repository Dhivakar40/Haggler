import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** A visit-fee distance band: this fee applies once the Ranger travelled at least
 * `minDistanceM`. The last band (by minDistanceM, descending) is the "and beyond" case. */
export interface VisitFeeBand {
  minDistanceM: number;
  feePaise: number;
}

/** Phase Commerce (B2), extended D-087 "Phase Flow-Final": the platform fee and the new flow's
 * quote/visit-fee/payment tunables. Stored in system_config, same cached-read pattern as
 * MarketplaceConfig, so ops can change any of these without a deploy. */
export interface FeeSettings {
  /** Basis points of the LABOUR portion only (D-087 — used to be the whole service price),
   * e.g. 800 = 8%. */
  platform_fee_bps: number;
  /** Floor so a very cheap job still carries a meaningful fee. */
  platform_fee_min_paise: number;
  /** B5: a small discount off the total for paying online instead of cash. */
  online_payment_discount_bps: number;
  /** B4: a Ranger's new jobs pause once unpaid cash-job dues reach this amount. Dormant while
   * cash_enabled is false — a cash job can't exist to run up dues. */
  worker_dues_threshold_paise: number;
  /** D-087 (H1): in-app payment only by default. Flipping this to true is the one switch that
   * brings CASH back as a selectable payment method — the dues ledger above and every cash
   * code path stay exactly as they are, just reachable again. */
  cash_enabled: boolean;
  /** D-087 (G1): a labour item's ceiling = its floor (PriceListAddOn.pricePaise) × this, unless
   * the item or its category overrides it. 15000 = 1.5×. */
  quote_ceiling_multiple_bps: number;
  /** D-087 (G1): the capped "extra" line, as a percent of the quote's labour total. */
  quote_extra_cap_bps: number;
  /** D-087 (H4): visit-fee bands by distance travelled, admin-editable. Placeholder values. */
  visit_fee_bands: VisitFeeBand[];
  /** D-087 (H4): the Ranger's share of a charged visit fee; the platform keeps the rest. */
  visit_fee_worker_commission_bps: number;
  /** D-087 (H2/step 11): once payment succeeds, the Ranger's earnings auto-release after this
   * many hours if the customer hasn't shared/entered the completion code, unless a dispute is
   * open. */
  completion_otp_auto_release_hours: number;
  /** D-087 (I3): "Wait" extends a paused job; this caps how many times. */
  max_parts_extensions: number;
  /** D-087 (I4): how many jobs a Ranger may have PAUSED_PARTS at once. */
  max_concurrent_paused_jobs_per_worker: number;
  /** D-087: true routes a new match through the quote-first flow (travel, diagnose, quote,
   * accept/reject) instead of D-080's auto-agree-at-the-listed-price. Defaults to false — not
   * because the new flow isn't finished, but because this sandbox has no Postgres to run the
   * e2e suite against, so flipping every existing job's default behaviour with no way to
   * verify the consequence is a risk this round declines to take. The new flow is fully built
   * and has its own e2e coverage (run with the flag explicitly on); switching the default is a
   * one-line config change for whoever can actually run the full suite against it. */
  quote_flow_enabled: boolean;
  /** D-087 (H2/H3): once an ONLINE payment succeeds, require the server-generated completion
   * code (Job.completionCodeHash) to confirm, instead of a bare confirm(). Same risk-managed
   * default-false reasoning as quote_flow_enabled. DEVIATION from the master prompt's literal
   * wording: the prompt says the Ranger enters the code the customer shares; this round has the
   * CUSTOMER enter it instead (confirm() already belongs to the customer's auth path — giving
   * the Ranger an equivalent entry point means either duplicating confirm()'s settlement logic
   * in a second method or a riskier refactor of a transaction this project has never had a unit
   * test for). Flagged honestly in DECISIONS.md D-089, not silently done differently. */
  completion_otp_enabled: boolean;
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  platform_fee_bps: 800, // 8% default (D-087), on labour only
  platform_fee_min_paise: 2000, // ₹20 floor
  online_payment_discount_bps: 200, // 2%
  worker_dues_threshold_paise: 50_000, // ₹500
  cash_enabled: false,
  quote_ceiling_multiple_bps: 15_000, // 1.5x
  quote_extra_cap_bps: 1_000, // 10% of labour
  visit_fee_bands: [
    { minDistanceM: 0, feePaise: 9_900 }, // ₹99 placeholder
    { minDistanceM: 5_000, feePaise: 14_900 }, // ₹149 placeholder
    { minDistanceM: 15_000, feePaise: 19_900 }, // ₹199 placeholder
  ],
  visit_fee_worker_commission_bps: 9_000, // Ranger keeps 90%, platform keeps 10%
  completion_otp_auto_release_hours: 24,
  max_parts_extensions: 2,
  max_concurrent_paused_jobs_per_worker: 2,
  quote_flow_enabled: false,
  completion_otp_enabled: false,
};

/** Every key FeeService recognizes — the admin config endpoint's allowlist (admin-config.service.ts). */
export const FEE_SETTINGS_KEYS = Object.keys(DEFAULT_FEE_SETTINGS) as (keyof FeeSettings)[];

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
      const def = (DEFAULT_FEE_SETTINGS as unknown as Record<string, unknown>)[r.key];
      // Ignore a value of the wrong type rather than crash the marketplace on a typo — same
      // guard MarketplaceConfig uses, extended here to also accept booleans and arrays.
      if (Array.isArray(def) ? Array.isArray(r.value) : typeof r.value === typeof def)
        merged[r.key] = r.value;
    }
    const value = merged as unknown as FeeSettings;
    this.cache = { at: now, value };
    return value;
  }

  refresh(): void {
    this.cache = null;
  }

  /** The platform fee for one job's LABOUR portion (D-087 — parts and the capped extra carry
   * no fee): `categoryFeeBps` overrides the global default when set (ServiceCategory.feeBps),
   * floored at `platform_fee_min_paise` so a cheap job isn't fee-free. */
  async computeFeePaise(labourPaise: number, categoryFeeBps: number | null): Promise<number> {
    const cfg = await this.get();
    const bps = categoryFeeBps ?? cfg.platform_fee_bps;
    const raw = Math.round((labourPaise * bps) / 10_000);
    return Math.max(raw, cfg.platform_fee_min_paise);
  }

  /** D-087 (G1): a labour item's ceiling given its floor and any item/category override. */
  async ceilingPaise(
    floorPaise: number,
    itemOverrideBps: number | null,
    categoryOverrideBps: number | null,
  ): Promise<number> {
    const cfg = await this.get();
    const bps = itemOverrideBps ?? categoryOverrideBps ?? cfg.quote_ceiling_multiple_bps;
    return Math.round((floorPaise * bps) / 10_000);
  }

  /** D-087 (H4): the visit fee for a given travelled distance — the highest band whose
   * minDistanceM the distance has reached, or the first band if somehow none match. */
  async visitFeePaise(distanceM: number): Promise<number> {
    const cfg = await this.get();
    const bands = [...cfg.visit_fee_bands].sort((a, b) => a.minDistanceM - b.minDistanceM);
    const match = [...bands].reverse().find((b) => distanceM >= b.minDistanceM);
    return (match ?? bands[0])?.feePaise ?? 0;
  }
}
