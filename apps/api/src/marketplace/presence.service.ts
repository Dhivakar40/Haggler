import { Injectable } from '@nestjs/common';
import type { JobStatus } from '@prisma/client';
import { ACTIVE_JOB_STATES, type LocationUpdate, SOCKET_EVENTS } from '@haggler/shared';
import { conflict, forbidden, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { isInIndia } from '../users/addresses.service';
import { MarketplaceConfig } from './marketplace-config.service';
import type { Candidate } from './ranking';

export interface RawCandidate extends Candidate {
  distanceM: number;
}

/**
 * Ranger presence. "Online" means the Ranger said so AND their phone has sent a location recently
 * (a heartbeat). If the app is killed the heartbeat stops and the Ranger silently drops out of
 * matching within `presence_ttl_seconds`, so nobody is invited who cannot answer.
 * The source of truth is Postgres/PostGIS (GIST index), not Redis: matching keeps working when
 * Redis is down (D-029).
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: MarketplaceConfig,
    private readonly realtime: RealtimeService,
  ) {}

  private async setLocation(
    userId: string,
    latitude: number,
    longitude: number,
    online: boolean | undefined,
  ) {
    if (!isInIndia(latitude, longitude))
      throw unprocessable('Those coordinates are outside India.');
    await this.prisma.$executeRaw`
      UPDATE worker_profiles
      SET last_location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          last_location_at = now(),
          is_online = COALESCE(${online ?? null}::boolean, is_online),
          updated_at = now()
      WHERE user_id = ${userId}::uuid`;
  }

  async goOnline(userId: string, latitude: number, longitude: number) {
    const wp = await this.prisma.workerProfile.findUnique({
      where: { userId },
      include: { _count: { select: { categories: true } } },
    });
    if (!wp) throw forbidden('Become a Ranger first.');
    if (wp.kycTier < 2) throw forbidden('Finish verification level 2 before going online.');
    if (wp._count.categories === 0)
      throw unprocessable('Choose the work you do before going online.');
    await this.setLocation(userId, latitude, longitude, true);
    return { isOnline: true };
  }

  async goOffline(userId: string) {
    await this.prisma.workerProfile.updateMany({ where: { userId }, data: { isOnline: false } });
    return { isOnline: false };
  }

  async status(userId: string) {
    const cfg = await this.cfg.get();
    const rows = await this.prisma.$queryRaw<{ online: boolean }[]>`
      SELECT (is_online AND last_location_at > now() - make_interval(secs => ${cfg.presence_ttl_seconds})) AS online
      FROM worker_profiles WHERE user_id = ${userId}::uuid`;
    return { isOnline: rows[0]?.online ?? false };
  }

  /**
   * A location ping from the Ranger's phone (REST or WebSocket).
   * - always refreshes the heartbeat when online;
   * - while a job is active, also appends to the GPS trail (at most one row per
   *   `location_min_interval_seconds`) and pushes the point to the customer live.
   */
  async updateLocation(userId: string, loc: LocationUpdate) {
    const cfg = await this.cfg.get();
    const wp = await this.prisma.workerProfile.findUnique({ where: { userId } });
    if (!wp) throw forbidden('Only Rangers can send location.');
    await this.setLocation(userId, loc.latitude, loc.longitude, undefined);

    const job = await this.prisma.job.findFirst({
      where: { workerId: userId, status: { in: ACTIVE_JOB_STATES as JobStatus[] } },
      select: { id: true, customerId: true, status: true },
    });
    if (!job) return { recorded: false, jobId: null };

    const recent = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM job_locations
      WHERE job_id = ${job.id}::uuid AND worker_id = ${userId}::uuid
        AND recorded_at > now() - make_interval(secs => ${cfg.location_min_interval_seconds})`;
    const recorded = Number(recent[0]?.n ?? 0) === 0;
    if (recorded) {
      await this.prisma.$executeRaw`
        INSERT INTO job_locations (job_id, worker_id, location, accuracy_m)
        VALUES (${job.id}::uuid, ${userId}::uuid,
                ST_SetSRID(ST_MakePoint(${loc.longitude}, ${loc.latitude}), 4326)::geography, ${loc.accuracyM ?? null})`;
    }
    if (['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AGREED'].includes(job.status)) {
      this.realtime.emitToUser(job.customerId, SOCKET_EVENTS.location, {
        jobId: job.id,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracyM: loc.accuracyM ?? null,
        recordedAt: new Date().toISOString(),
      });
    }
    return { recorded, jobId: job.id };
  }

  /**
   * Eligible Rangers within `radiusM` of the request, excluding: offline/stale, tier < 2, wrong
   * category, on an active job, blocked in either direction with the customer, the customer
   * themself, and anyone already invited in this attempt. Returns raw candidates for ranking.
   */
  async findCandidates(input: {
    jobId: string;
    attempt: number;
    customerId: string;
    categoryId: string;
    longitude: number;
    latitude: number;
    radiusM: number;
  }): Promise<RawCandidate[]> {
    const cfg = await this.cfg.get();
    const active = ACTIVE_JOB_STATES as readonly string[];
    const rows = await this.prisma.$queryRaw<
      {
        user_id: string;
        distance_m: number;
        gender: 'FEMALE' | 'MALE' | 'OTHER' | null;
        badge: string | null;
        jobs7d: bigint;
        received: bigint;
        accepted: bigint;
      }[]
    >`
      SELECT wp.user_id::text AS user_id,
             ST_Distance(wp.last_location, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography)::int AS distance_m,
             wp.gender::text AS gender,
             ws.badge_tier::text AS badge,
             (SELECT count(*) FROM jobs j WHERE j.worker_id = wp.user_id AND j.created_at > now() - interval '7 days'
                AND j.status IN ('COMPLETED_BY_WORKER','CONFIRMED_BY_CUSTOMER','IN_PROGRESS','ARRIVED','EN_ROUTE','AGREED')) AS jobs7d,
             (SELECT count(*) FROM request_broadcasts rb WHERE rb.worker_id = wp.user_id AND rb.sent_at > now() - interval '30 days') AS received,
             (SELECT count(*) FROM request_broadcasts rb WHERE rb.worker_id = wp.user_id AND rb.sent_at > now() - interval '30 days' AND rb.response = 'ACCEPTED') AS accepted
      FROM worker_profiles wp
      JOIN users u ON u.id = wp.user_id AND u.status = 'ACTIVE'
      JOIN worker_categories wc ON wc.worker_profile_id = wp.id AND wc.category_id = ${input.categoryId}::uuid
      LEFT JOIN worker_stats ws ON ws.worker_user_id = wp.user_id
      WHERE wp.is_online
        AND wp.kyc_tier >= 2
        AND wp.last_location IS NOT NULL
        AND wp.last_location_at > now() - make_interval(secs => ${cfg.presence_ttl_seconds})
        AND ST_DWithin(wp.last_location, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography, ${input.radiusM})
        AND wp.user_id <> ${input.customerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM jobs aj WHERE aj.worker_id = wp.user_id AND aj.status::text = ANY(${active as string[]}))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${input.customerId}::uuid AND b.blocked_id = wp.user_id)
                                                  OR (b.blocker_id = wp.user_id AND b.blocked_id = ${input.customerId}::uuid))
        AND NOT EXISTS (SELECT 1 FROM request_broadcasts rb WHERE rb.job_id = ${input.jobId}::uuid AND rb.worker_id = wp.user_id AND rb.attempt = ${input.attempt})
      ORDER BY distance_m ASC
      LIMIT 200`;
    return rows.map((r) => ({
      userId: r.user_id,
      distanceM: r.distance_m,
      gender: r.gender,
      badgeTier: r.badge ?? 'BRONZE',
      jobsLast7d: Number(r.jobs7d),
      offersReceived: Number(r.received),
      offersAccepted: Number(r.accepted),
    }));
  }

  /** Latest known location of a Ranger (for the arrival geofence). */
  async lastLocation(
    userId: string,
  ): Promise<{ latitude: number; longitude: number; at: Date } | null> {
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number; at: Date }[]>`
      SELECT ST_Y(last_location::geometry) AS lat, ST_X(last_location::geometry) AS lng, last_location_at AS at
      FROM worker_profiles WHERE user_id = ${userId}::uuid AND last_location IS NOT NULL`;
    const r = rows[0];
    return r ? { latitude: r.lat, longitude: r.lng, at: r.at } : null;
  }

  assertNotBusy = async (userId: string) => {
    const busy = await this.prisma.job.count({
      where: { workerId: userId, status: { in: ACTIVE_JOB_STATES as JobStatus[] } },
    });
    if (busy > 0) throw conflict('You already have an active job.', { code: 'ALREADY_ON_JOB' });
  };
}
