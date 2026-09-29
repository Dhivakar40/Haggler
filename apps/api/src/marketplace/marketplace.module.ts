import { Global, Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.service';
import { CatalogModule } from '../catalog/catalog.module';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatService } from './chat.service';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';
import { LifecycleService } from './lifecycle.service';
import { MarketplaceConfig } from './marketplace-config.service';
import { MatchingService } from './matching.service';
import { OffersService } from './offers.service';
import { PresenceService } from './presence.service';
import { PublicTrackController, PublicTrackPageController } from './public-track.controller';
import { RealtimeGateway } from './realtime.gateway';
import {
  ChatController,
  JobsController,
  OffersController,
  RequestsController,
} from './requests.controller';
import { RequestsService } from './requests.service';
import { SchedulerService } from './scheduler.service';
import { TrackingService } from './tracking.service';
import { WorkerPresenceController } from './worker-presence.controller';

@Global()
@Module({
  imports: [StorageModule, CatalogModule],
  controllers: [
    RequestsController,
    JobsController,
    OffersController,
    ChatController,
    WorkerPresenceController,
    PublicTrackController,
    PublicTrackPageController,
  ],
  providers: [
    RealtimeService,
    MarketplaceConfig,
    PresenceService,
    JobTransitions,
    JobViewService,
    MatchingService,
    RequestsService,
    OffersService,
    LifecycleService,
    ChatService,
    TrackingService,
    SchedulerService,
    RealtimeGateway,
  ],
  exports: [
    RealtimeService,
    MarketplaceConfig,
    PresenceService,
    MatchingService,
    SchedulerService,
    JobTransitions,
    JobViewService,
    OffersService,
    LifecycleService,
    RequestsService,
    ChatService,
    TrackingService,
  ],
})
export class MarketplaceModule {}
