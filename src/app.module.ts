import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
    // Registered globally but NOT applied via an APP_GUARD — only
    // AuthController's login route opts in via @UseGuards(ThrottlerGuard),
    // so it doesn't rate-limit the Employees/CSV-import traffic the
    // load/stress tests exercise (see API_Test_Report.md finding E). The
    // limit (25/min per IP) is chosen loosely enough that this project's own
    // test/api/ + Postman suites (~16 login calls/run between them) never
    // trip it, while still cutting an unthrottled brute-force attempt down
    // from unlimited attempts/sec to 25/min.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 25 }],
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
