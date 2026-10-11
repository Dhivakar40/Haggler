import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { settleDuesSchema, withdrawSchema } from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { WorkerWalletService } from './worker-wallet.service';

/** Phase Commerce B3/B4/B6: a Ranger's earnings and dues. Rangers are never charged a commission
 * — dues are the platform's fee from CASH jobs the Ranger already collected in full, not a
 * deduction from their share of the service price. */
@ApiTags('worker-wallet')
@ApiBearerAuth()
@Controller({ path: 'worker/wallet', version: '1' })
export class WorkerWalletController {
  constructor(private readonly wallet: WorkerWalletService) {}

  @Get()
  @ApiOperation({ summary: 'My earnings balance, dues owed, and the last 20 ledger entries' })
  summary(@CurrentUser() u: AuthUser) {
    return this.wallet.summary(u.id);
  }

  @Post('dues/settle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pay down dues (sandbox UPI simulation, B4)' })
  @ApiZodBody(settleDuesSchema)
  settleDues(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(settleDuesSchema)) body: z.infer<typeof settleDuesSchema>,
  ) {
    return this.wallet.settleDues(u.id, body.amountPaise);
  }

  @Post('withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw from the earnings balance (sandbox payout, B6)' })
  @ApiZodBody(withdrawSchema)
  withdraw(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(withdrawSchema)) body: z.infer<typeof withdrawSchema>,
  ) {
    return this.wallet.withdraw(u.id, body.amountPaise);
  }
}
