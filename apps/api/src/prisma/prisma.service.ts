import { Global, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma connects lazily on the first query, so booting the app (for example to generate
 * OpenAPI) does not need a running database. Readiness checks do a real query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      transactionOptions: {
        // Prisma's defaults (maxWait 2s, timeout 5s) assume a low-latency local database. Against
        // a hosted pooler across a real network, several sequential queries inside one interactive
        // transaction can comfortably exceed 5s even with nothing wrong, and Prisma then aborts
        // with P2028 ("Transaction not found") — surfacing as a random-looking 500 under load or
        // distance, not an actual bug in the transaction's logic. Generous on purpose.
        maxWait: 10_000,
        timeout: 20_000,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
