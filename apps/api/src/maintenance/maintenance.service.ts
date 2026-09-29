import { Injectable, Logger } from '@nestjs/common';
import { KycService } from '../kyc/kyc.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountLifecycleService } from '../users/account-lifecycle.service';

const DAY = 86_400_000;
export const MAINTENANCE_JOBS = [
  'purge-accounts',
  'purge-kyc-images',
  'trim-auth-data',
  'trim-gps-trails',
] as const;
export type MaintenanceJob = (typeof MAINTENANCE_JOBS)[number];

/**
 * Retention and housekeeping (docs/COMPLIANCE.md). Each task is idempotent and returns how many
 * rows it touched, so BullMQ can retry safely and the count shows up in the job result.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly kyc: KycService,
  ) {}

  run(job: MaintenanceJob, now = new Date()): Promise<number> {
    switch (job) {
      case 'purge-accounts':
        return this.lifecycle.purgeDueDeletions(now);
      case 'purge-kyc-images':
        return this.kyc.purgeExpiredImages(now);
      case 'trim-auth-data':
        return this.trimAuthData(now);
      case 'trim-gps-trails':
        return this.trimGpsTrails(now);
    }
  }

  /** OTP attempts older than 30 days, and refresh tokens that expired or were revoked over 30 days ago. */
  async trimAuthData(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * DAY);
    const otp = await this.prisma.otpAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const tokens = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    this.logger.log(`trimmed ${otp.count} OTP rows and ${tokens.count} refresh tokens`);
    return otp.count + tokens.count;
  }

  /** GPS trails are personal location history: keep them 90 days after the job ended, then delete. */
  async trimGpsTrails(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 90 * DAY);
    const res = await this.prisma.$executeRaw`
      DELETE FROM job_locations jl USING jobs j
      WHERE jl.job_id = j.id
        AND j.status IN ('CONFIRMED_BY_CUSTOMER','CANCELLED','NO_SHOW_WORKER','NO_SHOW_CUSTOMER','REFUNDED')
        AND j.updated_at < ${cutoff}`;
    this.logger.log(`trimmed ${res} GPS points`);
    return res;
  }
}
