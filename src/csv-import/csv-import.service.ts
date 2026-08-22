import { Injectable } from '@nestjs/common';
import { CsvImportProducer } from '../queue/csv-import.producer';
import type {
  CsvImportProgress,
  CsvImportResult,
} from '../queue/processors/csv-import.processor';

export interface CsvImportStatus {
  jobId: string;
  state: string;
  processed?: number;
  total?: number;
  percent?: number;
  rowsProcessed?: number;
  imported?: number;
  skipped?: number;
  errors?: string[];
}

function isCsvImportProgress(value: unknown): value is CsvImportProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    'processed' in value &&
    'total' in value &&
    'percent' in value
  );
}

/**
 * Enqueues an already-disk-persisted CSV file for background processing
 * (§8), and exposes the BullMQ job's state/progress as the fallback for a
 * client that missed the `csv-import.progress`/`csv-import.completed` SSE
 * events (e.g. the page was refreshed mid-import) — see
 * docs/superpowers/plans/csv-import.md.
 */
@Injectable()
export class CsvImportService {
  constructor(private readonly csvImportProducer: CsvImportProducer) {}

  async enqueueImport(
    filePath: string,
    originalFilename: string,
  ): Promise<{ jobId: string }> {
    const jobId = await this.csvImportProducer.enqueue(
      filePath,
      originalFilename,
    );
    return { jobId };
  }

  async getStatus(jobId: string): Promise<CsvImportStatus | null> {
    const job = await this.csvImportProducer.getQueue().getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const status: CsvImportStatus = { jobId, state };

    if (isCsvImportProgress(job.progress)) {
      status.processed = job.progress.processed;
      status.total = job.progress.total;
      status.percent = job.progress.percent;
      status.rowsProcessed = job.progress.rowsProcessed;
    }

    if (state === 'completed') {
      const result = job.returnvalue as CsvImportResult | undefined;
      if (result) {
        status.imported = result.imported;
        status.skipped = result.skipped;
        status.errors = result.errors;
      }
      status.percent = 100;
    }

    if (state === 'failed') {
      status.errors = [job.failedReason || 'Import job failed'];
    }

    return status;
  }
}
