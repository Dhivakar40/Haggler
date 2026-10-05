import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { diagMark, diagReset, diagShouldTrace, TRIGGER_HEADER } from './common/diag-timing'; // TEMPORARY — D-078
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

/**
 * Everything that must be identical in production, integration tests and the OpenAPI
 * generator lives here, so tests exercise the real pipeline and not a lookalike.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  // Behind a load balancer, req.ip is the balancer unless we trust its X-Forwarded-For hop(s).
  // Wrong value = attackers spoof their IP past the limits. See docs/RUNBOOK.md.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (hops > 0)
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: number) => void }).set(
      'trust proxy',
      hops,
    );
  app.use(helmet());
  // TEMPORARY — D-078: stamps the very start of request handling, before routing/guards, so the
  // full account of confirm()'s time has no gap between "request arrived" and "JwtAuthGuard ran".
  app.use((req: { headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
    if (diagShouldTrace(req.headers[TRIGGER_HEADER] as string | undefined)) {
      diagReset();
      diagMark('middleware:request received');
    }
    next();
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields
      forbidNonWhitelisted: true, // ...and reject them, so typos are loud
      transform: true,
    }),
  );
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Haggler API')
    .setDescription(
      'REST API for Haggler. Money is integer paise. Errors use the envelope ' +
        '{ error: { code, message, details?, requestId } }. Workers are called "Rangers" in the app.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function mountSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
