import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlusService } from './plus.service';

const plansQuery = z.object({ audience: z.enum(['CUSTOMER', 'EMPLOYER']).optional() });

@ApiTags('plus')
@ApiBearerAuth()
@Controller({ path: 'plus', version: '1' })
export class PlusController {
  constructor(private readonly plus: PlusService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Haggler Plus plans. Filter with audience=CUSTOMER|EMPLOYER (D-069)',
  })
  @ApiQuery({ name: 'audience', required: false, enum: ['CUSTOMER', 'EMPLOYER'] })
  plans(@Query(new ZodPipe(plansQuery)) q: z.infer<typeof plansQuery>) {
    return this.plus.listPlans(q.audience);
  }

  @Get('membership')
  @ApiOperation({ summary: 'My current Haggler Plus membership, or null if never subscribed' })
  membership(@CurrentUser() u: AuthUser) {
    return this.plus.myMembership(u.id);
  }
}
