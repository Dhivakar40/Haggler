import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/auth.guards';
import { SessionModule } from './auth/session.module';
import { CatalogModule } from './catalog/catalog.module';
import { CryptoModule } from './common/crypto.module';
import { EnvModule, EnvService } from './config/env.service';
import { HealthModule } from './health/health.module';
import { KycModule } from './kyc/kyc.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { ReputationModule } from './reputation/reputation.module';
import { HttpMetricsMiddleware, MetricsModule } from './metrics/metrics';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitModule } from './ratelimit/rate-limit.service';
import { RedisThrottlerStorage } from './ratelimit/redis-throttler.storage';
import { RedisModule, RedisService } from './redis/redis.service';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { WorkerModule } from './worker/worker.module';

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
  'req.body.aadhaarLast4',
  'req.body.dateOfBirth',
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
    // Global per-IP limit, stored in Redis so it holds across instances (D-022).
    ThrottlerModule.forRootAsync({
      inject: [EnvService, RedisService],
      useFactory: (envService: EnvService, redis: RedisService) => ({
        throttlers: [
          {
            ttl: envService.env.THROTTLE_TTL_SECONDS * 1000,
            limit: envService.env.THROTTLE_LIMIT,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    RateLimitModule,
    AuditModule,
    SessionModule,
    MetricsModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    UsersModule,
    WorkerModule,
    KycModule,
    WalletModule,
    ReputationModule,
    MarketplaceModule,
    MaintenanceModule,
    AdminModule,
  ],
  providers: [
    // Order matters: throttle first (cheap), then authenticate, then check roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
