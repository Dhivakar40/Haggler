import type { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Great-circle distance in metres (haversine). Used for the arrival geofence and "how far did
 * the Ranger travel" (cancellation fee). Matching itself uses PostGIS `ST_DWithin` in the database.
 * Trace: Chennai Central (13.0827,80.2707) to Marina Beach (13.0500,80.2824) is about 3.8 km.
 */
export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line distance between the first and latest GPS points recorded on this job. Used
 * for the cancellation-fee travel check (lifecycle.service.ts) and, since D-087, the
 * visit-fee distance band on a rejected quote (quotes.service.ts). */
export async function travelledMeters(prisma: PrismaService, jobId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ d: number | null }[]>`
    SELECT ST_Distance(
             (SELECT location FROM job_locations WHERE job_id = ${jobId}::uuid ORDER BY recorded_at ASC LIMIT 1),
             (SELECT location FROM job_locations WHERE job_id = ${jobId}::uuid ORDER BY recorded_at DESC LIMIT 1))::float AS d`;
  return rows[0]?.d ?? 0;
}
