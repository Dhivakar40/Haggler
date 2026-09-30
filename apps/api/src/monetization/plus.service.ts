import { Injectable } from '@nestjs/common';
import type { PlusAudience } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reads only (Phase 9, D-069). Plan catalog + "is this user currently Plus" — both cheap, live
 * queries, no caching needed. Writing a PlusMembership row (granting/extending on a paid order)
 * happens in WalletService.credit(), not here, to avoid a WalletModule <-> MonetizationModule
 * circular import: WalletService does the plain Prisma write itself instead of calling back into
 * this service. See docs/ARCHITECTURE.md's Phase 9 section for the full reasoning.
 */
@Injectable()
export class PlusService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(audience?: PlusAudience) {
    const rows = await this.prisma.plusPlan.findMany({
      where: { isActive: true, ...(audience ? { audience } : {}) },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      audience: p.audience,
      durationDays: p.durationDays,
      pricePaise: p.pricePaise,
      tokenDiscountBps: p.tokenDiscountBps,
    }));
  }

  /** Null if the user has never subscribed, or their membership has lapsed. */
  async myMembership(userId: string) {
    const row = await this.prisma.plusMembership.findUnique({
      where: { userId },
      include: {
        plan: { select: { slug: true, name: true, audience: true, tokenDiscountBps: true } },
      },
    });
    if (!row) return null;
    const active = row.expiresAt.getTime() > Date.now();
    return {
      planSlug: row.plan.slug,
      planName: row.plan.name,
      audience: row.plan.audience,
      tokenDiscountBps: row.plan.tokenDiscountBps,
      expiresAt: row.expiresAt.toISOString(),
      active,
    };
  }
}
