import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  const corsOrigin = process.env.API_CORS_ORIGIN ?? 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });

  // Validation is done via zod schemas in controllers to keep dependencies light.
  app.setGlobalPrefix('api');

  // Wire SIGTERM/SIGINT to Nest's lifecycle so providers that hold connections
  // (QueueService → BullMQ worker + ioredis) can drain in-flight jobs before
  // the process exits. Without this, SIGTERM on the host kills the process
  // mid-dispatch and BullMQ marks those jobs stalled. Tech-debt D15.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  Logger.log(`NF Community AI OS API listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
