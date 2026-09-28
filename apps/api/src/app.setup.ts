import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

/**
 * Everything that must be identical in production, integration tests and the OpenAPI
 * generator lives here, so tests exercise the real pipeline and not a lookalike.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.use(helmet());
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
