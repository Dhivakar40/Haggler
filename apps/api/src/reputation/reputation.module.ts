import { Global, Module } from '@nestjs/common';
import {
  BlocksController,
  RangerReviewsController,
  ReviewsController,
} from './reputation.controller';
import { BlocksService } from './blocks.service';
import { ReputationConfig } from './reputation-config.service';
import { ReputationService } from './reputation.service';
import { ReviewsService } from './reviews.service';

@Global()
@Module({
  controllers: [ReviewsController, RangerReviewsController, BlocksController],
  providers: [ReputationConfig, ReputationService, ReviewsService, BlocksService],
  exports: [ReputationConfig, ReputationService, ReviewsService, BlocksService],
})
export class ReputationModule {}
