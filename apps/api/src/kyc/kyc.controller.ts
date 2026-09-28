import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { kycDocumentRequestSchema, kycStartSchema, kycSubmitSchema } from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { KycService } from './kyc.service';

/**
 * Identity verification for Rangers. Reviewed by a human admin (D-016): nothing here calls an
 * automated eKYC, face-match or background-check service.
 */
@ApiTags('kyc')
@ApiBearerAuth()
@Roles('WORKER')
@Controller({ path: 'kyc', version: '1' })
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Open a tier 1 (identity) or tier 2 (go-live) verification. Needs KYC consent.',
  })
  @ApiZodBody(kycStartSchema)
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(kycStartSchema)) body: z.infer<typeof kycStartSchema>,
  ) {
    return this.kyc.start(user.id, body.tier);
  }

  @Post('documents')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a presigned URL (valid 5 min) to upload one document straight to private storage',
  })
  @ApiZodBody(kycDocumentRequestSchema)
  presign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(kycDocumentRequestSchema)) body: z.infer<typeof kycDocumentRequestSchema>,
  ) {
    return this.kyc.presign(user.id, body);
  }

  @Post('documents/:id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm that the upload finished; verifies the file exists at the declared size',
  })
  confirm(@CurrentUser() user: AuthUser, @Param('id', new ZodPipe(z.string().uuid())) id: string) {
    return this.kyc.confirmUpload(user.id, id);
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit the verification for admin review (tier 2 also needs a reference)',
  })
  @ApiZodBody(kycSubmitSchema)
  submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(kycSubmitSchema)) body: z.infer<typeof kycSubmitSchema>,
  ) {
    return this.kyc.submit(user.id, body);
  }

  @Get('status')
  @ApiOperation({
    summary: 'My verification tier and the state of each check, including reviewer messages',
  })
  status(@CurrentUser() user: AuthUser) {
    return this.kyc.status(user.id);
  }
}
