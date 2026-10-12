import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminCancelListingSchema,
  adminHideReviewSchema,
  adminInspectionChargeSchema,
  adminKycDecisionSchema,
  adminLoginSchema,
  adminPriceListAddOnUpsertSchema,
  adminPriceListEntryUpsertSchema,
  adminResolveDisputeSchema,
  adminResolveFraudSchema,
  adminResolveIncidentSchema,
  adminSetConfigSchema,
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
import { AdminConfigService } from './admin-config.service';
import { AdminDisputesService } from './admin-disputes.service';
import { AdminFraudService } from './admin-fraud.service';
import { AdminIncidentsService } from './admin-incidents.service';
import { AdminEmployerService } from './admin-employer.service';
import { AdminKycService } from './admin-kyc.service';
import { AdminListingsService } from './admin-listings.service';
import { AdminOtherJobsService } from './admin-other-jobs.service';
import { AdminPriceListService } from './admin-price-list.service';
import { AdminReviewsService } from './admin-reviews.service';
import { AdminSosService } from './admin-sos.service';

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
    private readonly priceList: AdminPriceListService,
    private readonly sos: AdminSosService,
    private readonly disputes: AdminDisputesService,
    private readonly incidents: AdminIncidentsService,
    private readonly fraud: AdminFraudService,
    private readonly otherJobs: AdminOtherJobsService,
    private readonly config: AdminConfigService,
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

  @Get('sos')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open safety alerts, oldest first (Sub-phase C)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  sosQueue(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.sos.queue(q.cursor, q.limit);
  }

  @Post('sos/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a safety alert resolved after following up' })
  resolveSos(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.sos.resolve(id, admin);
  }

  @Get('disputes')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open disputes, oldest first (Sub-phase D)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  disputesQueue(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.disputes.queue(q.cursor, q.limit);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve a dispute: REFUND_CUSTOMER, PAY_WORKER, or NO_ACTION, with a note',
  })
  @ApiZodBody(adminResolveDisputeSchema)
  resolveDispute(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminResolveDisputeSchema)) body: z.infer<typeof adminResolveDisputeSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.disputes.resolve(id, body, admin);
  }

  @Get('incident-reports')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Open/reviewing incident reports, oldest first (Sub-phase J3)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  incidentsQueue(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.incidents.queue(q.cursor, q.limit);
  }

  @Get('incident-reports/:id/evidence')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The job's photos/event log/chat as evidence for a report. Each view is audit-logged.",
  })
  incidentEvidence(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @CurrentAdmin() admin: AuthAdmin,
    @ClientIp() ip?: string,
  ) {
    return this.incidents.evidence(id, admin, ip);
  }

  @Post('incident-reports/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Resolve a report: CLEAR the hold, or SUSPEND the account (the only permanent path)',
  })
  @ApiZodBody(adminResolveIncidentSchema)
  resolveIncident(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminResolveIncidentSchema)) body: z.infer<typeof adminResolveIncidentSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.incidents.resolve(id, body, admin);
  }

  @Get('fraud-review')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Queued fraud signals, oldest first (Sub-phase K1) — never auto-acted on' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  fraudQueue(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.fraud.queue(q.cursor, q.limit);
  }

  @Post('fraud-review/:id/resolve')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a fraud signal as reviewed' })
  @ApiZodBody(adminResolveFraudSchema)
  resolveFraud(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminResolveFraudSchema)) body: z.infer<typeof adminResolveFraudSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.fraud.resolve(id, admin, body.note);
  }

  @Get('fraud-review/multi-account-candidates')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Accounts sharing a registered device (Sub-phase K2) — phone is already unique per account; no payment fingerprint is stored to check',
  })
  @ApiQuery({ name: 'limit', required: false })
  multiAccountCandidates(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.fraud.multiAccountCandidates(q.limit);
  }

  @Get('other-jobs')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '"Other"-category jobs, newest first; q searches the free-text description (Sub-phase D)',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  browseOtherJobs(@Query(new ZodPipe(browseListingsQuery)) q: z.infer<typeof browseListingsQuery>) {
    return this.otherJobs.browse(q.q, q.cursor, q.limit);
  }

  @Post('other-jobs/:id/cancel')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('DISPUTE_AGENT')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cancel a fraudulent or abusive "other" job, before the Ranger is underway (REQUESTED/BROADCASTING/MATCHED/AGREED only)',
  })
  @ApiZodBody(adminCancelListingSchema)
  cancelOtherJob(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminCancelListingSchema)) body: z.infer<typeof adminCancelListingSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.otherJobs.cancel(id, body.reason, admin);
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

  @Get('config')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'The Phase Commerce/Flow-Final tunables (platform fee %, visit-fee bands, quote ceiling multiple, cash_enabled, ...) with their current and default values',
  })
  listConfig() {
    return this.config.list();
  }

  @Post('config/:key')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set one tunable from the list above' })
  @ApiZodBody(adminSetConfigSchema)
  setConfig(
    @Param('key') key: string,
    @Body(new ZodPipe(adminSetConfigSchema)) body: z.infer<typeof adminSetConfigSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.config.set(key, body.value, admin);
  }

  @Get('price-list')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The full fixed price list (D-080), every category and city tier' })
  listPriceList() {
    return this.priceList.listEntries();
  }

  @Post('price-list')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the price for one (category, city tier)' })
  @ApiZodBody(adminPriceListEntryUpsertSchema)
  upsertPriceListEntry(
    @Body(new ZodPipe(adminPriceListEntryUpsertSchema))
    body: z.infer<typeof adminPriceListEntryUpsertSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.priceList.upsertEntry(body, admin);
  }

  @Get('price-list/add-ons')
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The full add-on catalogue (D-080)' })
  listPriceListAddOns() {
    return this.priceList.listAddOns();
  }

  @Post('price-list/add-ons')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create (no id) or update (with id) a catalogue/labour item — pricePaise is the floor, ceilingMultipleBps an optional per-item override (D-087)',
  })
  @ApiZodBody(adminPriceListAddOnUpsertSchema)
  upsertPriceListAddOn(
    @Body(new ZodPipe(adminPriceListAddOnUpsertSchema))
    body: z.infer<typeof adminPriceListAddOnUpsertSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.priceList.upsertAddOn(body, admin);
  }

  @Post('categories/:id/inspection-charge')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AdminRoles('FINANCE')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set or clear a category\'s fixed inspection charge (A2, uncertain-scope repairs)',
  })
  @ApiZodBody(adminInspectionChargeSchema)
  setInspectionCharge(
    @Param('id', new ZodPipe(z.string().uuid())) id: string,
    @Body(new ZodPipe(adminInspectionChargeSchema))
    body: z.infer<typeof adminInspectionChargeSchema>,
    @CurrentAdmin() admin: AuthAdmin,
  ) {
    return this.priceList.setInspectionCharge(id, body, admin);
  }
}
