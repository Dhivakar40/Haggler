import { Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

const firstName = (fullName: string | null): string | null =>
  fullName ? (fullName.trim().split(/\s+/)[0] ?? null) : null;

/**
 * Blocking (Phase 4): the matching engine has excluded blocked pairs in either direction since
 * Phase 2 (presence.service.ts's candidate query) — this is the user-facing side of it. Blocking
 * is one-directional to create (only the blocker's list changes) but the matching exclusion checks
 * both directions, so a blocked Ranger is protected too without needing to block back.
 */
@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async block(userId: string, targetUserId: string, reason?: string | null) {
    if (userId === targetUserId) throw unprocessable('You cannot block yourself.');
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) throw notFound('User not found');
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetUserId } },
      update: { reason: reason ?? null },
      create: { blockerId: userId, blockedId: targetUserId, reason: reason ?? null },
    });
    return { blocked: true };
  }

  async unblock(userId: string, targetUserId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: targetUserId } });
    return { blocked: false };
  }

  async list(userId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.blockedId) } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, firstName(u.fullName)]));
    return rows.map((r) => ({
      userId: r.blockedId,
      firstName: nameById.get(r.blockedId) ?? null,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
