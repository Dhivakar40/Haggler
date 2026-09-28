import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { CatalogModule } from './catalog/catalog.module';
import { EnvModule, EnvService } from './config/env.service';
import { HealthModule } from './health/health.module';
import { HttpMetricsMiddleware, MetricsModule } from './metrics/metrics';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.service';

/** Fields that must never reach a log line (D: never log secrets or Aadhaar numbers). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-idempotency-key"]',
  'req.body.otp',
  'req.body.code',
  'req.body.password',
  'req.body.aadhaar',
  'req.body.aadhaarNumber',
  'req.body.refreshToken',
  'res.headers["set-cookie"]',
];

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (envService: EnvService) => {
        const { LOG_LEVEL, NODE_ENV } = envService.env;
        return {
          pinoHttp: {
            level: NODE_ENV === 'test' ? 'silent' : LOG_LEVEL,
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
            transport:
              NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
    // Global default: 100 requests / minute / IP. Auth endpoints get stricter limits in Phase 1.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    CatalogModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
