import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/app.setup';

/**
 * Builds the OpenAPI spec from the real controllers and writes docs/openapi.json plus a
 * human-readable docs/API.md. Prisma and Redis connect lazily, so no infra is required.
 */
async function main(): Promise<void> {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_ACCESS_SECRET ??= 'openapi-generation-only-not-a-secret-000';

  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  const doc = buildOpenApiDocument(app);
  await app.close();

  const docsDir = resolve(__dirname, '../../../docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(resolve(docsDir, 'openapi.json'), JSON.stringify(doc, null, 2) + '\n');

  const lines = [
    '# Haggler API',
    '',
    '> Generated from the code by `pnpm openapi`. Do not edit by hand; CI fails if it drifts.',
    '> Machine-readable spec: [openapi.json](./openapi.json). Live UI at `/docs` when the API runs.',
    '',
    '| Method | Path | Summary |',
    '| --- | --- | --- |',
  ];
  for (const [path, item] of Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [method, op] of Object.entries(item as Record<string, { summary?: string }>)) {
      lines.push(`| ${method.toUpperCase()} | \`${path}\` | ${op.summary ?? ''} |`);
    }
  }
  lines.push('');
  writeFileSync(resolve(docsDir, 'API.md'), lines.join('\n'));
  process.stdout.write(`OpenAPI written: ${Object.keys(doc.paths).length} paths\n`);
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
});
