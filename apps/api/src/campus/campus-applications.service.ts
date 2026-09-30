import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type ApplyToCampusInput,
  type CampusApplicationDto,
  type CampusDecisionInput,
  decodeCursor,
  toPage,
} from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampusConfig } from './campus-config.service';
import { CampusListingsService } from './campus-listings.service';
import { StudentProfileService } from './student-profile.service';

const toDto = (row: {
  id: string;
  listingId: string;
  studentId: string;
  student: { fullName: string | null };
  coverNote: string | null;
  acceptsNightShift: boolean;
  status: string;
  appliedAt: Date;
  decidedAt: Date | null;
}): CampusApplicationDto => ({
  id: row.id,
  listingId: row.listingId,
  studentId: row.studentId,
  studentName: row.student.fullName,
  coverNote: row.coverNote,
  acceptsNightShift: row.acceptsNightShift,
  status: row.status as CampusApplicationDto['status'],
  appliedAt: row.appliedAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

const DECISION_TO_STATUS = {
  SHORTLIST: 'SHORTLISTED',
  REJECT: 'REJECTED',
  HIRE: 'HIRED',
} as const;

/**
 * Applying, withdrawing and deciding on Campus applications (Phase 7). Same job-board shape as
 * Contract labour (D-054) plus three safeguards the user required explicitly: a hard 18+ gate
 * (D-060, via StudentProfileService), a weekly hours cap checked at both apply and hire (D-061,
 * since a student can rack up parallel applications and only the hire moment is when a commitment
 * becomes real), and a night-shift opt-in (D-062).
 */
@Injectable()
export class CampusApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: CampusListingsService,
    private readonly students: StudentProfileService,
    private readonly config: CampusConfig,
    private readonly notifications: NotificationsService,
  ) {}

  /** Sum of hoursPerWeek across every CampusListing this student currently holds a HIRED
   * application for. The listing being checked is never itself HIRED yet at either call site
   * (apply: no application exists; decide: still APPLIED/SHORTLISTED), so it's never double
   * counted here. */
  private async committedWeeklyHours(studentId: string): Promise<number> {
    const rows = await this.prisma.campusApplication.findMany({
      where: { studentId, status: 'HIRED' },
      include: { listing: { select: { hoursPerWeek: true } } },
    });
    return rows.reduce((sum, r) => sum + r.listing.hoursPerWeek, 0);
  }

  private async assertWithinHoursCap(studentId: string, addingHours: number): Promise<void> {
    const cfg = await this.config.get();
    const committed = await this.committedWeeklyHours(studentId);
    if (committed + addingHours > cfg.weekly_hours_cap)
      throw unprocessable(
        `This would put you over the ${cfg.weekly_hours_cap}-hour weekly cap (you're already committed to ${committed}h).`,
        { code: 'WEEKLY_HOURS_CAP', committed, cap: cfg.weekly_hours_cap, adding: addingHours },
      );
  }

  async apply(
    userId: string,
    listingId: string,
    input: ApplyToCampusInput,
  ): Promise<CampusApplicationDto> {
    await this.students.assertEligible(userId);
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId === userId)
      throw unprocessable('You cannot apply to your own listing.');
    if (listing.status !== 'OPEN')
      throw conflict('This listing is no longer accepting applications.', {
        code: 'LISTING_CLOSED',
      });
    if (listing.isNightShift && !input.acceptsNightShift)
      throw unprocessable('This job includes night shifts (10 PM-6 AM). Opt in to apply.', {
        code: 'NIGHT_SHIFT_OPT_IN_REQUIRED',
      });
    await this.assertWithinHoursCap(userId, listing.hoursPerWeek);

    const existing = await this.prisma.campusApplication.findUnique({
      where: { listingId_studentId: { listingId, studentId: userId } },
    });
    if (existing && existing.status !== 'WITHDRAWN')
      throw conflict('You already applied to this listing.', { code: 'ALREADY_APPLIED' });

    const row = existing
      ? await this.prisma.campusApplication.update({
          where: { id: existing.id },
          data: {
            status: 'APPLIED',
            coverNote: input.coverNote ?? null,
            acceptsNightShift: input.acceptsNightShift,
            decidedAt: null,
          },
          include: { student: { select: { fullName: true } } },
        })
      : await this.prisma.campusApplication.create({
          data: {
            listingId,
            studentId: userId,
            coverNote: input.coverNote ?? null,
            acceptsNightShift: input.acceptsNightShift,
          },
          include: { student: { select: { fullName: true } } },
        });

    void this.notifications.notify(listing.employer.userId, {
      title: 'New applicant',
      body: `Someone applied to "${listing.title}".`,
      data: { listingId, type: 'campus_application' },
    });
    return toDto(row);
  }

  async withdraw(userId: string, listingId: string): Promise<{ ok: true }> {
    const existing = await this.prisma.campusApplication.findUnique({
      where: { listingId_studentId: { listingId, studentId: userId } },
    });
    if (!existing || existing.status === 'WITHDRAWN') throw notFound('Application not found');
    if (existing.status === 'HIRED') throw unprocessable('You cannot withdraw after being hired.');
    await this.prisma.campusApplication.update({
      where: { id: existing.id },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    });
    return { ok: true };
  }

  /** Employer-only: every application for a listing they own. */
  async forListing(userId: string, listingId: string, cursor: string | undefined, limit: number) {
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId !== userId) throw notFound('Listing not found');
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { appliedAt: { lt: new Date(c.k) } },
            { appliedAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.campusApplication.findMany({
      where: { AND: [{ listingId }, after] },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { student: { select: { fullName: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.appliedAt.toISOString(), id: r.id }));
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  /** A student's own applications, newest first, with a summary of the listing each is for. */
  async mine(userId: string, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { appliedAt: { lt: new Date(c.k) } },
            { appliedAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.campusApplication.findMany({
      where: { AND: [{ studentId: userId }, after] },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        student: { select: { fullName: true } },
        listing: {
          select: { title: true, status: true, employer: { select: { businessName: true } } },
        },
      },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.appliedAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((r) => ({
        ...toDto(r),
        listingTitle: r.listing.title,
        listingStatus: r.listing.status,
        businessName: r.listing.employer.businessName,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async decide(
    userId: string,
    listingId: string,
    applicationId: string,
    input: CampusDecisionInput,
  ): Promise<CampusApplicationDto> {
    const listing = await this.listings.raw(listingId);
    if (listing.employer.userId !== userId) throw notFound('Listing not found');
    const application = await this.prisma.campusApplication.findUnique({
      where: { id: applicationId },
      include: { student: { select: { fullName: true } } },
    });
    if (!application || application.listingId !== listingId)
      throw notFound('Application not found');
    if (application.status !== 'APPLIED' && application.status !== 'SHORTLISTED')
      throw conflict('This application already has a decision.', {
        code: 'DECISION_ALREADY_MADE',
      });
    if (input.decision === 'HIRE') {
      if (listing.status !== 'OPEN')
        throw conflict('This listing is no longer open.', { code: 'LISTING_CLOSED' });
      // Re-check the cap now: other applications may have been hired since this one was applied.
      await this.assertWithinHoursCap(application.studentId, listing.hoursPerWeek);
    }

    const nextStatus = DECISION_TO_STATUS[input.decision];
    let updated: typeof application;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.campusApplication.update({
          where: { id: applicationId },
          data: { status: nextStatus, decidedAt: new Date() },
          include: { student: { select: { fullName: true } } },
        });
        if (input.decision === 'HIRE') await this.listings.incrementFilled(tx, listingId);
        return row;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')
        throw conflict('This application just changed. Refresh and try again.');
      throw err;
    }

    const pushByDecision = {
      SHORTLIST: { title: 'Shortlisted', body: `You were shortlisted for "${listing.title}".` },
      REJECT: {
        title: 'Application update',
        body: `You were not selected for "${listing.title}".`,
      },
      HIRE: { title: "You're hired!", body: `You were hired for "${listing.title}".` },
    } as const;
    void this.notifications.notify(application.studentId, {
      ...pushByDecision[input.decision],
      data: { listingId, type: 'campus_decision' },
    });
    return toDto(updated);
  }
}
