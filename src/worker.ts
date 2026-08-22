import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * Worker process entry point — no HTTP listener. Starts the same Nest DI
 * container as main.ts (see AppModule's doc comment) so the BullMQ
 * processors registered in QueueModule come alive and start consuming jobs.
 * This is what `dist/worker.js` runs in the `worker` docker-compose service.
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  await NestFactory.createApplicationContext(AppModule);
  logger.log('Worker process started, BullMQ processors are listening');
}

void bootstrap();
