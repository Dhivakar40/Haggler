import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, ERROR_CODES, type AdminKycDecision, toPage } from '@haggler/shared';
import { StorageService } from '../adapters/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/crypto';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { isAdult, isValidPastDate } from '../kyc/kyc.rules';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthAdmin } from '../common/decorators';

export const maskPhone = (phone: string): string =>
  `${phone.slice(0, 3)}${'X'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`;

@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Oldest first: people who have waited longest are reviewed first. */
  async queue(
    status: 'PENDING_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED',
    cursor: string | undefined,
    limit: number,
  ) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.KycCheckWhereInput = c
      ? {
          OR: [
            { submittedAt: { gt: new Date(c.k) } },
            { submittedAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.kycCheck.findMany({
      where: { status, submittedAt: { not: null }, ...after },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        _count: { select: { documents: true } },
      },
    });
    const page = toPage(rows, limit, (r) => ({
      k: (r.submittedAt as Date).toISOString(),
      id: r.id,
    }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        tier: r.tier,
        status: r.status,
        provider: r.provider,
        submittedAt: r.submittedAt,
        user: { id: r.user.id, fullName: r.user.fullName, phoneMasked: maskPhone(r.user.phone) },
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Every view of identity documents is audit-logged (who looked at whose documents, and when). */
  async detail(id: string, admin: AuthAdmin, ip: string | undefined) {
    const check = await this.prisma.kycCheck.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            workerProfile: {
              include: { categories: { include: { category: { select: { slug: true } } } } },
            },
          },
        },
        documents: { where: { status: 'UPLOADED' } },
        reference: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { adminUser: { select: { email: true } } },
        },
      },
    });
    if (!check) throw notFound('Verification not found');

    const documents = await Promise.all(
      check.documents.map(async (d) => ({
        id: d.id,
        type: d.type,
        contentType: d.contentType,
        // Short-lived link so the reviewer's browser can show the image; never stored or logged.
        url: await this.storage.presignDownload(d.bucket, d.storageKey, 120),
      })),
    );
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'kyc.documents_viewed',
      entityType: 'kyc_check',
      entityId: check.id,
      after: { types: documents.map((d) => d.type) },
      ip,
    });

    return {
      id: check.id,
      tier: check.tier,
      status: check.status,
      provider: check.provider,
      submittedAt: check.submittedAt,
      reviewerMessage: check.reviewerMessage,
      user: {
        id: check.user.id,
        fullName: check.user.fullName,
        phoneMasked: maskPhone(check.user.phone),
      },
      ranger: {
        kycTier: check.user.workerProfile?.kycTier ?? 0,
        categorySlugs: check.user.workerProfile?.categories.map((c) => c.category.slug) ?? [],
      },
      documents,
      reference: check.reference && {
        name: check.reference.name,
        phone: check.reference.phone,
        relationship: check.reference.relationship,
        callOutcome: check.reference.callOutcome,
        callNotes: check.reference.callNotes,
      },
      reviews: check.reviews.map((r) => ({
        decision: r.decision,
        reason: r.reason,
        by: r.adminUser.email,
        at: r.createdAt,
      })),
    };
  }

  async decide(id: string, admin: AuthAdmin, body: AdminKycDecision, ip: string | undefined) {
    const check = await this.prisma.kycCheck.findUnique({
      where: { id },
      include: { reference: true },
    });
    if (!check) throw notFound('Verification not found');
    if (check.status !== 'PENDING_REVIEW')
      throw conflict('This verification is not waiting for review.', { status: check.status });

    let encrypted: { aadhaarLast4Enc: string; dateOfBirthEnc: string } | undefined;
    if (body.decision === 'APPROVE') {
      if (check.tier === 1) {
        if (!body.aadhaarLast4 || !body.dateOfBirth) {
          throw unprocessable(
            'Approving identity needs the Aadhaar last 4 digits and date of birth.',
            {
              missing: ['aadhaarLast4', 'dateOfBirth'].filter(
                (k) => !body[k as 'aadhaarLast4' | 'dateOfBirth'],
              ),
            },
          );
        }
        const today = new Date();
        if (!isValidPastDate(body.dateOfBirth, today))
          throw unprocessable('That date of birth is not a valid past date.');
        if (!isAdult(body.dateOfBirth, today)) {
          // Hard block (D-018): a minor can never be verified. Record the attempt.
          await this.audit.record({
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'kyc.approval_blocked_underage',
            entityType: 'kyc_check',
            entityId: id,
            ip,
          });
          throw unprocessable(
            'This person is under 18 and cannot be verified. Reject the request instead.',
            undefined,
            ERROR_CODES.UNDERAGE,
          );
        }
        encrypted = {
          aadhaarLast4Enc: this.encryption.encrypt(body.aadhaarLast4),
          dateOfBirthEnc: this.encryption.encrypt(body.dateOfBirth),
        };
      } else if (check.tier === 2) {
        if (body.referenceCall?.outcome !== 'VERIFIED') {
          throw unprocessable(
            'Log a successful reference call (outcome VERIFIED) before approving tier 2.',
          );
        }
      }
    }

    const status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_INFO: 'NEEDS_INFO' }[
      body.decision
    ] as 'APPROVED' | 'REJECTED' | 'NEEDS_INFO';
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Atomic claim: if two reviewers act at once, exactly one decision is recorded.
      const claimed = await tx.kycCheck.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data: {
          status,
          decidedAt: now,
          reviewerMessage: body.decision === 'APPROVE' ? null : (body.reason ?? null),
        },
      });
      if (claimed.count !== 1) throw conflict('Someone else already decided this verification.');

      await tx.kycReview.create({
        data: {
          kycCheckId: id,
          adminUserId: admin.id,
          decision: body.decision,
          reason: body.reason ?? null,
        },
      });

      if (check.reference && body.referenceCall) {
        await tx.professionalReference.update({
          where: { kycCheckId: id },
          data: {
            callOutcome: body.referenceCall.outcome,
            callNotes: body.referenceCall.notes ?? null,
            calledAt: now,
            calledBy: admin.id,
          },
        });
      }

      if (body.decision === 'APPROVE') {
        const wp = await tx.workerProfile.findUniqueOrThrow({ where: { userId: check.userId } });
        await tx.workerProfile.update({
          where: { id: wp.id },
          data: { kycTier: Math.max(wp.kycTier, check.tier), ...(encrypted ?? {}) },
        });
      }

      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: `kyc.${body.decision.toLowerCase()}`,
          entityType: 'kyc_check',
          entityId: id,
          before: { status: check.status },
          after: { status, tier: check.tier },
          ip,
        },
        tx,
      );
    });
    return { id, status };
  }
}
