import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { EnvService } from '../config/env.service';
import { MAINTENANCE_JOBS, type MaintenanceJob, MaintenanceService } from './maintenance.service';

/** Cron patterns (server time, UTC on most hosts): quiet hours, staggered so they never overlap. */
const SCHEDULE: Record<MaintenanceJob, string> = {
  'purge-accounts': '30 2 * * *',
  'purge-kyc-images': '0 3 * * *',
  'trim-auth-data': '30 3 * * *',
  'trim-gps-trails': '0 4 * * *',
};
export const MAINTENANCE_QUEUE = 'maintenance';

/**
 * BullMQ for scheduled maintenance (D-030). Jobs retry 3 times with exponential backoff; jobs that
 * still fail stay in BullMQ's failed set (our dead-letter queue) for inspection instead of vanishing.
 * Matching timers deliberately do NOT use this (they poll Postgres so matching survives a Redis outage).
 * Multiple API instances are safe: BullMQ hands each scheduled run to exactly one worker.
 */
@Injectable()
export class QueuesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueuesService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly env: EnvService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private connection(): ConnectionOptions {
    const u = new URL(this.env.env.REDIS_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null, // required by BullMQ workers
      enableOfflineQueue: true,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.env.env.QUEUES_ENABLED) return;
    try {
      const connection = this.connection();
      this.queue = new Queue(MAINTENANCE_QUEUE, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      });
      this.queue.on('error', (e) => this.logger.warn(`queue error: ${e.message}`));
      for (const name of MAINTENANCE_JOBS) {
        await this.queue.upsertJobScheduler(
          `schedule:${name}`,
          { pattern: SCHEDULE[name] },
          { name, data: {} },
        );
      }
      this.worker = new Worker(
        MAINTENANCE_QUEUE,
        async (job) => {
          const count = await this.maintenance.run(job.name as MaintenanceJob);
          return { processed: count };
        },
        { connection, concurrency: 1 },
      );
      this.worker.on('failed', (job, err) =>
        this.logger.error(
          `maintenance job ${job?.name} failed (attempt ${job?.attemptsMade}): ${err.message}`,
        ),
      );
      this.worker.on('error', (e) => this.logger.warn(`worker error: ${e.message}`));
      this.logger.log('Maintenance queue ready (4 scheduled jobs)');
    } catch (err) {
      // Never stop the API from booting because Redis is unavailable.
      this.logger.warn(`Maintenance queue not started: ${String(err)}`);
    }
  }

  /** Enqueue a job now (admin tooling and tests). Returns null when queues are disabled. */
  async enqueue(name: MaintenanceJob) {
    return this.queue?.add(name, {}, { jobId: undefined });
  }

  async schedulers() {
    return this.queue ? this.queue.getJobSchedulers() : [];
  }

  async failedCount(): Promise<number> {
    return this.queue ? this.queue.getFailedCount() : 0;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
