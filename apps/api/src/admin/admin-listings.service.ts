import { Injectable } from '@nestjs/common';
import type { ContractListingStatus, Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { conflict, notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const CANCELLABLE: ContractListingStatus[] = ['OPEN', 'PAUSED', 'FILLED'];

/**
 * Listing moderation for both job-board verticals (Phase 8, D-049/D-059 known gap closed): an
 * admin can take down a fraudulent or abusive Contract or Campus listing. No "report" mechanic
 * exists yet (users can't flag a listing) — this is browse-and-search moderation, not a queue fed
 * by reports; a text search over title/description is the closest thing to finding a bad listing
 * without one.
 */
@Injectable()
export class AdminListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async browseContracts(q: string | undefined, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.ContractListingWhereInput = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.contractListing.findMany({
      where: {
        AND: [q ? { title: { contains: q, mode: 'insensitive' } } : {}, after],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { employer: { select: { businessName: true, userId: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        title: r.title,
        businessName: r.employer.businessName,
        employerUserId: r.employer.userId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async browseCampus(q: string | undefined, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.CampusListingWhereInput = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.campusListing.findMany({
      where: {
        AND: [q ? { title: { contains: q, mode: 'insensitive' } } : {}, after],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { employer: { select: { businessName: true, userId: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        title: r.title,
        businessName: r.employer.businessName,
        employerUserId: r.employer.userId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async cancelContract(id: string, reason: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const row = await this.prisma.contractListing.findUnique({
      where: { id },
      include: { employer: { select: { userId: true } } },
    });
    if (!row) throw notFound('Listing not found');
    if (!CANCELLABLE.includes(row.status)) throw conflict('This listing is already closed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.contractListing.update({
        where: { id },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'contract_listing.cancelled',
          entityType: 'contract_listing',
          entityId: id,
          after: { reason },
        },
        tx,
      );
    });
    void this.notifications.notify(row.employer.userId, {
      title: 'Listing removed',
      body: `Your listing "${row.title}" was removed by an admin: ${reason}`,
      data: { listingId: id, type: 'contract_listing_cancelled' },
    });
    return { ok: true };
  }

  async cancelCampus(id: string, reason: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const row = await this.prisma.campusListing.findUnique({
      where: { id },
      include: { employer: { select: { userId: true } } },
    });
    if (!row) throw notFound('Listing not found');
    if (!CANCELLABLE.includes(row.status)) throw conflict('This listing is already closed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.campusListing.update({
        where: { id },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'campus_listing.cancelled',
          entityType: 'campus_listing',
          entityId: id,
          after: { reason },
        },
        tx,
      );
    });
    void this.notifications.notify(row.employer.userId, {
      title: 'Listing removed',
      body: `Your listing "${row.title}" was removed by an admin: ${reason}`,
      data: { listingId: id, type: 'campus_listing_cancelled' },
    });
    return { ok: true };
  }
}
