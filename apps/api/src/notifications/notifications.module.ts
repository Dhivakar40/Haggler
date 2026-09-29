import { Global, Module } from '@nestjs/common';
import { PushProviderModule } from '../adapters/push/push.provider';
import { NotificationsService } from './notifications.service';

/**
 * Push notifications (Phase 5). Global so RealtimeService (and anything else) can inject
 * NotificationsService without every consuming module having to import this one.
 */
@Global()
@Module({
  imports: [PushProviderModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
