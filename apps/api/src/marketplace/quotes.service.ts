import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, OTHER_CATEGORY_SLUG, SOCKET_EVENTS, type QuoteInput } from '@haggler/shared';
import { CodedException, conflict, forbidden, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';

/**
 * D-080 (A4): the "other"-category quote flow — Rangers each send one quote (no counters, no
 * rounds), the customer picks one. Deliberately not built on top of Offer/OffersService: a quote
 * is many-Rangers-to-one-customer before any match exists, the opposite shape of negotiation's
 * one-Ranger-after-match back-and-forth, so sharing the table would mean overloading `round`/
 * `fromRole` to mean something they don't.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly realtime: RealtimeService,
  ) {}

  private async parties(jobId: string): Promise<string[]> {
    const j = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { customerId: true, workerId: true },
    });
    return j ? [j.customerId, ...(j.workerId ? [j.workerId] : [])] : [];
  }

  /** Ranger: send a quote. One per Ranger per request (unique constraint backs this up). */
  async submit(workerId: string, jobId: string, input: QuoteInput) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: { select: { category: { select: { slug: true } } } } },
    });
    if (!job) throw notFound('Job not found');
    if (job.request.category.slug !== OTHER_CATEGORY_SLUG)
      throw conflict('This category has a fixed price; quotes are only for "Other".', {
        code: 'NOT_QUOTABLE',
      });
    if (job.status !== 'BROADCASTING')
      throw conflict('This request is no longer open for quotes.', { code: 'NOT_OPEN' });
    const invited = await this.prisma.requestBroadcast.findFirst({
      where: { jobId, workerId, attempt: job.broadcastAttempt },
    });
    if (!invited)
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.FORBIDDEN,
        'You were not invited to this request.',
      );
    const existing = await this.prisma.jobQuote.findUnique({
      where: { jobId_workerId: { jobId, workerId } },
    });
    if (existing)
      throw conflict('You already sent a quote for this request.', { code: 'ALREADY_QUOTED' });
    await this.prisma.jobQuote.create({
      data: { jobId, workerId, amountPaise: input.amountPaise },
    });
    this.realtime.emitToUser(job.customerId, SOCKET_EVENTS.jobUpdated, { jobId });
    return this.view.build(jobId, workerId);
  }

  /** Ranger: withdraw an unaccepted quote. Deleted, not soft-cancelled, so the unique
   * (jobId, workerId) constraint lets the same Ranger quote again afterward — a withdrawn draft
   * nobody acted on isn't the kind of history worth keeping a dead row around for. Returns a
   * plain ack rather than the job view: once the quote is gone, an unmatched Ranger has nothing
   * left that authorises them to read this job (D-080's loadForParty widening is quote-based). */
  async withdraw(workerId: string, jobId: string, quoteId: string): Promise<{ ok: true }> {
    const quote = await this.prisma.jobQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.jobId !== jobId) throw notFound('Quote not found');
    if (quote.workerId !== workerId) throw forbidden('Not your quote.');
    const res = await this.prisma.jobQuote.deleteMany({ where: { id: quoteId, status: 'PENDING' } });
    if (res.count !== 1)
      throw conflict('That quote has already been decided.', { code: 'QUOTE_CLOSED' });
    return { ok: true };
  }

  /** Customer: accept one quote. Performs the match at that quote's price, declines the rest. */
  async accept(customerId: string, jobId: string, quoteId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    const quote = await this.prisma.jobQuote.findUnique({ where: { id: quoteId } });
    if (!quote || quote.jobId !== jobId) throw notFound('Quote not found');
    if (job.status !== 'BROADCASTING' || job.workerId)
      throw conflict('This request has already been matched.', { code: 'REQUEST_TAKEN' });

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.jobQuote.updateMany({
        where: { id: quoteId, status: 'PENDING' },
        data: { status: 'ACCEPTED' },
      });
      if (claimed.count !== 1)
        throw conflict('That quote is no longer open.', { code: 'QUOTE_CLOSED' });
      await tx.jobQuote.updateMany({
        where: { jobId, status: 'PENDING', NOT: { id: quoteId } },
        data: { status: 'DECLINED' },
      });
      await this.transitions.move(tx, {
        jobId,
        from: 'BROADCASTING',
        to: 'MATCHED',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: { workerId: quote.workerId, matchedAt: new Date(), nextWaveAt: null },
      });
      await tx.jobMatch.create({ data: { jobId, workerId: quote.workerId } });
      await tx.chatThread.create({ data: { jobId } });
      await tx.requestBroadcast.updateMany({
        where: { jobId, workerId: quote.workerId },
        data: { response: 'ACCEPTED', respondedAt: new Date() },
      });
      await tx.requestBroadcast.updateMany({
        where: { jobId, response: 'PENDING', NOT: { workerId: quote.workerId } },
        data: { response: 'TAKEN', respondedAt: new Date() },
      });
      await this.transitions.move(tx, {
        jobId,
        from: 'MATCHED',
        to: 'AGREED',
        actor: 'SYSTEM',
        data: { agreedAt: new Date(), agreedPricePaise: quote.amountPaise },
      });
    });
    this.realtime.emitToUser(quote.workerId, SOCKET_EVENTS.matched, { jobId, requestId: job.requestId });
    const losers = await this.prisma.requestBroadcast.findMany({
      where: { jobId, response: 'TAKEN' },
      select: { workerId: true },
    });
    for (const l of losers)
      this.realtime.emitToUser(l.workerId, SOCKET_EVENTS.taken, { jobId, reason: 'TAKEN' });
    await this.transitions.notify(jobId);
    return this.view.build(jobId, customerId);
  }

  /** Customer: decline one quote without matching (they can still accept another later). */
  async decline(customerId: string, jobId: string, quoteId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    const res = await this.prisma.jobQuote.updateMany({
      where: { id: quoteId, jobId, status: 'PENDING' },
      data: { status: 'DECLINED' },
    });
    if (res.count !== 1)
      throw conflict('That quote is no longer open.', { code: 'QUOTE_CLOSED' });
    return this.view.build(jobId, customerId);
  }
}
