import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminCancelListingSchema,
  adminHideReviewSchema,
  adminKycDecisionSchema,
  adminLoginSchema,
} from '@haggler/shared';
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
import { AdminListingsService } from './admin-listings.service';
import { AdminReviewsService } from './admin-reviews.service';

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
const reviewsQuery = listQuery.extend({ revieweeId: z.string().uuid().optional() });
const browseListingsQuery = listQuery.extend({ q: z.string().min(1).optional() });

@ApiTags('admin')
@Public() // skips the *user* JWT guard; AdminAuthGuard below protects every route except login
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly kyc: AdminKycService,
    private readonly employers: AdminEmployerService,
    private readonly reviews: AdminReviewsService,
    private readonly listings: AdminListingsService,
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

  @Get('reviews')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reviews, newest first; filter to one person with revieweeId (Phase 8, D-049)',
  })
  @ApiQuery({ name: 'revieweeId', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  reviewsQueue(@Query(new ZodPipe(reviewsQuery)) q: z.infer<typeof reviewsQuery>) {
    return this.reviews.queue(q.revieweeId, q.cursor, q.limit);
  }

  @Post('reviews/:id/hide')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hide a fraudulent or abusive review (reverses its rating out of the aggregate)',
  })
  @ApiZodBody(adminHideReviewSchema)
  hideReview(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminHideReviewSchema)) body: z.infer<typeof adminHideReviewSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.reviews.hide(id, body.reason, admin);
  }

  @Get('contract-listings')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Browse Contract listings; q searches the title (Phase 8, D-059)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  browseContracts(@Query(new ZodPipe(browseListingsQuery)) q: z.infer<typeof browseListingsQuery>) {
    return this.listings.browseContracts(q.q, q.cursor, q.limit);
  }

  @Post('contract-listings/:id/cancel')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Take down a fraudulent or abusive Contract listing' })
  @ApiZodBody(adminCancelListingSchema)
  cancelContract(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminCancelListingSchema)) body: z.infer<typeof adminCancelListingSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.listings.cancelContract(id, body.reason, admin);
  }

  @Get('campus-listings')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Browse Campus listings; q searches the title (Phase 8, D-059)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  browseCampus(@Query(new ZodPipe(browseListingsQuery)) q: z.infer<typeof browseListingsQuery>) {
    return this.listings.browseCampus(q.q, q.cursor, q.limit);
  }

  @Post('campus-listings/:id/cancel')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Take down a fraudulent or abusive Campus listing' })
  @ApiZodBody(adminCancelListingSchema)
  cancelCampus(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminCancelListingSchema)) body: z.infer<typeof adminCancelListingSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.listings.cancelCampus(id, body.reason, admin);
  }
}
