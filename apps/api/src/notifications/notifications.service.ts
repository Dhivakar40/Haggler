import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from '../adapters/push/push.provider';

/**
 * The one place the rest of the app asks "send this person a push notification". Looks up every
 * device the user has registered a push token on, hands them to the active adapter (sandbox or
 * FCM — see PushProviderModule), and prunes tokens the adapter reports as dead so we stop retrying
 * them. Never throws: a push failing must never fail the request that triggered it (same principle
 * as RealtimeService's socket emits — state lives in Postgres, the notification is a convenience).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async notify(userId: string, message: PushMessage): Promise<void> {
    try {
      const devices = await this.prisma.device.findMany({
        where: { userId, pushToken: { not: null } },
        select: { pushToken: true },
      });
      const tokens = devices.map((d) => d.pushToken).filter((t): t is string => !!t);
      if (tokens.length === 0) return;
      const { invalidTokens } = await this.push.send(tokens, message);
      if (invalidTokens.length > 0) {
        await this.prisma.device.updateMany({
          where: { userId, pushToken: { in: invalidTokens } },
          data: { pushToken: null },
        });
      }
    } catch (err) {
      this.logger.warn(`push to ${userId} failed: ${String(err)}`);
    }
  }

  async notifyMany(userIds: string[], message: PushMessage): Promise<void> {
    await Promise.all([...new Set(userIds)].map((id) => this.notify(id, message)));
  }
}
