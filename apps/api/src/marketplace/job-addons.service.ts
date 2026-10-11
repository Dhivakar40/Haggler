import { Injectable } from '@nestjs/common';
import { SOCKET_EVENTS } from '@haggler/shared';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FeeService } from './fee.service';
import { JobViewService } from './job-view.service';

/**
 * D-080 (A5): mid-job add-ons for inspection-charge categories (A2). The Ranger proposes a
 * catalogue item once on site; the price only counts once the customer approves it in the app —
 * never silently added to the final bill. Name and price are snapshotted onto JobAddOn at
 * proposal time, so a later price-list edit can't retroactively change what was approved.
 */
@Injectable()
export class JobAddOnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly view: JobViewService,
    private readonly realtime: RealtimeService,
    private readonly fee: FeeService,
  ) {}

  /** Ranger: propose one catalogue add-on for a newly found problem. Only while the job is
   * actually under way, and only from the add-on catalogue of the job's own category (no
   * proposing an unrelated trade's item). D-087 (step 7): `unitPricePaise`, if given, must sit
   * within the same floor/ceiling a quote line uses — omitted, it defaults to the floor exactly
   * as this worked before D-087. Above-ceiling pricing (which a quote line can do with a photo
   * and a reason) is not supported here; a problem that big goes through a fresh quote instead. */
  async propose(workerId: string, jobId: string, addOnId: string, unitPricePaise?: number) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: { select: { categoryId: true, category: { select: { ceilingMultipleBps: true } } } } },
    });
    if (!job || job.workerId !== workerId) throw notFound('Job not found');
    if (job.status !== 'IN_PROGRESS')
      throw conflict('Add-ons can only be proposed while the job is in progress.', {
        code: 'WRONG_STATE',
      });
    const addOn = await this.prisma.priceListAddOn.findFirst({
      where: { id: addOnId, categoryId: job.request.categoryId, isActive: true },
    });
    if (!addOn) throw notFound('Add-on not found for this category');
    const price = unitPricePaise ?? addOn.pricePaise;
    if (price < addOn.pricePaise)
      throw unprocessable(`${addOn.name} cannot be quoted below its floor price.`, {
        code: 'BELOW_FLOOR',
        floorPaise: addOn.pricePaise,
      });
    const ceiling = await this.fee.ceilingPaise(
      addOn.pricePaise,
      addOn.ceilingMultipleBps,
      job.request.category.ceilingMultipleBps,
    );
    if (price > ceiling)
      throw unprocessable(`${addOn.name} is above the typical range for a mid-job add-on.`, {
        code: 'ABOVE_CEILING',
        ceilingPaise: ceiling,
      });
    await this.prisma.jobAddOn.create({
      data: { jobId, addOnId: addOn.id, name: addOn.name, pricePaise: price },
    });
    this.realtime.emitToUser(job.customerId, SOCKET_EVENTS.jobUpdated, { jobId });
    return this.view.build(jobId, workerId);
  }

  /** Customer: approve or decline one proposed add-on. */
  private async decide(customerId: string, jobId: string, jobAddOnId: string, approve: boolean) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) throw notFound('Job not found');
    const res = await this.prisma.jobAddOn.updateMany({
      where: { id: jobAddOnId, jobId, status: 'PROPOSED' },
      data: { status: approve ? 'APPROVED' : 'DECLINED', decidedAt: new Date() },
    });
    if (res.count !== 1)
      throw conflict('That add-on has already been decided.', { code: 'ADD_ON_CLOSED' });
    if (job.workerId)
      this.realtime.emitToUser(job.workerId, SOCKET_EVENTS.jobUpdated, { jobId });
    return this.view.build(jobId, customerId);
  }

  approve(customerId: string, jobId: string, jobAddOnId: string) {
    return this.decide(customerId, jobId, jobAddOnId, true);
  }

  decline(customerId: string, jobId: string, jobAddOnId: string) {
    return this.decide(customerId, jobId, jobAddOnId, false);
  }
}
