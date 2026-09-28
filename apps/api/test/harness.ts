import 'reflect-metadata';
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
  stop(): Promise<void>;
}

const API_DIR = resolve(__dirname, '..');

export function runSeed(databaseUrl: string): void {
  execSync('npx ts-node --transpile-only prisma/seed.ts', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

/**
 * Starts real Postgres+PostGIS and Redis in Docker, applies the real migrations, seeds,
 * and boots the real Nest app through the same `configureApp` used in production.
 */
export async function startHarness(): Promise<Harness> {
  const postgres = await new GenericContainer('postgis/postgis:16-3.4')
    .withEnvironment({ POSTGRES_USER: 't', POSTGRES_PASSWORD: 't', POSTGRES_DB: 't' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const databaseUrl = `postgresql://t:t@${postgres.getHost()}:${postgres.getMappedPort(5432)}/t?schema=public`;
  execSync('npx prisma migrate deploy', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  runSeed(databaseUrl);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    JWT_ACCESS_SECRET: 'integration-test-secret-integration-test-secret',
  });

  // Imported after env is set: EnvService parses process.env when the module is built.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/app.setup');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    databaseUrl,
    redis,
    postgres,
    async stop() {
      await app.close();
      await Promise.allSettled([redis.stop(), postgres.stop()]);
    },
  };
}
