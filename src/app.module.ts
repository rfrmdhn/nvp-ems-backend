import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './config/env.validation';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CsvImportModule } from './csv-import/csv-import.module';

/**
 * Shared root module for BOTH entry points:
 *  - src/main.ts   -> NestFactory.create(AppModule)               (HTTP API)
 *  - src/worker.ts -> NestFactory.createApplicationContext(AppModule) (no HTTP)
 *
 * Both processes therefore instantiate the same providers, including the
 * BullMQ processors registered in QueueModule — see EMS-BACKEND-PLAN.md §6
 * and §10 for why this is intentional for this technical test (BullMQ
 * dedupes job consumption across any number of workers on the same queue,
 * so this is harmless, just not the leanest possible split).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    EmployeesModule,
    QueueModule,
    NotificationsModule,
    CsvImportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
