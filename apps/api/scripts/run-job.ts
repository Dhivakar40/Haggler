import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { KycService } from '../src/kyc/kyc.service';
import { AccountLifecycleService } from '../src/users/account-lifecycle.service';

/**
 * One-shot maintenance jobs. Schedule these daily (cron / platform scheduler) until BullMQ
 * arrives in Phase 2:
 *   purge-accounts   anonymise accounts past their 30-day deletion grace period
 *   purge-kyc-images delete identity images past the retention period
 */
async function main(): Promise<void> {
  const job = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (job === 'purge-accounts') {
      console.log(`purged accounts: ${await app.get(AccountLifecycleService).purgeDueDeletions()}`);
    } else if (job === 'purge-kyc-images') {
      console.log(`purged images: ${await app.get(KycService).purgeExpiredImages()}`);
    } else {
      throw new Error('Usage: run-job <purge-accounts|purge-kyc-images>');
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
