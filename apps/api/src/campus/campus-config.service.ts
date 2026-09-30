import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Tunable Campus rules, stored in system_config so ops can change them without a deploy (same
 * pattern as MarketplaceConfig/ReputationConfig). */
export interface CampusSettings {
  /** Weekly hours cap across a student's HIRED Campus jobs (D-061). */
  weekly_hours_cap: number;
}

export const DEFAULT_CAMPUS_SETTINGS: CampusSettings = {
  weekly_hours_cap: 20,
};

const KEY = 'campus_settings';

@Injectable()
export class CampusConfig {
  private cache: { at: number; value: CampusSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<CampusSettings> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: KEY } });
    const stored = row?.value as Partial<CampusSettings> | undefined;
    const value: CampusSettings = {
      weekly_hours_cap:
        typeof stored?.weekly_hours_cap === 'number'
          ? stored.weekly_hours_cap
          : DEFAULT_CAMPUS_SETTINGS.weekly_hours_cap,
    };
    this.cache = { at: now, value };
    return value;
  }

  /** Tests and admin edits call this so a change is visible immediately. */
  refresh(): void {
    this.cache = null;
  }
}
