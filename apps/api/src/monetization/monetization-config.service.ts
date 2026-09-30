import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Tunable Phase 9 monetization rules, stored in system_config so ops can change them without a
 * deploy (same pattern as MarketplaceConfig/ReputationConfig/CampusConfig). */
export interface MonetizationSettings {
  /** Rush fee: a customer-paid, one-off fee to skip wave sequencing on one request (D-069). */
  rush_fee_paise: number;
  /** Boosted listing fee: an employer-paid, one-off fee for higher placement of one Contract or
   * Campus listing, for boost_duration_days (D-069). */
  boost_fee_paise: number;
  boost_duration_days: number;
}

export const DEFAULT_MONETIZATION_SETTINGS: MonetizationSettings = {
  rush_fee_paise: 4900, // ₹49
  boost_fee_paise: 19900, // ₹199
  boost_duration_days: 7,
};

const KEY = 'monetization_settings';

@Injectable()
export class MonetizationConfig {
  private cache: { at: number; value: MonetizationSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<MonetizationSettings> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: KEY } });
    const stored = row?.value as Partial<MonetizationSettings> | undefined;
    const value: MonetizationSettings = {
      rush_fee_paise:
        typeof stored?.rush_fee_paise === 'number'
          ? stored.rush_fee_paise
          : DEFAULT_MONETIZATION_SETTINGS.rush_fee_paise,
      boost_fee_paise:
        typeof stored?.boost_fee_paise === 'number'
          ? stored.boost_fee_paise
          : DEFAULT_MONETIZATION_SETTINGS.boost_fee_paise,
      boost_duration_days:
        typeof stored?.boost_duration_days === 'number'
          ? stored.boost_duration_days
          : DEFAULT_MONETIZATION_SETTINGS.boost_duration_days,
    };
    this.cache = { at: now, value };
    return value;
  }

  /** Tests and admin edits call this so a change is visible immediately. */
  refresh(): void {
    this.cache = null;
  }
}
