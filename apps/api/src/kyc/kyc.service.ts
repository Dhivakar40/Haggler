import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type KycCheckDto,
  type KycDocumentRequest,
  type KycPresign,
  type KycStatus,
  type KycSubmitInput,
  LEGAL_VERSION,
} from '@haggler/shared';
import { KYC_PROVIDER, type KycProvider } from '../adapters/kyc/kyc.provider';
import { StorageService } from '../adapters/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CodedException, conflict, notFound, unprocessable } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  extensionFor,
  isMimeAllowed,
  isTypeAllowedForTier,
  missingDocuments,
  REQUIRED_DOCUMENTS,
} from './kyc.rules';

const OPEN = ['DRAFT', 'NEEDS_INFO', 'PENDING_REVIEW'] as const;
const EDITABLE = ['DRAFT', 'NEEDS_INFO'] as const;

type CheckWithDocs = Prisma.KycCheckGetPayload<{ include: { documents: true } }>;

export function toCheckDto(c: CheckWithDocs): KycCheckDto {
  return {
    id: c.id,
    tier: c.tier,
    status: c.status,
    reviewerMessage: c.reviewerMessage,
    submittedAt: c.submittedAt?.toISOString() ?? null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    requiredDocuments: REQUIRED_DOCUMENTS[c.tier as 1 | 2] ?? [],
    documents: c.documents
      .filter((d) => d.status !== 'DELETED')
      .map((d) => ({ id: d.id, type: d.type, status: d.status })),
  };
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly env: EnvService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  /** Opens (or returns the already-open) verification check for a tier. Idempotent. */
  async start(userId: string, tier: 1 | 2): Promise<KycCheckDto> {
    const consent = await this.prisma.consent.findFirst({
      where: { userId, purpose: 'KYC_PROCESSING', version: LEGAL_VERSION, revokedAt: null },
    });
    if (!consent) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.CONSENT_REQUIRED,
        'We need your consent to process your identity documents.',
        { purpose: 'KYC_PROCESSING', version: LEGAL_VERSION },
      );
    }
    const wp = await this.prisma.workerProfile.findUniqueOrThrow({ where: { userId } });
    if (wp.kycTier >= tier) throw conflict(`You are already verified at tier ${wp.kycTier}.`);
    if (tier === 2 && wp.kycTier < 1)
      throw unprocessable('Complete identity verification (tier 1) first.');

    const find = () =>
      this.prisma.kycCheck.findFirst({
        where: { userId, tier, status: { in: [...OPEN] } },
        include: { documents: true },
      });
    const existing = await find();
    if (existing) return toCheckDto(existing);
    try {
      const created = await this.prisma.kycCheck.create({
        data: { userId, tier, provider: this.provider.name },
        include: { documents: true },
      });
      return toCheckDto(created);
    } catch (err) {
      // Two taps at once: the partial unique index lets one win; the other reads it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return toCheckDto((await find()) as CheckWithDocs);
      }
      throw err;
    }
  }

  /** Step 1 of an upload: get a short-lived URL and upload straight to storage. */
  async presign(userId: string, req: KycDocumentRequest): Promise<KycPresign> {
    const check = await this.ownedEditableCheck(userId, req.checkId);
    if (!isTypeAllowedForTier(check.tier, req.type)) {
      throw unprocessable(`${req.type} is not part of tier ${check.tier} verification.`);
    }
    if (!isMimeAllowed(req.type, req.contentType)) {
      throw unprocessable(`That file type is not allowed for ${req.type}.`, {
        contentType: req.contentType,
      });
    }

    const bucket = this.env.env.S3_BUCKET_KYC;
    const key = `kyc/${userId}/${check.id}/${req.type}-${randomUUID()}.${extensionFor(req.contentType)}`;
    const replaced: { bucket: string; storageKey: string }[] = [];

    const doc = await this.prisma.$transaction(async (tx) => {
      // Re-uploading a type replaces the old file (the partial unique index allows one live per type).
      const old = await tx.kycDocument.findMany({
        where: { kycCheckId: check.id, type: req.type, status: { not: 'DELETED' } },
      });
      for (const o of old) {
        replaced.push({ bucket: o.bucket, storageKey: o.storageKey });
        await tx.kycDocument.update({
          where: { id: o.id },
          data: { status: 'DELETED', deletedAt: new Date() },
        });
      }
      return tx.kycDocument.create({
        data: {
          userId,
          kycCheckId: check.id,
          type: req.type,
          bucket,
          storageKey: key,
          contentType: req.contentType.toLowerCase(),
          sizeBytes: req.sizeBytes,
        },
      });
    });
    for (const r of replaced) this.storage.delete(r.bucket, r.storageKey).catch(() => undefined);

    const signed = await this.storage.presignUpload({
      bucket,
      key,
      contentType: doc.contentType,
      sizeBytes: req.sizeBytes,
    });
    return {
      documentId: doc.id,
      uploadUrl: signed.url,
      method: signed.method,
      headers: signed.headers,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  /** Step 2: after the phone finished the PUT, verify the file really exists at the declared size. */
  async confirmUpload(userId: string, documentId: string) {
    const doc = await this.prisma.kycDocument.findFirst({ where: { id: documentId, userId } });
    if (!doc || doc.status === 'DELETED') throw notFound('Document not found');
    await this.ownedEditableCheck(userId, doc.kycCheckId);
    const size = await this.storage.headSize(doc.bucket, doc.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet.');
    if (doc.sizeBytes !== null && size !== doc.sizeBytes) {
      await this.storage.delete(doc.bucket, doc.storageKey).catch(() => undefined);
      await this.prisma.kycDocument.update({
        where: { id: doc.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      throw unprocessable(
        'The uploaded file did not match its declared size. Please upload again.',
      );
    }
    const updated = await this.prisma.kycDocument.update({
      where: { id: doc.id },
      data: { status: 'UPLOADED', uploadedAt: new Date() },
    });
    return { id: updated.id, type: updated.type, status: updated.status };
  }

  async submit(userId: string, input: KycSubmitInput): Promise<KycCheckDto> {
    const check = await this.ownedEditableCheck(userId, input.checkId);
    const tier = check.tier as 1 | 2;
    const docs = await this.prisma.kycDocument.findMany({
      where: { kycCheckId: check.id, status: 'UPLOADED' },
      select: { type: true },
    });
    const missing = missingDocuments(
      tier,
      docs.map((d) => d.type),
    );
    if (missing.length) throw unprocessable('Some documents are missing.', { missing });

    if (tier === 2) {
      if (!input.reference)
        throw unprocessable('A professional reference is required.', { missing: ['reference'] });
      const cats = await this.prisma.workerCategory.count({ where: { workerProfile: { userId } } });
      if (cats === 0)
        throw unprocessable('Choose at least one category you work in first.', {
          missing: ['categories'],
        });
    }

    const result = await this.provider.submit({ checkId: check.id, userId, tier });
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.kycCheck.updateMany({
        where: { id: check.id, status: { in: [...EDITABLE] } },
        data: {
          status: result.status,
          rawRef: result.rawRef,
          provider: this.provider.name,
          submittedAt: new Date(),
          reviewerMessage: null,
        },
      });
      if (claimed.count !== 1) throw conflict('This verification was already submitted.');
      if (tier === 2 && input.reference) {
        await tx.professionalReference.upsert({
          where: { kycCheckId: check.id },
          update: {
            ...input.reference,
            callOutcome: 'NOT_CALLED',
            callNotes: null,
            calledAt: null,
            calledBy: null,
          },
          create: { kycCheckId: check.id, ...input.reference },
        });
      }
      await this.audit.record(
        {
          actorType: 'USER',
          actorId: userId,
          action: 'kyc.submitted',
          entityType: 'kyc_check',
          entityId: check.id,
          after: { tier, status: result.status },
        },
        tx,
      );
    });
    const fresh = await this.prisma.kycCheck.findUniqueOrThrow({
      where: { id: check.id },
      include: { documents: true },
    });
    return toCheckDto(fresh);
  }

  async status(userId: string): Promise<KycStatus> {
    const wp = await this.prisma.workerProfile.findUnique({ where: { userId } });
    const checks = await this.prisma.kycCheck.findMany({
      where: { userId },
      include: { documents: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return { tier: wp?.kycTier ?? 0, checks: checks.map(toCheckDto) };
  }

  /**
   * Retention (D-017): identity images are deleted N days after the decision. The DB keeps the
   * outcome; the pictures are gone. Run from a scheduled job (script now, BullMQ in Phase 2).
   */
  async purgeExpiredImages(now = new Date()): Promise<number> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'kyc_image_retention_days' },
    });
    const days = typeof cfg?.value === 'number' ? cfg.value : 30;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const docs = await this.prisma.kycDocument.findMany({
      where: { status: { not: 'DELETED' }, kycCheck: { decidedAt: { lte: cutoff } } },
    });
    let purged = 0;
    for (const d of docs) {
      try {
        await this.storage.delete(d.bucket, d.storageKey);
        await this.prisma.kycDocument.update({
          where: { id: d.id },
          data: { status: 'DELETED', deletedAt: now },
        });
        purged += 1;
      } catch (err) {
        this.logger.error(`Retention purge failed for document ${d.id}: ${String(err)}`);
      }
    }
    if (purged > 0) {
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'kyc.images_purged',
        entityType: 'kyc_document',
        after: { count: purged },
      });
    }
    return purged;
  }

  private async ownedEditableCheck(userId: string, checkId: string) {
    const check = await this.prisma.kycCheck.findFirst({ where: { id: checkId, userId } });
    if (!check) throw notFound('Verification not found');
    if (!(EDITABLE as readonly string[]).includes(check.status)) {
      throw conflict('This verification can no longer be changed.', { status: check.status });
    }
    return check;
  }
}
