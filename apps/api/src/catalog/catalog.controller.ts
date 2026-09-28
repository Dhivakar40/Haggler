import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/decorators';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { pincodeSchema } from '@haggler/shared';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogService } from './catalog.service';

const priceBandQuery = z.object({
  category: z.string().min(1).max(64),
  pincode: pincodeSchema.optional(),
  city: z.string().min(1).max(80).optional(),
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
}
