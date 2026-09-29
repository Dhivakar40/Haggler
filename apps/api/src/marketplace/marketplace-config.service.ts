import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Tunable marketplace rules. Stored in system_config so ops can change them without a deploy. */
export interface MarketplaceSettings {
  broadcast_radii_m: number[];
  broadcast_wave_size: number;
  broadcast_wave_interval_seconds: number;
  offer_ttl_seconds: number;
  presence_ttl_seconds: number;
  arrival_geofence_m: number;
  customer_no_show_minutes: number;
  worker_no_show_minutes: number;
  cancel_fee_travel_m: number;
  max_open_jobs_per_customer: number;
  sla_default_minutes: number;
  sla_min_samples: number;
  scheduled_lead_minutes: number;
  timed_out_cancel_minutes: number;
  negotiation_idle_minutes: number;
  location_min_interval_seconds: number;
  arrival_code_max_tries: number;
}

export const DEFAULT_SETTINGS: MarketplaceSettings = {
  broadcast_radii_m: [2000, 5000, 10000], // D3: 2 km, then 5 km, then 10 km
  broadcast_wave_size: 5,
  broadcast_wave_interval_seconds: 60,
  offer_ttl_seconds: 300,
  presence_ttl_seconds: 120,
  arrival_geofence_m: 500,
  customer_no_show_minutes: 15,
  worker_no_show_minutes: 30,
  cancel_fee_travel_m: 1000,
  max_open_jobs_per_customer: 3,
  sla_default_minutes: 4,
  sla_min_samples: 5,
  scheduled_lead_minutes: 60,
  timed_out_cancel_minutes: 120,
  negotiation_idle_minutes: 30,
  location_min_interval_seconds: 4,
  arrival_code_max_tries: 5,
};

/** Reads settings from system_config, with safe defaults, cached briefly. */
@Injectable()
export class MarketplaceConfig {
  private cache: { at: number; value: MarketplaceSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<MarketplaceSettings> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
    });
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[r.key];
      // Ignore a value of the wrong type rather than crash the marketplace on a typo.
      if (Array.isArray(def) ? Array.isArray(r.value) : typeof r.value === typeof def)
        merged[r.key] = r.value;
    }
    const value = merged as unknown as MarketplaceSettings;
    this.cache = { at: now, value };
    return value;
  }

  /** Tests and admin edits call this so a change is visible immediately. */
  refresh(): void {
    this.cache = null;
  }
}
