import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  MAINTENANCE_JOBS,
  type MaintenanceJob,
  MaintenanceService,
} from '../src/maintenance/maintenance.service';

/** Run one maintenance job by hand. In normal operation BullMQ runs them on a schedule. */
async function main(): Promise<void> {
  // A one-shot run must not also start the recurring scheduler or queue worker.
  process.env.QUEUES_ENABLED = 'false';
  process.env.SCHEDULER_ENABLED = 'false';
  const job = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (!(MAINTENANCE_JOBS as readonly string[]).includes(job ?? ''))
      throw new Error(`Usage: run-job <${MAINTENANCE_JOBS.join('|')}>`);
    console.log(`${job}: ${await app.get(MaintenanceService).run(job as MaintenanceJob)}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
