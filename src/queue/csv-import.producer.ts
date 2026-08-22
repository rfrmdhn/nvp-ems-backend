import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CSV_IMPORT_QUEUE } from './queue.constants';

export interface CsvImportJobData {
  filePath: string;
  originalFilename: string;
}

/**
 * Producer for the csv-import queue. See EMS-BACKEND-PLAN.md §8 — the
 * upload endpoint enqueues here and returns the job id immediately (202);
 * the actual streaming-parse/batch-insert consumer is a next-phase TODO
 * (src/queue/processors/csv-import.processor.ts).
 */
@Injectable()
export class CsvImportProducer {
  constructor(
    @InjectQueue(CSV_IMPORT_QUEUE)
    private readonly queue: Queue<CsvImportJobData>,
  ) {}

  async enqueue(filePath: string, originalFilename: string): Promise<string> {
    const job = await this.queue.add('csv-import', {
      filePath,
      originalFilename,
    });
    return job.id as string;
  }

  /** Used by the (next-phase) GET /csv-import/:jobId/status endpoint. */
  getQueue(): Queue<CsvImportJobData> {
    return this.queue;
  }
}
