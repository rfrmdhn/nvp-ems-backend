import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [CsvImportController],
  providers: [CsvImportService],
})
export class CsvImportModule {}
