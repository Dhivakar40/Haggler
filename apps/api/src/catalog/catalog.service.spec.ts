import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../prisma/prisma.service';

const CATEGORY = { id: 'cat-1', slug: 'electrician', isActive: true };

describe('CatalogService.getPriceListEntry (D-080)', () => {
  const makePrisma = (entries: { cityTier: string; pricePaise: number }[]) => {
    const priceListEntry = {
      findFirst: jest.fn(({ where }: { where: { cityTier: string } }) =>
        Promise.resolve(
          entries.find((e) => e.cityTier === where.cityTier) ? { id: 'row-1', categoryId: CATEGORY.id, needsSurvey: false, isActive: true, ...entries.find((e) => e.cityTier === where.cityTier) } : null,
        ),
      ),
    };
    return {
      serviceCategory: { findFirst: jest.fn().mockResolvedValue(CATEGORY) },
      priceListEntry,
    } as unknown as PrismaService;
  };

  it('returns the tier-specific price when one exists', async () => {
    const prisma = makePrisma([
      { cityTier: 'TIER_1', pricePaise: 50000 },
      { cityTier: 'DEFAULT', pricePaise: 30000 },
    ]);
    const svc = new CatalogService(prisma);
    const result = await svc.getPriceListEntry('electrician', 'TIER_1');
    expect(result.pricePaise).toBe(50000);
    expect(result.cityTier).toBe('TIER_1');
  });

  it('falls back to DEFAULT when no tier-specific row exists', async () => {
    const prisma = makePrisma([{ cityTier: 'DEFAULT', pricePaise: 30000 }]);
    const svc = new CatalogService(prisma);
    const result = await svc.getPriceListEntry('electrician', 'TIER_2');
    expect(result.pricePaise).toBe(30000);
    expect(result.cityTier).toBe('DEFAULT');
  });

  it('resolves DEFAULT directly when no tier is requested', async () => {
    const prisma = makePrisma([{ cityTier: 'DEFAULT', pricePaise: 30000 }]);
    const svc = new CatalogService(prisma);
    const result = await svc.getPriceListEntry('electrician');
    expect(result.cityTier).toBe('DEFAULT');
  });

  it('throws 404 when the category has no price set at all', async () => {
    const prisma = makePrisma([]);
    const svc = new CatalogService(prisma);
    await expect(svc.getPriceListEntry('electrician')).rejects.toThrow(NotFoundException);
  });

  it('throws 404 for an unknown category', async () => {
    const prisma = {
      serviceCategory: { findFirst: jest.fn().mockResolvedValue(null) },
      priceListEntry: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    const svc = new CatalogService(prisma);
    await expect(svc.getPriceListEntry('not-real')).rejects.toThrow(NotFoundException);
  });
});
