import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { PushMessage } from '../adapters/push/push.provider';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The one place the rest of the app talks to WebSockets. Every user has a private room
 * `user:<id>`, joined when their socket authenticates, so "tell this person" is one call.
 * If no socket is connected the emit is a no-op: state lives in Postgres and clients re-read it
 * (GET /jobs/:id, GET /worker/incoming) when they reconnect, so a dropped socket never loses truth.
 *
 * Phase 5: callers that pass a `push` payload also get a best-effort push notification sent when
 * the user has no socket connected right now (mobile sockets don't survive backgrounding, so
 * "connected a moment ago" is not "reachable now" — this is deliberately a point-in-time check,
 * not a promise the user will never get a redundant push). See NotificationsService.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly notifications: NotificationsService) {}

  attach(server: Server): void {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown, push?: PushMessage): void {
    if (this.server) {
      try {
        this.server.to(`user:${userId}`).emit(event, payload);
      } catch (err) {
        this.logger.warn(`emit ${event} failed: ${String(err)}`);
      }
    }
    if (push) {
      // fetchSockets() asks the whole cluster (via the Redis adapter, when attached), not just
      // this process, so a user connected to a different API instance still counts as reachable.
      void this.socketCount(userId).then((n) => {
        if (n === 0) return this.notifications.notify(userId, push);
      });
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown, push?: PushMessage): void {
    for (const id of new Set(userIds)) this.emitToUser(id, event, payload, push);
  }

  /** How many sockets a user has open (for tests and diagnostics). */
  async socketCount(userId: string): Promise<number> {
    return this.server ? (await this.server.in(`user:${userId}`).fetchSockets()).length : 0;
  }
}
