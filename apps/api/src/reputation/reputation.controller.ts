import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { blockUserSchema, submitReviewSchema } from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BlocksService } from './blocks.service';
import { ReviewsService } from './reviews.service';

const id = new ZodPipe(z.string().uuid());
const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@ApiTags('reviews')
@ApiBearerAuth()
@Controller({ path: 'jobs', version: '1' })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  @ApiOperation({
    summary: 'Leave a review for the other party (once, only once the job is confirmed complete)',
  })
  @ApiZodBody(submitReviewSchema)
  submit(
    @CurrentUser() u: AuthUser,
    @Param('id', id) jobId: string,
    @Body(new ZodPipe(submitReviewSchema)) body: z.infer<typeof submitReviewSchema>,
  ) {
    return this.reviews.submit(u.id, jobId, body);
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'Both reviews for this job, and whether I can/did review' })
  forJob(@CurrentUser() u: AuthUser, @Param('id', id) jobId: string) {
    return this.reviews.forJob(u.id, jobId);
  }
}

@ApiTags('reviews')
@ApiBearerAuth()
@Controller({ path: 'rangers', version: '1' })
export class RangerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  @ApiOperation({ summary: "A Ranger's review history from customers, newest first" })
  forWorker(
    @Param('id', id) workerId: string,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.reviews.forWorker(workerId, q.cursor, q.limit);
  }
}

@ApiTags('blocks')
@ApiBearerAuth()
@Controller({ path: 'me/blocks', version: '1' })
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'People I have blocked' })
  list(@CurrentUser() u: AuthUser) {
    return this.blocks.list(u.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Block someone: they will never be matched with me again, in either direction',
  })
  @ApiZodBody(blockUserSchema)
  block(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(blockUserSchema)) body: z.infer<typeof blockUserSchema>,
  ) {
    return this.blocks.block(u.id, body.userId, body.reason);
  }

  @Delete(':userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unblock someone' })
  unblock(@CurrentUser() u: AuthUser, @Param('userId', id) userId: string) {
    return this.blocks.unblock(u.id, userId);
  }
}
