import type { PriceBandDto, PriceBandScope } from '@haggler/shared';

export interface PriceBandRow {
  scope: PriceBandScope;
  city: string | null;
  pincodePrefix: string | null;
  minPaise: number;
  medianPaise: number;
  maxPaise: number;
  sampleSize: number;
}

export interface ResolveInput {
  categorySlug: string;
  pincode?: string;
  city?: string;
  /** Minimum completed jobs a computed band needs before we trust it (system_config). */
  minSample: number;
}

/** Cluster = first 3 digits of the PIN code (the postal sorting district). */
export function pincodeCluster(pincode: string): string {
  return pincode.slice(0, 3);
}

/**
 * Pick the most local band we can trust (D3 fallback chain):
 *   1. PINCODE_CLUSTER band with sampleSize >= minSample
 *   2. CITY band with sampleSize >= minSample
 *   3. DEFAULT seeded band (always exists for an active category)
 *
 * Trace (minSample = 10):
 *   request: electrician, pincode 600042, city Chennai
 *   rows: cluster "600" n=4  -> too thin, skip
 *         city "Chennai" n=31 -> trusted, USE THIS (scope CITY)
 *   If the cluster row had n=12 it would win instead (more local beats more data).
 */
export function resolvePriceBand(input: ResolveInput, rows: PriceBandRow[]): PriceBandDto | null {
  const trusted = (r: PriceBandRow) => r.sampleSize >= input.minSample;

  const cluster = input.pincode ? pincodeCluster(input.pincode) : undefined;
  const byCluster = cluster
    ? rows.find((r) => r.scope === 'PINCODE_CLUSTER' && r.pincodePrefix === cluster && trusted(r))
    : undefined;

  const byCity = input.city
    ? rows.find(
        (r) =>
          r.scope === 'CITY' && r.city?.toLowerCase() === input.city?.toLowerCase() && trusted(r),
      )
    : undefined;

  const fallback = rows.find((r) => r.scope === 'DEFAULT');
  const chosen = byCluster ?? byCity ?? fallback;
  if (!chosen) return null;

  return {
    categorySlug: input.categorySlug,
    scope: chosen.scope,
    minPaise: chosen.minPaise,
    medianPaise: chosen.medianPaise,
    maxPaise: chosen.maxPaise,
    sampleSize: chosen.sampleSize,
    isSeededDefault: chosen.scope === 'DEFAULT',
  };
}
