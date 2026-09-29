import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, mountSwagger } from './app.setup';
import { adapterModes } from './config/env';
import { EnvService } from './config/env.service';

async function bootstrap(): Promise<void> {
  // rawBody: true keeps the exact request bytes on req.rawBody, needed to verify the Razorpay
  // webhook signature (HMAC over the raw payload, not a re-serialised copy of the parsed JSON).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);
  mountSwagger(app);

  const { env } = app.get(EnvService);
  await app.listen(env.PORT, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`Haggler API listening on :${env.PORT} (${env.NODE_ENV})`);
  // Say plainly which adapters are fake and which are real.
  logger.log({ adapters: adapterModes(env) }, 'Adapter modes');
}

bootstrap().catch((err) => {
  // Logger may not be up if config is invalid, so write to stderr directly.
  process.stderr.write(
    `Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
