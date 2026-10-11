import { Injectable } from '@nestjs/common';
import type {
  AdminInspectionChargeInput,
  AdminPriceListAddOnUpsertInput,
  AdminPriceListEntryUpsertInput,
} from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** D-080 (A1/A2): the admin side of the fixed price list that replaces negotiation. FINANCE-role
 * only — pricing is a finance decision, same boundary as everything else money-related here. */
@Injectable()
export class AdminPriceListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listEntries() {
    const rows = await this.prisma.priceListEntry.findMany({
      include: { category: { select: { slug: true, nameKey: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { cityTier: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      categorySlug: r.category.slug,
      categoryNameKey: r.category.nameKey,
      cityTier: r.cityTier,
      pricePaise: r.pricePaise,
      needsSurvey: r.needsSurvey,
      isActive: r.isActive,
    }));
  }

  /** Upserts the one row for (categoryId, cityTier). Setting a price is, by definition, no
   * longer a placeholder unless the admin explicitly says otherwise. */
  async upsertEntry(input: AdminPriceListEntryUpsertInput, admin: AuthAdmin) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw notFound('Category not found');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.priceListEntry.upsert({
        where: { categoryId_cityTier: { categoryId: input.categoryId, cityTier: input.cityTier } },
        update: {
          pricePaise: input.pricePaise,
          needsSurvey: input.needsSurvey,
          isActive: input.isActive,
        },
        create: {
          categoryId: input.categoryId,
          cityTier: input.cityTier,
          pricePaise: input.pricePaise,
          needsSurvey: input.needsSurvey,
          isActive: input.isActive,
        },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'price_list_entry.upserted',
          entityType: 'price_list_entry',
          entityId: r.id,
          after: input,
        },
        tx,
      );
      return r;
    });
    return { id: row.id };
  }

  async listAddOns() {
    const rows = await this.prisma.priceListAddOn.findMany({
      include: { category: { select: { slug: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      categorySlug: r.category.slug,
      name: r.name,
      pricePaise: r.pricePaise,
      ceilingMultipleBps: r.ceilingMultipleBps,
      isActive: r.isActive,
    }));
  }

  /** Create when `input.id` is absent, update when present. D-087: this catalogue is now also
   * the labour-item list a quote is built from — pricePaise is the floor, ceilingMultipleBps an
   * optional per-item override. */
  async upsertAddOn(input: AdminPriceListAddOnUpsertInput, admin: AuthAdmin) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw notFound('Category not found');
    if (input.id) {
      const existing = await this.prisma.priceListAddOn.findUnique({ where: { id: input.id } });
      if (!existing) throw notFound('Price list item not found');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const data = {
        categoryId: input.categoryId,
        name: input.name,
        pricePaise: input.pricePaise,
        ceilingMultipleBps: input.ceilingMultipleBps ?? null,
        isActive: input.isActive,
      };
      const r = input.id
        ? await tx.priceListAddOn.update({ where: { id: input.id }, data })
        : await tx.priceListAddOn.create({ data });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: input.id ? 'price_list_add_on.updated' : 'price_list_add_on.created',
          entityType: 'price_list_add_on',
          entityId: r.id,
          after: input,
        },
        tx,
      );
      return r;
    });
    return { id: row.id };
  }

  async setInspectionCharge(
    categoryId: string,
    input: AdminInspectionChargeInput,
    admin: AuthAdmin,
  ) {
    const category = await this.prisma.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw notFound('Category not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceCategory.update({
        where: { id: categoryId },
        data: { inspectionChargePaise: input.inspectionChargePaise },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'service_category.inspection_charge_set',
          entityType: 'service_category',
          entityId: categoryId,
          after: input,
        },
        tx,
      );
    });
    return { ok: true };
  }
}
