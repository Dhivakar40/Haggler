import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type ContractApplicationStatus,
  type ContractListingDto,
  type ContractPayType,
  type CreateContractListingInput,
  decodeCursor,
  toPage,
  type UpdateContractListingInput,
} from '@haggler/shared';
import { notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

type ListingRow = Prisma.ContractListingGetPayload<{
  include: { employer: { select: { businessName: true } }; category: { select: { slug: true } } };
}>;

const toDto = (
  row: ListingRow,
  extra: { applicationCount?: number; myApplicationStatus?: ContractApplicationStatus | null } = {},
): ContractListingDto => ({
  id: row.id,
  employerId: row.employerId,
  businessName: row.employer.businessName,
  categorySlug: row.category.slug,
  title: row.title,
  description: row.description,
  payType: row.payType,
  payAmountPaise: row.payAmountPaise,
  openings: row.openings,
  filledCount: row.filledCount,
  city: row.city,
  state: row.state,
  pincode: row.pincode,
  startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
  status: row.status,
  isBoosted: !!row.boostedUntil && row.boostedUntil.getTime() > Date.now(),
  createdAt: row.createdAt.toISOString(),
  ...extra,
});

const include = {
  employer: { select: { businessName: true } },
  category: { select: { slug: true } },
} as const;

/** Editable only while the listing hasn't finished hiring (D-054: a job board, not dispatch —
 * there is no in-flight state to protect the way a Job's lifecycle does). */
const EDITABLE_STATUSES = ['OPEN', 'PAUSED'] as const;

@Injectable()
export class ContractListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** Boosted listing fee (Phase 9, D-069): starts a payment order. See
   * WalletService.createBoostOrder for the eligibility checks. */
  boost(userId: string, listingId: string) {
    return this.wallet.createBoostOrder(userId, 'CONTRACT', listingId);
  }

  private async employerId(userId: string): Promise<string> {
    const ep = await this.prisma.employerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ep)
      throw unprocessable('Set your business name first.', { code: 'EMPLOYER_PROFILE_REQUIRED' });
    return ep.id;
  }

  async create(userId: string, input: CreateContractListingInput): Promise<ContractListingDto> {
    const employerId = await this.employerId(userId);
    const category = await this.prisma.serviceCategory.findUnique({
      where: { slug: input.categorySlug },
      select: { id: true, isActive: true },
    });
    if (!category || !category.isActive) throw unprocessable('Unknown category');
    const row = await this.prisma.contractListing.create({
      data: {
        employerId,
        categoryId: category.id,
        title: input.title,
        description: input.description,
        payType: input.payType,
        payAmountPaise: input.payAmountPaise,
        openings: input.openings,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        startDate: input.startDate ? new Date(input.startDate) : null,
      },
      include,
    });
    return toDto(row, { applicationCount: 0 });
  }

  /** Owner-only lookup, throws 404 for anyone else (never reveals a listing exists to a
   * non-owner via a 403 vs 404 timing/response difference). */
  private async ownedListing(userId: string, listingId: string) {
    const row = await this.prisma.contractListing.findUnique({
      where: { id: listingId },
      include: { employer: { select: { userId: true, businessName: true } } },
    });
    if (!row || row.employer.userId !== userId) throw notFound('Listing not found');
    return row;
  }

  async update(
    userId: string,
    listingId: string,
    input: UpdateContractListingInput,
  ): Promise<ContractListingDto> {
    const existing = await this.ownedListing(userId, listingId);
    if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number]))
      throw unprocessable('This listing can no longer be edited.', {
        code: 'LISTING_NOT_EDITABLE',
      });

    // categorySlug is not part of UpdateContractListingInput — the category is fixed at
    // creation; kept out of scope to keep the edit surface small for this phase.
    const row = await this.prisma.contractListing.update({
      where: { id: listingId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.payType !== undefined ? { payType: input.payType } : {}),
        ...(input.payAmountPaise !== undefined ? { payAmountPaise: input.payAmountPaise } : {}),
        ...(input.openings !== undefined ? { openings: input.openings } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.pincode !== undefined ? { pincode: input.pincode } : {}),
        ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
        ...(input.status !== undefined
          ? { status: input.status, closedAt: input.status === 'OPEN' ? null : new Date() }
          : {}),
      },
      include,
    });
    return toDto(row, { applicationCount: await this.applicationCount(listingId) });
  }

  private applicationCount(listingId: string): Promise<number> {
    return this.prisma.contractApplication.count({ where: { listingId } });
  }

  async mine(userId: string, cursor: string | undefined, limit: number) {
    const employerId = await this.employerId(userId);
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.contractListing.findMany({
      where: { AND: [{ employerId }, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const counts = await this.prisma.contractApplication.groupBy({
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

  /** Public browse: only OPEN listings, optionally filtered. `viewerId` (a signed-in Worker) gets
   * their own application status folded in so the app can show "Applied" instead of "Apply".
   * Currently-boosted listings (D-069) are surfaced separately, up to 5, on the FIRST page only
   * (cursor undefined) and excluded from the cursor-paginated `items` below them, so a boost never
   * disturbs the stable (createdAt, id) pagination the rest of the list relies on. */
  async browse(
    viewerId: string | undefined,
    filters: { categorySlug?: string; city?: string; payType?: ContractPayType },
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
    const filterClauses: Prisma.ContractListingWhereInput[] = [
      filters.categorySlug ? { category: { slug: filters.categorySlug } } : {},
      filters.city ? { city: { equals: filters.city, mode: 'insensitive' as const } } : {},
      filters.payType ? { payType: filters.payType } : {},
    ];
    const boosted = !c
      ? await this.prisma.contractListing.findMany({
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
    const where: Prisma.ContractListingWhereInput = {
      AND: [
        { status: 'OPEN' as const },
        { OR: [{ boostedUntil: null }, { boostedUntil: { lte: new Date() } }] },
        ...filterClauses,
        after,
      ],
    };
    const rows = await this.prisma.contractListing.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    const allRows = [...boosted, ...page.items];
    let statusByListing = new Map<string, ContractApplicationStatus>();
    if (viewerId) {
      const apps = await this.prisma.contractApplication.findMany({
        where: { workerId: viewerId, listingId: { in: allRows.map((r) => r.id) } },
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

  async detail(viewerId: string | undefined, listingId: string): Promise<ContractListingDto> {
    const row = await this.prisma.contractListing.findUnique({ where: { id: listingId }, include });
    if (!row) throw notFound('Listing not found');
    let myApplicationStatus: ContractApplicationStatus | null | undefined;
    if (viewerId) {
      const app = await this.prisma.contractApplication.findUnique({
        where: { listingId_workerId: { listingId, workerId: viewerId } },
        select: { status: true },
      });
      myApplicationStatus = app?.status ?? null;
    }
    return toDto(row, { myApplicationStatus });
  }

  /** Used internally by ApplicationsService to check ownership / eligibility without re-querying. */
  async raw(listingId: string) {
    const row = await this.prisma.contractListing.findUnique({
      where: { id: listingId },
      include: { employer: { select: { userId: true, businessName: true } } },
    });
    if (!row) throw notFound('Listing not found');
    return row;
  }

  async incrementFilled(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
    const row = await tx.contractListing.update({
      where: { id: listingId },
      data: { filledCount: { increment: 1 } },
      select: { filledCount: true, openings: true, status: true },
    });
    if (row.filledCount >= row.openings && row.status !== 'FILLED') {
      await tx.contractListing.update({
        where: { id: listingId },
        data: { status: 'FILLED', closedAt: new Date() },
      });
    }
  }
}
