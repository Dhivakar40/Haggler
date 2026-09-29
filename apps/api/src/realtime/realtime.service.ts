import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * The one place the rest of the app talks to WebSockets. Every user has a private room
 * `user:<id>`, joined when their socket authenticates, so "tell this person" is one call.
 * If no socket is connected the emit is a no-op: state lives in Postgres and clients re-read it
 * (GET /jobs/:id, GET /worker/incoming) when they reconnect, so a dropped socket never loses truth.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    try {
      this.server.to(`user:${userId}`).emit(event, payload);
    } catch (err) {
      this.logger.warn(`emit ${event} failed: ${String(err)}`);
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const id of new Set(userIds)) this.emitToUser(id, event, payload);
  }

  /** How many sockets a user has open (for tests and diagnostics). */
  async socketCount(userId: string): Promise<number> {
    return this.server ? (await this.server.in(`user:${userId}`).fetchSockets()).length : 0;
  }
}
