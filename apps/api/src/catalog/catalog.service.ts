import { Injectable, NotFoundException } from '@nestjs/common';
import type { CityTier } from '@prisma/client';
import type {
  PriceBandDto,
  PriceListAddOnDto,
  PriceListEntryDto,
  ServiceCategoryDto,
} from '@haggler/shared';
import { PrismaService } from '../prisma/prisma.service';
import { type PriceBandRow, resolvePriceBand } from './price-band.resolver';

const FALLBACK_MIN_SAMPLE = 10;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<ServiceCategoryDto[]> {
    const rows = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      nameKey: c.nameKey,
      icon: c.icon,
      requiresLicense: c.requiresLicense,
      inspectionChargePaise: c.inspectionChargePaise,
    }));
  }

  /** D-080 (A1): the fixed price for a category, resolved for a city tier with DEFAULT as the
   * fallback when no tier-specific row has been set. */
  async getPriceListEntry(categorySlug: string, cityTier?: CityTier): Promise<PriceListEntryDto> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { slug: categorySlug, isActive: true },
    });
    if (!category) throw new NotFoundException(`Unknown category "${categorySlug}"`);

    const tier = cityTier ?? 'DEFAULT';
    const row =
      tier !== 'DEFAULT'
        ? await this.prisma.priceListEntry.findFirst({
            where: { categoryId: category.id, cityTier: tier, isActive: true },
          })
        : null;
    const resolved =
      row ??
      (await this.prisma.priceListEntry.findFirst({
        where: { categoryId: category.id, cityTier: 'DEFAULT', isActive: true },
      }));
    if (!resolved) throw new NotFoundException(`No price set for "${categorySlug}"`);
    return {
      id: resolved.id,
      categorySlug: category.slug,
      cityTier: resolved.cityTier,
      pricePaise: resolved.pricePaise,
      needsSurvey: resolved.needsSurvey,
      isActive: resolved.isActive,
    };
  }

  async listAddOns(categorySlug: string): Promise<PriceListAddOnDto[]> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { slug: categorySlug, isActive: true },
    });
    if (!category) throw new NotFoundException(`Unknown category "${categorySlug}"`);
    const rows = await this.prisma.priceListAddOn.findMany({
      where: { categoryId: category.id, isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((a) => ({
      id: a.id,
      categorySlug: category.slug,
      name: a.name,
      pricePaise: a.pricePaise,
      isActive: a.isActive,
    }));
  }

  async getPriceBand(categorySlug: string, pincode?: string, city?: string): Promise<PriceBandDto> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { slug: categorySlug, isActive: true },
    });
    if (!category) throw new NotFoundException(`Unknown category "${categorySlug}"`);

    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'price_band_min_sample' },
    });
    const minSample = typeof cfg?.value === 'number' ? cfg.value : FALLBACK_MIN_SAMPLE;

    // Fetch only rows that could match: this category's default, plus its cluster/city rows.
    const rows: PriceBandRow[] = await this.prisma.priceBand.findMany({
      where: {
        categoryId: category.id,
        OR: [
          { scope: 'DEFAULT' },
          ...(pincode
            ? [{ scope: 'PINCODE_CLUSTER' as const, pincodePrefix: pincode.slice(0, 3) }]
            : []),
          ...(city
            ? [{ scope: 'CITY' as const, city: { equals: city, mode: 'insensitive' as const } }]
            : []),
        ],
      },
    });

    const band = resolvePriceBand({ categorySlug, pincode, city, minSample }, rows);
    if (!band) throw new NotFoundException(`No price band configured for "${categorySlug}"`);
    return band;
  }
}
