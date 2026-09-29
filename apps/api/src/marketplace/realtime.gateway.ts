import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { locationUpdateSchema, SOCKET_EVENTS, sendMessageSchema } from '@haggler/shared';
import { z } from 'zod';
import { JWT_AUDIENCE_USER, JWT_ISSUER } from '../auth/auth.constants';
import type { AccessClaims } from '../auth/token.service';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ChatService } from './chat.service';
import { MatchingService } from './matching.service';
import { PresenceService } from './presence.service';

type Ack = { ok: true; data?: unknown } | { ok: false; code: string; message: string };

const acceptSchema = z.object({ requestId: z.string().uuid() });
const chatSchema = sendMessageSchema.extend({ threadId: z.string().uuid() });

/**
 * Socket.IO endpoint. A client connects with its access token (`auth: { token }`); we verify it,
 * check the account is active and put the socket in the private room `user:<id>`. From then on
 * the server pushes: request.broadcast, request.taken, request.matched, request.timeout,
 * job.updated, offer.updated, location.update, chat.message.
 * Clients may send: location.update, chat.message, request.accept (each acknowledged).
 * The REST endpoints do the same jobs, so the app still works if the socket is down.
 * (Single instance today: scaling out needs the Socket.IO Redis adapter. See DECISIONS D-031.)
 */
@WebSocketGateway({ cors: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly matching: MatchingService,
    private readonly chat: ChatService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = (client.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) throw new Error('missing token');
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.env.env.JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_USER,
      });
      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, status: true, roles: { select: { role: true } } },
      });
      if (!user || user.status !== 'ACTIVE') throw new Error('inactive');
      client.data.userId = user.id;
      client.data.isRanger = user.roles.some((r) => r.role === 'WORKER');
      await client.join(`user:${user.id}`);
    } catch {
      client.emit('error.auth', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
    }
  }

  private async guard(client: Socket, fn: () => Promise<unknown>): Promise<Ack> {
    if (!client.data.userId)
      return { ok: false, code: 'UNAUTHENTICATED', message: 'Not signed in.' };
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      const r = (
        err as {
          getResponse?: () => { code?: string; message?: string; details?: { code?: string } };
        }
      ).getResponse?.();
      return {
        ok: false,
        code: r?.details?.code ?? r?.code ?? 'ERROR',
        message: r?.message ?? 'Something went wrong.',
      };
    }
  }

  @SubscribeMessage(SOCKET_EVENTS.location)
  onLocation(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.guard(client, async () => {
      if (!client.data.isRanger) throw new Error('Only Rangers send location');
      return this.presence.updateLocation(client.data.userId, locationUpdateSchema.parse(body));
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.accept)
  onAccept(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.guard(client, async () => {
      if (!client.data.isRanger) throw new Error('Only Rangers can accept');
      return this.matching.accept(client.data.userId, acceptSchema.parse(body).requestId);
    });
  }

  @SubscribeMessage(SOCKET_EVENTS.chat)
  onChat(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    return this.guard(client, async () => {
      const m = chatSchema.parse(body);
      return this.chat.send(client.data.userId, m.threadId, {
        clientMsgId: m.clientMsgId,
        body: m.body,
      });
    });
  }
}
