import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type ChatMessageDto, decodeCursor, SOCKET_EVENTS, toPage } from '@haggler/shared';
import { notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const toDto = (m: {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  clientMsgId: string;
  createdAt: Date;
}): ChatMessageDto => ({
  id: m.id,
  threadId: m.threadId,
  senderId: m.senderId,
  body: m.body,
  clientMsgId: m.clientMsgId,
  createdAt: m.createdAt.toISOString(),
});

/**
 * In-app chat between the customer and the matched Ranger. Real phone numbers are never shared
 * (masked calling is out of scope, D-019), so chat is the only way to talk. Messages are persisted
 * before they are pushed, and a client-generated id makes a retried send idempotent.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Only the two parties of the thread's job may read or write it (else 404). */
  private async thread(threadId: string, userId: string) {
    const t = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      include: { job: { select: { id: true, customerId: true, workerId: true } } },
    });
    if (!t || (t.job.customerId !== userId && t.job.workerId !== userId))
      throw notFound('Conversation not found');
    return t;
  }

  async threadForJob(jobId: string, userId: string) {
    const t = await this.prisma.chatThread.findUnique({
      where: { jobId },
      include: { job: { select: { customerId: true, workerId: true } } },
    });
    if (!t || (t.job.customerId !== userId && t.job.workerId !== userId))
      throw notFound('Conversation not found');
    return { id: t.id, jobId };
  }

  async send(
    userId: string,
    threadId: string,
    input: { clientMsgId: string; body: string },
  ): Promise<ChatMessageDto> {
    const t = await this.thread(threadId, userId);
    let row;
    let created = true;
    try {
      row = await this.prisma.chatMessage.create({
        data: { threadId, senderId: userId, body: input.body, clientMsgId: input.clientMsgId },
      });
    } catch (err) {
      // Same (thread, sender, clientMsgId) again = a retry after a dropped connection: return the original.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        row = await this.prisma.chatMessage.findFirstOrThrow({
          where: { threadId, senderId: userId, clientMsgId: input.clientMsgId },
        });
        created = false;
      } else throw err;
    }
    const dto = toDto(row);
    if (created) {
      const other = t.job.customerId === userId ? t.job.workerId : t.job.customerId;
      if (other) this.realtime.emitToUser(other, SOCKET_EVENTS.chat, dto);
    }
    return dto;
  }

  /** Newest first, cursor-paginated. */
  async list(userId: string, threadId: string, cursor: string | undefined, limit: number) {
    await this.thread(threadId, userId);
    const c = cursor ? decodeCursor(cursor) : null;
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        ...(c
          ? {
              OR: [
                { createdAt: { lt: new Date(c.k) } },
                { createdAt: new Date(c.k), id: { lt: c.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }
}
