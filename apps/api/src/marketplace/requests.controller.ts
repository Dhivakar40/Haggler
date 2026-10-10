import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createRequestSchema,
  jobPhotoPresignRequestSchema,
  mediaPresignRequestSchema,
  verifyArrivalSchema,
  completeJobSchema,
  cancelJobSchema,
  quoteInputSchema,
  sendMessageSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';
import { JobViewService } from './job-view.service';
import { LifecycleService } from './lifecycle.service';
import { MatchingService } from './matching.service';
import { QuotesService } from './quotes.service';
import { RequestsService } from './requests.service';
import { TrackingService } from './tracking.service';

const id = new ZodPipe(z.string().uuid());
const listQuery = z.object({
  role: z.enum(['CUSTOMER', 'WORKER']).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('requests')
@ApiBearerAuth()
@Controller({ path: 'requests', version: '1' })
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly matching: MatchingService,
  ) {}

  @Post('media')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a presigned URL to upload a request photo (max 5) or a voice note (max 60 s)',
  })
  @ApiZodBody(mediaPresignRequestSchema)
  presign(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(mediaPresignRequestSchema)) body: z.infer<typeof mediaPresignRequestSchema>,
  ) {
    return this.requests.presignMedia(u.id, body);
  }

  @Post('media/:mediaId/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm that a media upload finished' })
  confirmMedia(@CurrentUser() u: AuthUser, @Param('mediaId', id) mediaId: string) {
    return this.requests.confirmMedia(u.id, mediaId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a service request. Immediate requests start broadcasting to nearby Rangers at once.',
  })
  @ApiZodBody(createRequestSchema)
  async create(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(createRequestSchema)) body: z.infer<typeof createRequestSchema>,
  ) {
    return (await this.requests.create(u.id, body)).dto;
  }

  @Get(':id')
  @ApiOperation({ summary: 'A request/job as seen by me (customer or matched Ranger)' })
  get(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.requests.getByRequest(requestId, u.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a request that has not been matched yet' })
  cancel(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.requests.cancelRequest(u.id, requestId);
  }

  @Post(':id/rebroadcast')
  @HttpCode(200)
  @ApiOperation({ summary: 'Try again after a timeout: invites Rangers from wave 1 again' })
  rebroadcast(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.requests.rebroadcast(u.id, requestId);
  }

  @Post(':id/rush')
  @ApiOperation({
    summary:
      'Pay a Rush fee to skip wave sequencing on this request (D-069): creates a payment order',
  })
  rush(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.requests.rush(u.id, requestId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({
    summary: 'Ranger: accept a request. First accept wins; everyone else gets 409 REQUEST_TAKEN.',
  })
  accept(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.matching.accept(u.id, requestId);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({ summary: 'Ranger: decline a request' })
  decline(@CurrentUser() u: AuthUser, @Param('id', id) requestId: string) {
    return this.matching.decline(u.id, requestId);
  }
}

@ApiTags('jobs')
@ApiBearerAuth()
@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly view: JobViewService,
    private readonly quotes: QuotesService,
    private readonly life: LifecycleService,
    private readonly tracking: TrackingService,
    private readonly chat: ChatService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My jobs (as customer and/or Ranger), newest first, cursor-paginated' })
  @ApiQuery({ name: 'role', required: false, enum: ['CUSTOMER', 'WORKER'] })
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.requests.listJobs(u.id, q.role, q.cursor, q.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One job with everything I am allowed to see' })
  get(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.view.build(jobId, u.id);
  }

  @Post(':id/quotes')
  @Roles('WORKER')
  @ApiOperation({
    summary:
      '"Other" category only (D-080, A4): send one quote. One per Ranger per request, no counters.',
  })
  @ApiZodBody(quoteInputSchema)
  sendQuote(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(quoteInputSchema)) body: z.infer<typeof quoteInputSchema>,
  ) {
    return this.quotes.submit(u.id, jobId, body);
  }

  @Post(':id/quotes/:quoteId/withdraw')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({ summary: 'Ranger: withdraw my own unaccepted quote' })
  withdrawQuote(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Param('quoteId', id) quoteId: string,
  ) {
    return this.quotes.withdraw(u.id, jobId, quoteId);
  }

  @Post(':id/quotes/:quoteId/accept')
  @HttpCode(200)
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Customer: accept one quote. Performs the match at that price; declines the rest.',
  })
  acceptQuote(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Param('quoteId', id) quoteId: string,
  ) {
    return this.quotes.accept(u.id, jobId, quoteId);
  }

  @Post(':id/quotes/:quoteId/decline')
  @HttpCode(200)
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Customer: decline one quote without matching' })
  declineQuote(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Param('quoteId', id) quoteId: string,
  ) {
    return this.quotes.decline(u.id, jobId, quoteId);
  }

  @Post(':id/en-route')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({ summary: 'Ranger: on my way (after the price is agreed)' })
  enRoute(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.life.enRoute(u.id, jobId);
  }

  @Post(':id/arrive')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({
    summary:
      "Ranger: I have arrived. Needs GPS within the geofence; generates the customer's 4-digit code.",
  })
  arrive(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.life.arrive(u.id, jobId);
  }

  @Post(':id/verify-arrival')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({ summary: 'Ranger: enter the 4-digit code the customer reads out (max 5 tries)' })
  @ApiZodBody(verifyArrivalSchema)
  verify(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(verifyArrivalSchema)) body: z.infer<typeof verifyArrivalSchema>,
  ) {
    return this.life.verifyArrival(u.id, jobId, body.code);
  }

  @Post(':id/photos')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({
    summary:
      'Ranger: presigned upload for the BEFORE (required to start) or AFTER (required to finish) photo',
  })
  @ApiZodBody(jobPhotoPresignRequestSchema)
  photo(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(jobPhotoPresignRequestSchema))
    body: z.infer<typeof jobPhotoPresignRequestSchema>,
  ) {
    return this.life.presignPhoto(u.id, jobId, body);
  }

  @Post(':id/photos/:photoId/confirm')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({ summary: 'Ranger: confirm a job photo upload' })
  confirmPhoto(@CurrentUser() u: AuthUser, @Param('photoId', id) photoId: string) {
    return this.life.confirmPhoto(u.id, photoId);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({
    summary: 'Ranger: start work. Needs the arrival code verified and a before photo.',
  })
  start(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.life.start(u.id, jobId);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Roles('WORKER')
  @ApiOperation({
    summary: 'Ranger: work finished (needs an after photo). Records how the customer will pay.',
  })
  @ApiZodBody(completeJobSchema)
  complete(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(completeJobSchema)) body: z.infer<typeof completeJobSchema>,
  ) {
    return this.life.complete(u.id, jobId, body.paymentMethod);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: confirm the work is done' })
  confirm(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.life.confirm(u.id, jobId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel the job (either party, until work starts). Fee flag only if the Ranger already travelled far.',
  })
  @ApiZodBody(cancelJobSchema)
  cancel(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(cancelJobSchema)) body: z.infer<typeof cancelJobSchema>,
  ) {
    return this.life.cancel(u.id, jobId, body.reason);
  }

  @Post(':id/report-no-show')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Report a no-show after the grace period (customer: Ranger; Ranger: customer)',
  })
  noShow(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.life.reportNoShow(u.id, jobId);
  }

  @Get(':id/track')
  @ApiOperation({ summary: 'Live location and trail of the Ranger while the job is active' })
  track(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.tracking.track(u.id, jobId);
  }

  @Post(':id/share-link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: create a 12-hour live-trip link for a trusted contact' })
  share(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.tracking.createShare(u.id, jobId);
  }

  @Post(':id/share-link/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: revoke all live-trip links for this job' })
  revoke(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.tracking.revokeShares(u.id, jobId);
  }

  @Get(':id/thread')
  @ApiOperation({ summary: 'The chat thread for this job' })
  thread(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.chat.threadForJob(jobId, u.id);
  }
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'threads', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id/messages')
  @ApiOperation({ summary: 'Messages, newest first, cursor-paginated' })
  messages(
    @CurrentUser() u: AuthUser,
    @Param('id', id) threadId: string,
    @Query(new ZodPipe(listQuery.omit({ role: true }))) q: { cursor?: string; limit: number },
  ) {
    return this.chat.list(u.id, threadId, q.cursor, q.limit);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary:
      'Send a message (idempotent on clientMsgId). The WebSocket event chat.message does the same.',
  })
  @ApiZodBody(sendMessageSchema)
  send(
    @CurrentUser() u: AuthUser,
    @Param('id', id) threadId: string,
    @Body(new ZodPipe(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>,
  ) {
    return this.chat.send(u.id, threadId, body);
  }
}
