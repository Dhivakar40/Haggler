import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ApplyToContractInput,
  type ContractApplicationDto,
  type ContractDecisionInput,
  decodeCursor,
  toPage,
} from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContractListingsService } from './contract-listings.service';

const toDto = (row: {
  id: string;
  listingId: string;
  workerId: string;
  worker: { fullName: string | null };
  coverNote: string | null;
  status: string;
  appliedAt: Date;
  decidedAt: Date | null;
}): ContractApplicationDto => ({
  id: row.id,
  listingId: row.listingId,
  workerId: row.workerId,
  workerName: row.worker.fullName,
  coverNote: row.coverNote,
  status: row.status as ContractApplicationDto['status'],
  appliedAt: row.appliedAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

const DECISION_TO_STATUS = {
  SHORTLIST: 'SHORTLISTED',
  REJECT: 'REJECTED',
  HIRE: 'HIRED',
} as const;

/**
 * Applying, withdrawing and deciding on Contract-labour applications (Phase 6). No money moves
 * here (D-054) — this is a job board, not the on-demand marketplace's escrow-like wallet flow.
 */
@Injectable()
export class ContractApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ContractListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Applying needs identity verification (kycTier >= 1 requires an admin-approved date of
   * birth), which is also the project's under-18 hard block for Contract labour
   * (docs/COMPLIANCE.md item 7) — the same mechanism Rangers already go through, reused rather
   * than duplicated. */
  private async assertEligibleWorker(userId: string): Promise<void> {
    const wp = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { kycTier: true },
    });
    if (!wp || wp.kycTier < 1)
      throw unprocessable('Verify your identity before applying to a job.', {
        code: 'KYC_REQUIRED',
      });
  }

  async apply(
    userId: string,
    listingId: string,
    input: ApplyToContractInput,
  ): Promise<ContractApplicationDto> {
    await this.assertEligibleWorker(userId);
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId === userId)
      throw unprocessable('You cannot apply to your own listing.');
    if (listing.status !== 'OPEN')
      throw conflict('This listing is no longer accepting applications.', {
        code: 'LISTING_CLOSED',
      });

    const existing = await this.prisma.contractApplication.findUnique({
      where: { listingId_workerId: { listingId, workerId: userId } },
    });
    if (existing && existing.status !== 'WITHDRAWN')
      throw conflict('You already applied to this listing.', { code: 'ALREADY_APPLIED' });

    const row = existing
      ? await this.prisma.contractApplication.update({
          where: { id: existing.id },
          data: { status: 'APPLIED', coverNote: input.coverNote ?? null, decidedAt: null },
          include: { worker: { select: { fullName: true } } },
        })
      : await this.prisma.contractApplication.create({
          data: { listingId, workerId: userId, coverNote: input.coverNote ?? null },
          include: { worker: { select: { fullName: true } } },
        });

    void this.notifications.notify(listing.employer.userId, {
      title: 'New applicant',
      body: `Someone applied to "${listing.title}".`,
      data: { listingId, type: 'contract_application' },
    });
    return toDto(row);
  }

  async withdraw(userId: string, listingId: string): Promise<{ ok: true }> {
    const existing = await this.prisma.contractApplication.findUnique({
      where: { listingId_workerId: { listingId, workerId: userId } },
    });
    if (!existing || existing.status === 'WITHDRAWN') throw notFound('Application not found');
    if (existing.status === 'HIRED') throw unprocessable('You cannot withdraw after being hired.');
    await this.prisma.contractApplication.update({
      where: { id: existing.id },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    });
    return { ok: true };
  }

  /** Employer-only: every application for a listing they own. */
  async forListing(userId: string, listingId: string, cursor: string | undefined, limit: number) {
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId !== userId) throw notFound('Listing not found');
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { appliedAt: { lt: new Date(c.k) } },
            { appliedAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.contractApplication.findMany({
      where: { AND: [{ listingId }, after] },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { worker: { select: { fullName: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.appliedAt.toISOString(), id: r.id }));
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  /** A worker's own applications, newest first, with a summary of the listing each is for. */
  async mine(userId: string, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { appliedAt: { lt: new Date(c.k) } },
            { appliedAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.contractApplication.findMany({
      where: { AND: [{ workerId: userId }, after] },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        worker: { select: { fullName: true } },
        listing: {
          select: { title: true, status: true, employer: { select: { businessName: true } } },
        },
      },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.appliedAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        ...toDto(r),
        listingTitle: r.listing.title,
        listingStatus: r.listing.status,
        businessName: r.listing.employer.businessName,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async decide(
    userId: string,
    listingId: string,
    applicationId: string,
    input: ContractDecisionInput,
  ): Promise<ContractApplicationDto> {
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId !== userId) throw notFound('Listing not found');
    const application = await this.prisma.contractApplication.findUnique({
      where: { id: applicationId },
      include: { worker: { select: { fullName: true } } },
    });
    if (!application || application.listingId !== listingId)
      throw notFound('Application not found');
    if (application.status !== 'APPLIED' && application.status !== 'SHORTLISTED')
      throw conflict('This application already has a decision.', {
        code: 'DECISION_ALREADY_MADE',
      });
    if (input.decision === 'HIRE' && listing.status !== 'OPEN')
      throw conflict('This listing is no longer open.', { code: 'LISTING_CLOSED' });

    const nextStatus = DECISION_TO_STATUS[input.decision];
    let updated: typeof application;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.contractApplication.update({
          where: { id: applicationId },
          data: { status: nextStatus, decidedAt: new Date() },
          include: { worker: { select: { fullName: true } } },
        });
        if (input.decision === 'HIRE') await this.listings.incrementFilled(tx, listingId);
        return row;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')
        throw conflict('This application just changed. Refresh and try again.');
      throw err;
    }

    const pushByDecision = {
      SHORTLIST: { title: 'Shortlisted', body: `You were shortlisted for "${listing.title}".` },
      REJECT: {
        title: 'Application update',
        body: `You were not selected for "${listing.title}".`,
      },
      HIRE: { title: "You're hired!", body: `You were hired for "${listing.title}".` },
    } as const;
    void this.notifications.notify(application.workerId, {
      ...pushByDecision[input.decision],
      data: { listingId, type: 'contract_decision' },
    });
    return toDto(updated);
  }
}
