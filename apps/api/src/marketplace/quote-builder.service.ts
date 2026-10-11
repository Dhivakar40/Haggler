import { Injectable } from '@nestjs/common';
import type { SubmitLineItemQuoteInput } from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { FeeService } from './fee.service';
import { travelledMeters } from './geo';
import { JobTransitions } from './job-transitions.service';
import { JobViewService } from './job-view.service';

/**
 * D-087 (Sub-phase G): the line-itemised quote a Ranger builds after arriving and diagnosing
 * (any category — distinct from QuotesService's pre-match, "other"-only, single-number quote).
 * Labour items come from the admin price list (`PriceListAddOn`, whose `pricePaise` is now that
 * item's FLOOR — a Ranger can never quote below it); parts are pass-through at actual cost with
 * a required bill photo; a single small "extra" line is capped as a percent of labour.
 */
@Injectable()
export class QuoteBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: JobTransitions,
    private readonly view: JobViewService,
    private readonly fee: FeeService,
  ) {}

  private async arrivedJob(workerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        request: {
          select: { categoryId: true, category: { select: { feeBps: true, ceilingMultipleBps: true } } },
        },
      },
    });
    if (!job || job.workerId !== workerId) throw notFound('Job not found');
    if (job.status !== 'ARRIVED')
      throw conflict('Verify the start code before sending a quote.', { code: 'NOT_ARRIVED' });
    if (!job.arrivalVerifiedAt)
      throw conflict("Enter the customer's start code first.", { code: 'ARRIVAL_NOT_VERIFIED' });
    return job;
  }

  /** Ranger: build (or revise, while still PENDING) the line-itemised quote. Moves ARRIVED ->
   * QUOTING. Every number here is computed server-side from the submitted items — the total
   * the customer sees is never something either party typed in directly. */
  async submit(workerId: string, jobId: string, input: SubmitLineItemQuoteInput) {
    const job = await this.arrivedJob(workerId, jobId);
    const cfg = await this.fee.get();

    const catalogIds = input.items
      .filter((i) => i.kind === 'LABOUR' && i.catalogItemId)
      .map((i) => i.catalogItemId as string);
    const catalog = catalogIds.length
      ? await this.prisma.priceListAddOn.findMany({ where: { id: { in: catalogIds } } })
      : [];
    const catalogById = new Map(catalog.map((c) => [c.id, c]));

    let servicePaise = 0;
    let partsPaise = 0;
    let extraPaise = 0;
    let extraCount = 0;
    let aboveCeiling: boolean = false;
    const itemRows: {
      kind: 'LABOUR' | 'PART' | 'EXTRA';
      catalogItemId: string | null;
      name: string;
      unitPricePaise: number;
      quantity: number;
      totalPaise: number;
      billPhotoId: string | null;
    }[] = [];

    for (const item of input.items) {
      const lineTotal = item.unitPricePaise * item.quantity;
      if (item.kind === 'LABOUR') {
        if (!item.catalogItemId)
          throw unprocessable('A labour item must come from the price list.', {
            code: 'CATALOG_ITEM_REQUIRED',
          });
        const cat = catalogById.get(item.catalogItemId);
        if (!cat || !cat.isActive || cat.categoryId !== job.request.categoryId)
          throw unprocessable('That price-list item is not available for this category.', {
            code: 'CATALOG_ITEM_INVALID',
          });
        if (item.unitPricePaise < cat.pricePaise)
          throw unprocessable(`${cat.name} cannot be quoted below its floor price.`, {
            code: 'BELOW_FLOOR',
            floorPaise: cat.pricePaise,
          });
        const ceiling = await this.fee.ceilingPaise(
          cat.pricePaise,
          cat.ceilingMultipleBps,
          job.request.category.ceilingMultipleBps,
        );
        if (item.unitPricePaise > ceiling) aboveCeiling = true;
        servicePaise += lineTotal;
      } else if (item.kind === 'PART') {
        if (!item.billPhotoId)
          throw unprocessable('A part needs a photo of its purchase bill.', {
            code: 'BILL_PHOTO_REQUIRED',
          });
        partsPaise += lineTotal;
      } else {
        extraCount += 1;
        if (extraCount > 1)
          throw unprocessable('Only one "extra" line is allowed — use a catalogue add-on instead.', {
            code: 'EXTRA_LIMIT',
          });
        extraPaise += lineTotal;
      }
      itemRows.push({
        kind: item.kind,
        catalogItemId: item.kind === 'LABOUR' ? (item.catalogItemId as string) : null,
        name: item.name,
        unitPricePaise: item.unitPricePaise,
        quantity: item.quantity,
        totalPaise: lineTotal,
        billPhotoId: item.kind === 'PART' ? (item.billPhotoId as string) : null,
      });
    }

    const extraCapPaise = Math.round((servicePaise * cfg.quote_extra_cap_bps) / 10_000);
    if (extraPaise > extraCapPaise)
      throw unprocessable('The "extra" line is too large — use a catalogue add-on instead.', {
        code: 'EXTRA_CAP_EXCEEDED',
        capPaise: extraCapPaise,
      });

    if (aboveCeiling && (!input.aboveCeilingPhotoId || !input.aboveCeilingReason))
      throw unprocessable(
        'A labour item above the typical range needs a photo and a written reason.',
        { code: 'ABOVE_CEILING_EVIDENCE_REQUIRED' },
      );

    const feePaise = await this.fee.computeFeePaise(servicePaise, job.request.category.feeBps);
    const totalPaise = servicePaise + partsPaise + extraPaise + feePaise;

    await this.prisma.$transaction(async (tx) => {
      const quote = await tx.jobQuote.upsert({
        where: { jobId_workerId: { jobId, workerId } },
        update: {
          amountPaise: totalPaise,
          status: 'PENDING',
          servicePaise,
          partsPaise,
          extraPaise,
          extraDescription: input.extraDescription ?? null,
          feePaise,
          totalPaise,
          aboveCeiling: Boolean(aboveCeiling),
          aboveCeilingPhotoId: aboveCeiling ? input.aboveCeilingPhotoId : null,
          aboveCeilingReason: aboveCeiling ? input.aboveCeilingReason : null,
          flaggedForReview: aboveCeiling,
        },
        create: {
          jobId,
          workerId,
          amountPaise: totalPaise,
          servicePaise,
          partsPaise,
          extraPaise,
          extraDescription: input.extraDescription ?? null,
          feePaise,
          totalPaise,
          aboveCeiling,
          aboveCeilingPhotoId: aboveCeiling ? input.aboveCeilingPhotoId : null,
          aboveCeilingReason: aboveCeiling ? input.aboveCeilingReason : null,
          flaggedForReview: aboveCeiling,
        },
      });
      await tx.jobQuoteItem.deleteMany({ where: { quoteId: quote.id } });
      await tx.jobQuoteItem.createMany({
        data: itemRows.map((r) => ({ ...r, quoteId: quote.id })),
      });
      if (job.status === 'ARRIVED') {
        await this.transitions.move(tx, {
          jobId,
          from: 'ARRIVED',
          to: 'QUOTING',
          actor: 'WORKER',
          actorUserId: workerId,
        });
      }
    });
    return this.view.build(jobId, workerId);
  }

  /** Customer: accept the quote sent for this job. */
  async accept(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    if (job.status !== 'QUOTING')
      throw conflict('There is no quote waiting on a decision.', { code: 'NOT_QUOTING' });
    const quote = await this.prisma.jobQuote.findFirst({
      where: { jobId, workerId: job.workerId ?? undefined, status: 'PENDING' },
    });
    if (!quote) throw notFound('Quote not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.jobQuote.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } });
      await this.transitions.move(tx, {
        jobId,
        from: 'QUOTING',
        to: 'AGREED',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: {
          acceptedQuoteId: quote.id,
          agreedAt: new Date(),
          // Everything except the fee — keeps the existing "total = agreedPricePaise +
          // platformFeePaise" arithmetic correct for the new flow's parts/extra too.
          agreedPricePaise: (quote.servicePaise ?? 0) + quote.partsPaise + quote.extraPaise,
          platformFeePaise: quote.feePaise,
        },
      });
    });
    return this.view.build(jobId, customerId);
  }

  /** Customer: reject the quote. Charging the visit fee this triggers is wired in Sub-phase H
   * (payment revision) — this records the rejection and freezes the amount owed; it does not
   * yet collect it. */
  async reject(customerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    if (job.status !== 'QUOTING')
      throw conflict('There is no quote waiting on a decision.', { code: 'NOT_QUOTING' });
    const quote = await this.prisma.jobQuote.findFirst({
      where: { jobId, workerId: job.workerId ?? undefined, status: 'PENDING' },
    });
    if (!quote) throw notFound('Quote not found');

    const distanceM = await travelledMeters(this.prisma, jobId);
    const visitFeePaise = await this.fee.visitFeePaise(distanceM);

    await this.prisma.$transaction(async (tx) => {
      await tx.jobQuote.update({ where: { id: quote.id }, data: { status: 'DECLINED' } });
      await this.transitions.move(tx, {
        jobId,
        from: 'QUOTING',
        to: 'QUOTE_REJECTED',
        actor: 'CUSTOMER',
        actorUserId: customerId,
        data: { visitFeePaise, visitFeeChargedAt: new Date(), closeReason: 'QUOTE_REJECTED' },
      });
    });
    return this.view.build(jobId, customerId);
  }
}
