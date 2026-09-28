import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { StorageService } from '../adapters/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/crypto';
import { notFound } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from './addresses.service';

@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
    private readonly encryption: EncryptionService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly env: EnvService,
  ) {}

  /**
   * DPDP right of access: everything we hold about the person, in one JSON document.
   * Includes decrypted date of birth / Aadhaar last 4 (it is their own data). Never includes the
   * document images themselves; those are separate files and are described by type/status.
   */
  async exportData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        emergencyContacts: true,
        consents: true,
        devices: { select: { platform: true, lastSeenAt: true, createdAt: true } },
        workerProfile: {
          include: { categories: { include: { category: { select: { slug: true } } } } },
        },
        kycChecks: { include: { documents: true, reference: true } },
      },
    });
    if (!user) throw notFound('User not found');

    const wp = user.workerProfile;
    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        preferredLanguage: user.preferredLanguage,
        languages: user.languages,
        status: user.status,
        createdAt: user.createdAt,
        roles: user.roles.map((r) => r.role),
      },
      addresses: await this.addresses.list(userId),
      emergencyContacts: user.emergencyContacts.map(({ name, phone, relationship }) => ({
        name,
        phone,
        relationship,
      })),
      consents: user.consents.map(({ purpose, version, grantedAt, revokedAt }) => ({
        purpose,
        version,
        grantedAt,
        revokedAt,
      })),
      devices: user.devices,
      rangerProfile: wp && {
        kycTier: wp.kycTier,
        bio: wp.bio,
        experienceYears: wp.experienceYears,
        categories: wp.categories.map((c) => c.category.slug),
        aadhaarLast4: wp.aadhaarLast4Enc ? this.encryption.decrypt(wp.aadhaarLast4Enc) : null,
        dateOfBirth: wp.dateOfBirthEnc ? this.encryption.decrypt(wp.dateOfBirthEnc) : null,
      },
      verification: user.kycChecks.map((c) => ({
        tier: c.tier,
        provider: c.provider,
        status: c.status,
        submittedAt: c.submittedAt,
        decidedAt: c.decidedAt,
        reviewerMessage: c.reviewerMessage,
        reference: c.reference && {
          name: c.reference.name,
          phone: c.reference.phone,
          relationship: c.reference.relationship,
        },
        documents: c.documents.map((d) => ({
          type: d.type,
          status: d.status,
          uploadedAt: d.uploadedAt,
        })),
      })),
    };
  }

  /**
   * Anonymises accounts whose 30-day grace period has ended. Idempotent and safe to re-run.
   * Removes personal data and stored files; keeps the (identifier-free) audit trail.
   */
  async purgeDueDeletions(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: { status: 'DELETION_PENDING', deletionScheduledFor: { lte: now } },
      select: { id: true, phone: true },
    });
    for (const u of due) await this.purgeOne(u.id, u.phone);
    return due.length;
  }

  private async purgeOne(userId: string, phone: string): Promise<void> {
    const docs = await this.prisma.kycDocument.findMany({
      where: { userId, status: { not: 'DELETED' } },
      select: { bucket: true, storageKey: true },
    });
    for (const d of docs) {
      try {
        await this.storage.delete(d.bucket, d.storageKey);
      } catch (err) {
        // Abort this user: better to retry next run than to drop the row and orphan the file.
        this.logger.error(`Could not delete a stored file for user ${userId}: ${String(err)}`);
        return;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.otpAttempt.deleteMany({ where: { phone } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.device.deleteMany({ where: { userId } });
      await tx.kycCheck.deleteMany({ where: { userId } }); // cascades documents, reviews, reference
      await tx.workerProfile.deleteMany({ where: { userId } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.emergencyContact.deleteMany({ where: { userId } });
      await tx.consent.deleteMany({ where: { userId } });
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: `+99${String(randomInt(0, 1e12)).padStart(12, '0')}`, // tombstone; keeps the unique constraint valid
          fullName: null,
          photoUrl: null,
          languages: ['en'],
          preferredLanguage: 'en',
          phoneVerifiedAt: null,
          status: 'DELETED',
        },
      });
      await this.audit.record(
        { actorType: 'SYSTEM', action: 'account.purged', entityType: 'user', entityId: userId },
        tx,
      );
    });
    this.logger.log(`Purged account ${userId}`);
  }
}
