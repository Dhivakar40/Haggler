import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { decodeCursor, toPage } from '@haggler/shared';
import type { AuthAdmin } from '../common/decorators';
import { notFound } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { maskPhone } from './admin-kyc.service';

/**
 * Employer verification (Phase 7, D-062): lighter than Ranger KYC — no documents, no tiers, just
 * an admin confirming the business is real before its Campus listings can go live. Contract
 * listings still need no verification (D-056 known gap, deliberately not retrofitted). This is a
 * known simplification, not a claim of business-registry-grade due diligence (D-063).
 */
@Injectable()
export class AdminEmployerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Oldest first: whoever has waited longest is reviewed first. */
  async queue(cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after: Prisma.EmployerProfileWhereInput = c
      ? {
          OR: [
            { createdAt: { gt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { gt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.employerProfile.findMany({
      where: { verified: false, ...after },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { user: { select: { id: true, phone: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        employerId: r.id,
        userId: r.user.id,
        businessName: r.businessName,
        phone: maskPhone(r.user.phone),
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async verify(employerId: string, admin: AuthAdmin): Promise<{ ok: true }> {
    const ep = await this.prisma.employerProfile.findUnique({ where: { id: employerId } });
    if (!ep) throw notFound('Employer not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.employerProfile.update({
        where: { id: employerId },
        data: { verified: true, verifiedAt: new Date() },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'employer.verified',
          entityType: 'employer_profile',
          entityId: employerId,
        },
        tx,
      );
    });
    return { ok: true };
  }
}
