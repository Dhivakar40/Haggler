import 'reflect-metadata';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export interface Harness {
  app: INestApplication;
  databaseUrl: string;
  redis: StartedTestContainer;
  postgres: StartedTestContainer;
  minio: StartedTestContainer;
  s3Url: string;
  /** Builds another Nest app on the same containers with env overrides (e.g. a low rate limit). */
  createApp(overrides?: Record<string, string>): Promise<INestApplication>;
  stop(): Promise<void>;
}

const API_DIR = resolve(__dirname, '..');
const MINIO_USER = 'minio-test';
const MINIO_PASSWORD = 'minio-test-secret';
export const KYC_BUCKET = 'haggler-kyc';

export function runSeed(databaseUrl: string): void {
  execSync('npx ts-node --transpile-only prisma/seed.ts', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

async function waitForBuckets(s3: S3Client, buckets: string[]): Promise<void> {
  for (const bucket of buckets) {
    for (let i = 0; i < 40; i++) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        break;
      } catch {
        if (i === 20)
          await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}

/**
 * Starts real Postgres+PostGIS, Redis and MinIO (S3) in Docker, applies the real migrations, seeds,
 * and boots the real Nest app through the same `configureApp` used in production.
 */
export async function startHarness(): Promise<Harness> {
  const [postgres, redis, minio] = await Promise.all([
    new GenericContainer('postgis/postgis:16-3.4')
      .withEnvironment({ POSTGRES_USER: 't', POSTGRES_PASSWORD: 't', POSTGRES_DB: 't' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    new GenericContainer('bitnamilegacy/minio:2025.7.23')
      .withEnvironment({
        MINIO_ROOT_USER: MINIO_USER,
        MINIO_ROOT_PASSWORD: MINIO_PASSWORD,
        MINIO_DEFAULT_BUCKETS: `${KYC_BUCKET},haggler-media`,
      })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
  ]);

  const databaseUrl = `postgresql://t:t@${postgres.getHost()}:${postgres.getMappedPort(5432)}/t?schema=public`;
  const s3Url = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  execSync('npx prisma migrate deploy', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  runSeed(databaseUrl);

  await waitForBuckets(
    new S3Client({
      region: 'ap-south-1',
      endpoint: s3Url,
      forcePathStyle: true,
      credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    }),
    [KYC_BUCKET, 'haggler-media'],
  );

  const baseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: `${databaseUrl}&connection_limit=40&pool_timeout=60`, // room for the load test
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    JWT_ACCESS_SECRET: 'integration-test-secret-integration-test-secret',
    ADMIN_JWT_SECRET: 'integration-admin-secret-integration-admin-secret',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    S3_ENDPOINT: s3Url,
    S3_PUBLIC_ENDPOINT: s3Url,
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY: MINIO_USER,
    S3_SECRET_KEY: MINIO_PASSWORD,
    THROTTLE_LIMIT: '100000', // dedicated tests use a low-limit app instead
    QUEUES_ENABLED: 'false', // the queue test turns it on explicitly
    SCHEDULER_ENABLED: 'false', // tests drive the scheduler by hand for deterministic time
    TRUST_PROXY_HOPS: '1', // tests send X-Forwarded-For so each "client" has its own IP
  };

  // Imported after env is set: EnvService parses process.env when the module is built.
  const createApp = async (overrides: Record<string, string> = {}): Promise<INestApplication> => {
    Object.assign(process.env, baseEnv, overrides);
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    Object.assign(process.env, baseEnv); // restore defaults for the next createApp
    return app;
  };

  const app = await createApp();
  return {
    app,
    databaseUrl,
    redis,
    postgres,
    minio,
    s3Url,
    createApp,
    async stop() {
      await app.close();
      await Promise.allSettled([redis.stop(), postgres.stop(), minio.stop()]);
    },
  };
}
