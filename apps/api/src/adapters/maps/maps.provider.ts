import { Injectable, Logger, Module } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Swappable geocoder (D-021): OSM/Nominatim now; a hosted provider or Google later. */
export interface MapsProvider {
  readonly mode: 'sandbox' | 'osm';
  geocode(query: string): Promise<GeoPoint | null>;
}

export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');

/** Sandbox: does not geocode. Clients send coordinates from device GPS instead. */
@Injectable()
export class SandboxMapsProvider implements MapsProvider {
  readonly mode = 'sandbox' as const;
  async geocode(): Promise<GeoPoint | null> {
    return null;
  }
}

/**
 * OpenStreetMap Nominatim. Free, no key, but the public server's policy allows at most 1 request
 * per second, requires an identifying User-Agent and forbids bulk/autocomplete use. So we
 * serialise calls with a 1.1 s gap. For production use a hosted or self-hosted instance.
 */
@Injectable()
export class NominatimMapsProvider implements MapsProvider {
  readonly mode = 'osm' as const;
  private readonly logger = new Logger('Nominatim');
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly env: EnvService) {}

  geocode(query: string): Promise<GeoPoint | null> {
    const run = this.chain.then(() => this.lookup(query));
    // Keep the queue moving whatever happens, and pace the next request.
    this.chain = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
    return run;
  }

  private async lookup(query: string): Promise<GeoPoint | null> {
    const { NOMINATIM_URL, NOMINATIM_USER_AGENT } = this.env.env;
    const url = new URL('/search', NOMINATIM_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'in');
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': NOMINATIM_USER_AGENT ?? 'haggler' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as { lat: string; lon: string }[];
      const first = rows[0];
      return first ? { latitude: Number(first.lat), longitude: Number(first.lon) } : null;
    } catch (err) {
      this.logger.warn(`geocode failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

@Module({
  providers: [
    SandboxMapsProvider,
    NominatimMapsProvider,
    {
      provide: MAPS_PROVIDER,
      inject: [EnvService, SandboxMapsProvider, NominatimMapsProvider],
      useFactory: (
        env: EnvService,
        sandbox: SandboxMapsProvider,
        osm: NominatimMapsProvider,
      ): MapsProvider => (env.env.MAPS_MODE === 'osm' ? osm : sandbox),
    },
  ],
  exports: [MAPS_PROVIDER],
})
export class MapsModule {}
