import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { adapterModes } from '../config/env';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Liveness vs readiness:
 *  - live  = "the process is up". Orchestrators restart the container if this fails.
 *  - ready = "I can serve traffic". Load balancers stop routing to us if this fails.
 * Postgres is required. Redis is an accelerator: if it is down we report `degraded`
 * but stay ready, because matching falls back to the database path.
 */
@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe; also reports which adapters are sandbox vs live' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.redis.ping()]);
    const status = !dbOk ? 'unavailable' : redisOk ? 'ok' : 'degraded';
    if (!dbOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status,
      checks: { postgres: dbOk ? 'up' : 'down', redis: redisOk ? 'up' : 'down' },
      adapters: adapterModes(this.envService.env),
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
