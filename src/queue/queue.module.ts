import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { EMPLOYEE_CREATED_QUEUE, CSV_IMPORT_QUEUE } from './queue.constants';
import { EmployeeCreatedProducer } from './employee-created.producer';
import { CsvImportProducer } from './csv-import.producer';
import { EmployeeCreatedProcessor } from './processors/employee-created.processor';
import { CsvImportProcessor } from './processors/csv-import.processor';

/**
 * Registers Redis-backed BullMQ queues per EMS-BACKEND-PLAN.md §6. Both the
 * `api` process (producers only) and the `worker` process (producers +
 * processors, see src/worker.ts) import this module.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: EMPLOYEE_CREATED_QUEUE },
      { name: CSV_IMPORT_QUEUE },
    ),
    NotificationsModule,
  ],
  providers: [
    EmployeeCreatedProducer,
    CsvImportProducer,
    EmployeeCreatedProcessor,
    CsvImportProcessor,
  ],
  exports: [EmployeeCreatedProducer, CsvImportProducer],
})
export class QueueModule {}
