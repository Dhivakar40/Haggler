import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type CampusListingDto,
  type ContractApplicationStatus,
  type CreateCampusListingInput,
  decodeCursor,
  toPage,
  type UpdateCampusListingInput,
} from '@haggler/shared';
import { notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

type ListingRow = Prisma.CampusListingGetPayload<{
  include: { employer: { select: { businessName: true } }; category: { select: { slug: true } } };
}>;

const toDto = (
  row: ListingRow,
  extra: { applicationCount?: number; myApplicationStatus?: ContractApplicationStatus | null } = {},
): CampusListingDto => ({
  id: row.id,
  employerId: row.employerId,
  businessName: row.employer.businessName,
  categorySlug: row.category.slug,
  title: row.title,
  description: row.description,
  hourlyRatePaise: row.hourlyRatePaise,
  hoursPerWeek: row.hoursPerWeek,
  isNightShift: row.isNightShift,
  openings: row.openings,
  filledCount: row.filledCount,
  city: row.city,
  state: row.state,
  pincode: row.pincode,
  status: row.status,
  isBoosted: !!row.boostedUntil && row.boostedUntil.getTime() > Date.now(),
  createdAt: row.createdAt.toISOString(),
  ...extra,
});

const include = {
  employer: { select: { businessName: true } },
  category: { select: { slug: true } },
} as const;

/** Editable only while the listing hasn't finished hiring (same reasoning as Contract, D-054). */
const EDITABLE_STATUSES = ['OPEN', 'PAUSED'] as const;

@Injectable()
export class CampusListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** Boosted listing fee (Phase 9, D-069): starts a payment order. See
   * WalletService.createBoostOrder for the eligibility checks. */
  boost(userId: string, listingId: string) {
    return this.wallet.createBoostOrder(userId, 'CAMPUS', listingId);
  }

  /** Every Campus listing needs a *verified* employer (D-062) — stricter than Contract, which
   * needs no verification at all (D-056). Returns the employer row, not just its id, since the
   * caller needs `verified` too. */
  private async verifiedEmployer(userId: string) {
    const ep = await this.prisma.employerProfile.findUnique({
      where: { userId },
      select: { id: true, verified: true },
    });
    if (!ep)
      throw unprocessable('Set your business name first.', { code: 'EMPLOYER_PROFILE_REQUIRED' });
    if (!ep.verified)
      throw unprocessable('Your business must be verified before posting a Campus job.', {
        code: 'EMPLOYER_NOT_VERIFIED',
      });
    return ep;
  }

  async create(userId: string, input: CreateCampusListingInput): Promise<CampusListingDto> {
    const employer = await this.verifiedEmployer(userId);
    const category = await this.prisma.serviceCategory.findUnique({
      where: { slug: input.categorySlug },
      select: { id: true, isActive: true },
    });
    if (!category || !category.isActive) throw unprocessable('Unknown category');
    const row = await this.prisma.campusListing.create({
      data: {
        employerId: employer.id,
        categoryId: category.id,
        title: input.title,
        description: input.description,
        hourlyRatePaise: input.hourlyRatePaise,
        hoursPerWeek: input.hoursPerWeek,
        isNightShift: input.isNightShift,
        openings: input.openings,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
      },
      include,
    });
    return toDto(row, { applicationCount: 0 });
  }

  /** Owner-only lookup, throws 404 for anyone else (never reveals a listing exists to a
   * non-owner via a 403 vs 404 timing/response difference). */
  private async ownedListing(userId: string, listingId: string) {
    const row = await this.prisma.campusListing.findUnique({
      where: { id: listingId },
      include: { employer: { select: { userId: true, businessName: true } } },
    });
    if (!row || row.employer.userId !== userId) throw notFound('Listing not found');
    return row;
  }

  async update(
    userId: string,
    listingId: string,
    input: UpdateCampusListingInput,
  ): Promise<CampusListingDto> {
    const existing = await this.ownedListing(userId, listingId);
    if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number]))
      throw unprocessable('This listing can no longer be edited.', {
        code: 'LISTING_NOT_EDITABLE',
      });

    const row = await this.prisma.campusListing.update({
      where: { id: listingId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.hourlyRatePaise !== undefined ? { hourlyRatePaise: input.hourlyRatePaise } : {}),
        ...(input.hoursPerWeek !== undefined ? { hoursPerWeek: input.hoursPerWeek } : {}),
        ...(input.isNightShift !== undefined ? { isNightShift: input.isNightShift } : {}),
        ...(input.openings !== undefined ? { openings: input.openings } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.pincode !== undefined ? { pincode: input.pincode } : {}),
        ...(input.status !== undefined
          ? { status: input.status, closedAt: input.status === 'OPEN' ? null : new Date() }
          : {}),
      },
      include,
    });
    return toDto(row, { applicationCount: await this.applicationCount(listingId) });
  }

  private applicationCount(listingId: string): Promise<number> {
    return this.prisma.campusApplication.count({ where: { listingId } });
  }

  async mine(userId: string, cursor: string | undefined, limit: number) {
    const ep = await this.prisma.employerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ep)
      throw unprocessable('Set your business name first.', { code: 'EMPLOYER_PROFILE_REQUIRED' });
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.campusListing.findMany({
      where: { AND: [{ employerId: ep.id }, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const counts = await this.prisma.campusApplication.groupBy({
      by: ['listingId'],
      where: { listingId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const countByListing = new Map(counts.map((c2) => [c2.listingId, c2._count._all]));
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => toDto(r, { applicationCount: countByListing.get(r.id) ?? 0 })),
      nextCursor: page.nextCursor,
    };
  }

  /** Public browse: only OPEN listings, optionally filtered. `viewerId` (a signed-in student)
   * gets their own application status folded in so the app can show "Applied" instead of "Apply".
   * Currently-boosted listings (D-069) are surfaced separately, same pattern and same reasoning as
   * ContractListingsService.browse(). */
  async browse(
    viewerId: string | undefined,
    filters: { categorySlug?: string; city?: string },
    cursor: string | undefined,
    limit: number,
  ) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const filterClauses: Prisma.CampusListingWhereInput[] = [
      filters.categorySlug ? { category: { slug: filters.categorySlug } } : {},
      filters.city ? { city: { equals: filters.city, mode: 'insensitive' as const } } : {},
    ];
    const boosted = !c
      ? await this.prisma.campusListing.findMany({
          where: {
            AND: [
              { status: 'OPEN' as const },
              { boostedUntil: { gt: new Date() } },
              ...filterClauses,
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          include,
        })
      : [];
    const where: Prisma.CampusListingWhereInput = {
      AND: [
        { status: 'OPEN' as const },
        { OR: [{ boostedUntil: null }, { boostedUntil: { lte: new Date() } }] },
        ...filterClauses,
        after,
      ],
    };
    const rows = await this.prisma.campusListing.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    const allRows = [...boosted, ...page.items];
    let statusByListing = new Map<string, ContractApplicationStatus>();
    if (viewerId) {
      const apps = await this.prisma.campusApplication.findMany({
        where: { studentId: viewerId, listingId: { in: allRows.map((r) => r.id) } },
        select: { listingId: true, status: true },
      });
      statusByListing = new Map(apps.map((a) => [a.listingId, a.status]));
    }
    return {
      boosted: boosted.map((r) =>
        toDto(r, { myApplicationStatus: statusByListing.get(r.id) ?? null }),
      ),
      items: page.items.map((r) =>
        toDto(r, { myApplicationStatus: statusByListing.get(r.id) ?? null }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async detail(viewerId: string | undefined, listingId: string): Promise<CampusListingDto> {
    const row = await this.prisma.campusListing.findUnique({ where: { id: listingId }, include });
    if (!row) throw notFound('Listing not found');
    let myApplicationStatus: ContractApplicationStatus | null | undefined;
    if (viewerId) {
      const app = await this.prisma.campusApplication.findUnique({
        where: { listingId_studentId: { listingId, studentId: viewerId } },
        select: { status: true },
      });
      myApplicationStatus = app?.status ?? null;
    }
    return toDto(row, { myApplicationStatus });
  }

  /** Used internally by ApplicationsService to check ownership / eligibility without re-querying. */
  async raw(listingId: string) {
    const row = await this.prisma.campusListing.findUnique({
      where: { id: listingId },
      include: { employer: { select: { userId: true, businessName: true } } },
    });
    if (!row) throw notFound('Listing not found');
    return row;
  }

  async incrementFilled(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
    const row = await tx.campusListing.update({
      where: { id: listingId },
      data: { filledCount: { increment: 1 } },
      select: { filledCount: true, openings: true, status: true },
    });
    if (row.filledCount >= row.openings && row.status !== 'FILLED') {
      await tx.campusListing.update({
        where: { id: listingId },
        data: { status: 'FILLED', closedAt: new Date() },
      });
    }
  }
}
