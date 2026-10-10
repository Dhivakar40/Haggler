import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CITY_TIERS, pincodeSchema } from '@haggler/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogService } from './catalog.service';

const priceBandQuery = z.object({
  category: z.string().min(1).max(64),
  pincode: pincodeSchema.optional(),
  city: z.string().min(1).max(80).optional(),
});

const priceListQuery = z.object({
  category: z.string().min(1).max(64),
  cityTier: z.enum(CITY_TIERS).optional(),
});

const addOnsQuery = z.object({
  category: z.string().min(1).max(64),
});

@ApiTags('catalog')
@Public()
@Controller({ path: '', version: '1' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'List active service categories (public)' })
  @ApiOkResponse({ description: 'Array of { id, slug, nameKey, icon, requiresLicense }' })
  categories() {
    return this.catalog.listCategories();
  }

  @Get('price-bands')
  @ApiOperation({
    summary: 'Price band (min/median/max, integer paise) for a category and area',
    description:
      'Resolves the most local trusted band: pincode cluster, then city, then seeded default. ' +
      '`scope` and `isSeededDefault` tell the client which one was used.',
  })
  @ApiQuery({ name: 'category', required: true, example: 'electrician' })
  @ApiQuery({ name: 'pincode', required: false, example: '600042' })
  @ApiQuery({ name: 'city', required: false, example: 'Chennai' })
  @ApiOkResponse({ description: 'A PriceBandDto' })
  priceBand(@Query(new ZodPipe(priceBandQuery)) q: z.infer<typeof priceBandQuery>) {
    return this.catalog.getPriceBand(q.category, q.pincode, q.city);
  }

  @Get('price-list')
  @ApiOperation({
    summary: 'The fixed listed price for a category (D-080), resolved for a city tier',
    description:
      'Falls back to the DEFAULT tier when no row exists for the requested tier. ' +
      '`needsSurvey` is true until an admin has confirmed this is a real, surveyed rate.',
  })
  @ApiQuery({ name: 'category', required: true, example: 'electrician' })
  @ApiQuery({ name: 'cityTier', required: false, enum: CITY_TIERS })
  @ApiOkResponse({ description: 'A PriceListEntryDto' })
  priceList(@Query(new ZodPipe(priceListQuery)) q: z.infer<typeof priceListQuery>) {
    return this.catalog.getPriceListEntry(q.category, q.cityTier);
  }

  @Get('price-list/add-ons')
  @ApiOperation({ summary: 'Catalogue add-ons available for a category (D-080)' })
  @ApiQuery({ name: 'category', required: true, example: 'electrician' })
  @ApiOkResponse({ description: 'Array of PriceListAddOnDto' })
  addOns(@Query(new ZodPipe(addOnsQuery)) q: z.infer<typeof addOnsQuery>) {
    return this.catalog.listAddOns(q.category);
  }
}
