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
        // distance, not an actual bug in the transaction's logic. Generous on purpose, and raised
        // again (20s -> 30s) once lifecycle.service.ts's confirm() grew a second league recompute
        // (D-077) — the queries themselves are also parallelized/merged where independent, but the
        // timeout still needs real headroom against this database's observed latency — and that
        // latency is not even stable: per-query times observed during development ranged from
        // ~300ms to 10s+ for the exact same simple query at different moments (free-tier Supabase
        // pooler under varying load, not something this app controls). 30s still was not enough
        // headroom in practice; raised again to 60s.
        maxWait: 15_000,
        timeout: 60_000,
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
