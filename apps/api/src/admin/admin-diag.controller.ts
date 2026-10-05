import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth';

/**
 * TEMPORARY — D-078 latency diagnosis only. Not part of the product. Measures Render-to-DB round
 * trip time from inside the running service (the only way to isolate it from PC-to-Render network
 * time). Removed once the diagnosis is complete — see docs/DECISIONS.md.
 */
@ApiExcludeController()
@Public()
@UseGuards(AdminAuthGuard)
@Controller({ path: 'admin/diag', version: '1' })
export class AdminDiagController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('db-rtt')
  @ApiBearerAuth()
  async dbRtt() {
    const maskedUrl = (process.env.DATABASE_URL ?? '').replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');

    const sessionSamples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      sessionSamples.push(Date.now() - t0);
    }

    let txPoolerSamples: number[] | { error: string } = { error: 'not attempted' };
    try {
      const { PrismaClient } = await import('@prisma/client');
      const txUrl = (process.env.DATABASE_URL ?? '').replace(':5432/', ':6543/') + '?pgbouncer=true';
      const txClient = new PrismaClient({ datasources: { db: { url: txUrl } } });
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        const t0 = Date.now();
        await txClient.$queryRaw`SELECT 1`;
        samples.push(Date.now() - t0);
      }
      await txClient.$disconnect();
      txPoolerSamples = samples;
    } catch (e) {
      txPoolerSamples = { error: e instanceof Error ? e.message : String(e) };
    }

    let tcpConnectMs: number | { error: string };
    try {
      const net = await import('node:net');
      const u = new URL((process.env.DATABASE_URL ?? '').replace('postgresql://', 'http://'));
      const t0 = Date.now();
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect(Number(u.port) || 5432, u.hostname, () => {
          sock.end();
          resolve();
        });
        sock.on('error', reject);
        sock.setTimeout(10000, () => reject(new Error('tcp connect timeout')));
      });
      tcpConnectMs = Date.now() - t0;
    } catch (e) {
      tcpConnectMs = { error: e instanceof Error ? e.message : String(e) };
    }

    const stats = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      return { min: sorted[0], median: pick(0.5), p90: pick(0.9), max: sorted[sorted.length - 1], samples: sorted };
    };

    return {
      maskedDatabaseUrl: maskedUrl,
      nodeRegionHint: process.env.RENDER_REGION ?? process.env.RENDER_SERVICE_NAME ?? 'unknown',
      sessionPooler5432: stats(sessionSamples),
      transactionPooler6543: Array.isArray(txPoolerSamples) ? stats(txPoolerSamples) : txPoolerSamples,
      tcpConnectMs,
    };
  }
}
