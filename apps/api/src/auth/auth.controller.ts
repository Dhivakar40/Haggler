import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { logoutSchema, otpSendSchema, otpVerifySchema, refreshSchema } from '@haggler/shared';
import type { z } from 'zod';
import { ApiZodBody, ClientIp, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

/** Auth routes are public but limited to 30 requests/min per IP, a coarse flood guard that sits above the precise per-phone and per-IP OTP quotas (which must trip first). */
const STRICT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('auth')
@Public()
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/send')
  @HttpCode(200)
  @Throttle(STRICT)
  @ApiOperation({
    summary:
      'Send a 6-digit code by SMS. Limits: 30 s between codes, 5/hour per phone, 20/hour per IP.',
  })
  @ApiZodBody(otpSendSchema)
  send(
    @Body(new ZodPipe(otpSendSchema)) body: z.infer<typeof otpSendSchema>,
    @ClientIp() ip?: string,
  ) {
    return this.auth.sendOtp(body.phone, ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Verify the code. Creates the account on first sign-in and returns a session.',
  })
  @ApiZodBody(otpVerifySchema)
  verify(
    @Body(new ZodPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>,
    @ClientIp() ip?: string,
  ) {
    return this.auth.verifyOtp(body, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(STRICT)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair. The old refresh token stops working.',
  })
  @ApiZodBody(refreshSchema)
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'End this session (revokes the refresh token family). Always succeeds.',
  })
  @ApiZodBody(logoutSchema)
  async logout(@Body(new ZodPipe(logoutSchema)) body: z.infer<typeof logoutSchema>) {
    await this.auth.logout(body.refreshToken);
  }
}
