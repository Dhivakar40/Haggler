import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { adminKycDecisionSchema, adminLoginSchema } from '@haggler/shared';
import { z } from 'zod';
import {
  AdminRoles,
  ApiZodBody,
  ClientIp,
  CurrentAdmin,
  Public,
  type AuthAdmin,
} from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AdminAuthGuard, AdminAuthService } from './admin-auth';
import { AdminEmployerService } from './admin-employer.service';
import { AdminKycService } from './admin-kyc.service';

const queueQuery = z.object({
  status: z
    .enum(['PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED'])
    .default('PENDING_REVIEW'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('admin')
@Public() // skips the *user* JWT guard; AdminAuthGuard below protects every route except login
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly kyc: AdminKycService,
    private readonly employers: AdminEmployerService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Admin sign-in (email + password). 5 wrong attempts per email locks it for 15 minutes.',
  })
  @ApiZodBody(adminLoginSchema)
  login(
    @Body(new ZodPipe(adminLoginSchema)) body: z.infer<typeof adminLoginSchema>,
    @ClientIp() ip?: string,
  ) {
    return this.auth.login(body, ip);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Who am I (admin)' })
  me(@CurrentAdmin() admin: AuthAdmin) {
    return admin;
  }

  @Get('kyc/queue')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('KYC_REVIEWER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'KYC review queue, oldest first, cursor-paginated' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED'],
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  queue(@Query(new ZodPipe(queueQuery)) q: z.infer<typeof queueQuery>) {
    return this.kyc.queue(q.status, q.cursor, q.limit);
  }

  @Get('kyc/:id')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('KYC_REVIEWER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'One verification with short-lived image links. Each view is audit-logged.',
  })
  detail(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @CurrentAdmin() admin: AuthAdmin,
    @ClientIp() ip?: string,
  ) {
    return this.kyc.detail(id, admin, ip);
  }

  @Post('kyc/:id/decision')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('KYC_REVIEWER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve, reject (reason required) or request more information' })
  @ApiZodBody(adminKycDecisionSchema)
  decide(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminKycDecisionSchema)) body: z.infer<typeof adminKycDecisionSchema>,
    @CurrentAdmin() admin: AuthAdmin,
    @ClientIp() ip?: string,
  ) {
    return this.kyc.decide(id, admin, body, ip);
  }

  @Get('employers/queue')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('KYC_REVIEWER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unverified employers, oldest first (Phase 7 gate for Campus listings, D-062)',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  employerQueue(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.employers.queue(q.cursor, q.limit);
  }

  @Post('employers/:id/verify')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('KYC_REVIEWER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm this is a real business (unlocks Campus listings for them)' })
  verifyEmployer(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.employers.verify(id, admin);
  }
}
