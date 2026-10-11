import { Injectable } from '@nestjs/common';
import { SOCKET_EVENTS } from '@haggler/shared';
import { conflict, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
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
  ) {}

  /** Ranger: propose one catalogue add-on. Only while the job is actually under way, and only
   * from the add-on catalogue of the job's own category (no proposing an unrelated trade's item). */
  async propose(workerId: string, jobId: string, addOnId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { request: { select: { categoryId: true } } },
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
    await this.prisma.jobAddOn.create({
      data: { jobId, addOnId: addOn.id, name: addOn.name, pricePaise: addOn.pricePaise },
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
