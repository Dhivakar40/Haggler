import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createTopupOrderSchema, verifyTopupSchema } from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, Public, type AuthUser } from '../common/decorators';
import { unprocessable } from '../common/http-errors';
import { ZodPipe } from '../common/zod.pipe';
import { WalletService } from './wallet.service';

const id = new ZodPipe(z.string().uuid());
const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('wallet')
@ApiBearerAuth()
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'My token balance, held tokens, and the last 20 ledger entries' })
  summary(@CurrentUser() u: AuthUser) {
    return this.wallet.summary(u.id);
  }

  @Get('bundles')
  @ApiOperation({ summary: 'Purchasable token bundles' })
  bundles() {
    return this.wallet.listBundles();
  }

  @Get('orders')
  @ApiOperation({ summary: 'My top-up purchase history, newest first' })
  orders(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.wallet.listOrders(u.id, q.cursor, q.limit);
  }

  @Post('topup')
  @ApiOperation({ summary: 'Start a top-up: creates a payment order for a token bundle' })
  @ApiZodBody(createTopupOrderSchema)
  createOrder(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(createTopupOrderSchema)) body: z.infer<typeof createTopupOrderSchema>,
  ) {
    return this.wallet.createTopupOrder(u.id, body.bundleId);
  }

  @Post('topup/:orderId/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: "Verify Razorpay Checkout's success callback and credit the wallet (idempotent)",
  })
  @ApiZodBody(verifyTopupSchema)
  verify(
    @CurrentUser() u: AuthUser,
    @Param('orderId', id) orderId: string,
    @Body(new ZodPipe(verifyTopupSchema)) body: z.infer<typeof verifyTopupSchema>,
  ) {
    return this.wallet.verifyTopup(u.id, orderId, body.razorpayPaymentId, body.razorpaySignature);
  }

  @Post('topup/:orderId/sandbox-pay')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dev/test only: complete a sandbox order instantly (refused when PAYMENTS_MODE=test)',
  })
  sandboxPay(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string) {
    return this.wallet.sandboxPay(u.id, orderId);
  }
}

/**
 * Razorpay calls this directly (no user session, no CSRF token — just its own HMAC signature over
 * the raw body). It is the authoritative confirmation path; the client's /verify call above is a
 * fast-path for the UI and race-safe against this one (whichever arrives first wins).
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'webhooks/razorpay', version: '1' })
export class RazorpayWebhookController {
  constructor(private readonly wallet: WalletService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Missing webhook body or signature');
    try {
      await this.wallet.handleWebhook(req.rawBody.toString('utf8'), signature);
    } catch (err) {
      // Razorpay retries on non-2xx; an invalid signature should not be retried forever, so this
      // still returns 200 to acknowledge receipt while making the rejection visible in logs.
      if (err instanceof Error && err.message.includes('signature')) return { received: true };
      throw unprocessable('Webhook could not be processed.');
    }
    return { received: true };
  }
}
