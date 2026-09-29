import { Injectable } from '@nestjs/common';
import type { ConsentInput, Me, ProfileUpdate, RegisterPushTokenInput } from '@haggler/shared';
import { CONSENT_PURPOSES, LEGAL_VERSION } from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';

export const DELETION_GRACE_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  async getMe(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        workerProfile: { select: { kycTier: true } },
        consents: { where: { revokedAt: null, version: LEGAL_VERSION }, select: { purpose: true } },
      },
    });
    if (!user) throw notFound('User not found');
    const granted = new Set(user.consents.map((c) => c.purpose));
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      photoUrl: user.photoUrl,
      preferredLanguage: user.preferredLanguage as Me['preferredLanguage'],
      languages: user.languages,
      roles: user.roles.map((r) => r.role),
      status: user.status,
      missingConsents: CONSENT_PURPOSES.filter((p) => !granted.has(p)),
      workerKycTier: user.workerProfile?.kycTier ?? null,
    };
  }

  async updateProfile(userId: string, input: ProfileUpdate): Promise<Me> {
    await this.prisma.user.update({ where: { id: userId }, data: input });
    return this.getMe(userId);
  }

  /**
   * Records a device's Expo/FCM push token (Phase 5). The device row itself is created at
   * sign-in (`AuthService.verifyOtp`); a stranger's `deviceId` guessed at this endpoint simply
   * matches no row for this user and updates nothing — it can never attach a token to someone
   * else's device.
   */
  async registerPushToken(userId: string, input: RegisterPushTokenInput): Promise<{ ok: true }> {
    await this.prisma.device.updateMany({
      where: { userId, deviceId: input.deviceId },
      data: { pushToken: input.pushToken, lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  /** Adds a role. Adding WORKER (Ranger) also creates the Ranger profile. */
  async addRole(userId: string, role: 'CUSTOMER' | 'WORKER' | 'EMPLOYER'): Promise<Me> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: { userId_role: { userId, role } },
        update: {},
        create: { userId, role },
      });
      if (role === 'WORKER') {
        await tx.workerProfile.upsert({ where: { userId }, update: {}, create: { userId } });
      }
    });
    return this.getMe(userId);
  }

  async grantConsent(userId: string, input: ConsentInput, ip: string | undefined) {
    if (input.version !== LEGAL_VERSION) {
      throw unprocessable('These terms have been updated. Please review the latest version.', {
        currentVersion: LEGAL_VERSION,
      });
    }
    const existing = await this.prisma.consent.findFirst({
      where: { userId, purpose: input.purpose, version: input.version, revokedAt: null },
    });
    if (existing)
      return {
        purpose: existing.purpose,
        version: existing.version,
        grantedAt: existing.grantedAt,
      };
    const row = await this.prisma.consent.create({
      data: { userId, purpose: input.purpose, version: input.version, ip },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'consent.granted',
      entityType: 'consent',
      entityId: row.id,
      after: { purpose: row.purpose, version: row.version },
      ip,
    });
    return { purpose: row.purpose, version: row.version, grantedAt: row.grantedAt };
  }

  async withdrawConsent(
    userId: string,
    purpose: (typeof CONSENT_PURPOSES)[number],
    ip: string | undefined,
  ) {
    const res = await this.prisma.consent.updateMany({
      where: { userId, purpose, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count > 0) {
      await this.audit.record({
        actorType: 'USER',
        actorId: userId,
        action: 'consent.withdrawn',
        entityType: 'consent',
        entityId: userId,
        after: { purpose },
        ip,
      });
    }
    return { withdrawn: res.count > 0 };
  }

  listConsents(userId: string) {
    return this.prisma.consent.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
      select: { purpose: true, version: true, grantedAt: true, revokedAt: true },
    });
  }

  /** DPDP erasure request: sessions end now; data is anonymised after a grace period (D-024). */
  async requestDeletion(userId: string, ip: string | undefined) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User not found');
    if (user.status === 'DELETION_PENDING') {
      return { status: 'DELETION_PENDING' as const, scheduledFor: user.deletionScheduledFor };
    }
    if (user.status !== 'ACTIVE') throw conflict('This account cannot be deleted right now.');
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'DELETION_PENDING',
          deletionRequestedAt: now,
          deletionScheduledFor: scheduledFor,
        },
      });
      await this.tokens.revokeAllForUser(userId, tx);
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: userId,
          action: 'account.deletion_requested',
          entityType: 'user',
          entityId: userId,
          after: { scheduledFor: scheduledFor.toISOString() },
          ip,
        },
        tx,
      );
    });
    return { status: 'DELETION_PENDING' as const, scheduledFor };
  }
}
