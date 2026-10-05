import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CLIENT_LEAGUE_THRESHOLDS,
  isValidClientThresholds,
  type ClientLeagueThreshold,
} from './client-league-tier';
import { DEFAULT_LEAGUE_THRESHOLDS, isValidThresholds, type LeagueThreshold } from './league-tier';

const CONFIG_KEY = 'league_thresholds';
const CLIENT_CONFIG_KEY = 'client_league_thresholds';

/** Reads the league ladder(s) from system_config (ops-tunable without a deploy), same
 * caching/override pattern as MarketplaceConfig. Falls back to the built-in defaults if unset or
 * malformed. One service covers both ladders (Ranger and client) since they share the same
 * caching shape and are always read together by anything that needs reputation config. */
@Injectable()
export class ReputationConfig {
  private cache: { at: number; value: readonly LeagueThreshold[] } | null = null;
  private clientCache: { at: number; value: readonly ClientLeagueThreshold[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async leagueThresholds(): Promise<readonly LeagueThreshold[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 15_000) return this.cache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const value = isValidThresholds(row?.value) ? row.value : DEFAULT_LEAGUE_THRESHOLDS;
    this.cache = { at: now, value };
    return value;
  }

  async clientLeagueThresholds(): Promise<readonly ClientLeagueThreshold[]> {
    const now = Date.now();
    if (this.clientCache && now - this.clientCache.at < 15_000) return this.clientCache.value;
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CLIENT_CONFIG_KEY } });
    const value = isValidClientThresholds(row?.value)
      ? row.value
      : DEFAULT_CLIENT_LEAGUE_THRESHOLDS;
    this.clientCache = { at: now, value };
    return value;
  }

  refresh(): void {
    this.cache = null;
    this.clientCache = null;
  }
}
