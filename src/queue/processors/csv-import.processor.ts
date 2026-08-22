import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createReadStream, statSync } from 'fs';
import { unlink } from 'fs/promises';
import { parse } from 'csv-parse';
import { CSV_IMPORT_QUEUE } from '../queue.constants';
import { CsvImportJobData } from '../csv-import.producer';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface CsvImportProgress {
  /** Bytes read from the source file so far (byte-based progress — see
   * docs/superpowers/plans/csv-import.md's "Progress reporting" section for
   * why this was chosen over a row-count pre-pass). */
  processed: number;
  /** Total file size in bytes, known upfront via fs.statSync — this is what
   * makes a byte-based percentage possible without a pre-pass over the file. */
  total: number;
  /** 0-99 while streaming, 100 once the job has fully resolved. */
  percent: number;
  /** Row-count convenience field (valid + invalid rows seen so far) — not
   * used for the percentage (that's byte-based) but useful for a "X rows
   * processed" label in the UI. */
  rowsProcessed: number;
}

interface ValidEmployeeRow {
  name: string;
  age: number;
  position: string;
  salary: number;
}

type RowValidationResult =
  { ok: true; value: ValidEmployeeRow } | { ok: false; reason: string };

const BATCH_SIZE = 500;
// Cap the collected error list so a file that's mostly garbage doesn't blow
// up the job's return value / the SSE payload — `skipped` still counts every
// bad row accurately, only the human-readable detail list is capped.
const MAX_COLLECTED_ERRORS = 20;

/**
 * Streams a CSV file from disk, validates each row, and batch-inserts valid
 * rows via prisma.employee.createMany. Never buffers the whole file into
 * memory: fs.createReadStream + csv-parse's streaming transform yields rows
 * one at a time, and only one batch (<= BATCH_SIZE rows) is held in memory
 * at any point. See EMS-BACKEND-PLAN.md §8 and
 * docs/superpowers/plans/csv-import.md.
 *
 * Invalid rows are skipped and counted, never fatal to the whole job (see
 * docs/superpowers/AUDIT.md #3) — a 20,000-row file with a handful of bad
 * rows should still import everything else.
 */
@Processor(CSV_IMPORT_QUEUE)
export class CsvImportProcessor extends WorkerHost {
  private readonly logger = new Logger(CsvImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<CsvImportJobData>): Promise<CsvImportResult> {
    const { filePath, originalFilename } = job.data;
    const jobId = String(job.id);

    let totalBytes = 0;
    try {
      totalBytes = statSync(filePath).size;
    } catch (err) {
      const message = `Uploaded file is missing or unreadable: ${
        err instanceof Error ? err.message : String(err)
      }`;
      this.logger.error(`csv-import job ${jobId}: ${message}`);
      await this.notificationsService.notifyCsvImportFailed(jobId, message);
      throw new Error(message);
    }

    this.logger.log(
      `csv-import job ${jobId}: starting stream-parse of "${originalFilename}" (${totalBytes} bytes)`,
    );

    let batch: ValidEmployeeRow[] = [];
    let imported = 0;
    let skipped = 0;
    let rowNumber = 0;
    const errors: string[] = [];

    const readStream = createReadStream(filePath);
    const parser = readStream.pipe(
      parse({
        columns: true,
        trim: true,
        skip_empty_lines: true,
        // A row with the wrong column count (a stray comma, a truncated
        // export) is exactly the kind of malformed-but-recoverable input
        // skip-and-collect exists for (see AUDIT.md #3) — without this,
        // csv-parse throws mid-stream and this.validateRow() never even
        // sees the row, turning one bad row into a whole-job failure.
        // With it, a short row's missing fields surface as `undefined`,
        // which validateRow() already rejects with a specific reason.
        relax_column_count: true,
      }),
    );

    const reportProgress = async (percent: number): Promise<void> => {
      const progress: CsvImportProgress = {
        processed: readStream.bytesRead,
        total: totalBytes,
        percent,
        rowsProcessed: rowNumber,
      };
      await job.updateProgress(progress);
      await this.notificationsService.notifyCsvImportProgress(jobId, progress);
    };

    const currentPercent = (): number =>
      totalBytes > 0
        ? Math.min(99, Math.floor((readStream.bytesRead / totalBytes) * 100))
        : 0;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const toInsert = batch;
      batch = [];
      const result = await this.prisma.employee.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      imported += result.count;
      // Reported once per batch (not per row) so a 20k-row file doesn't
      // flood the SSE stream / BullMQ's progress store.
      await reportProgress(currentPercent());
    };

    try {
      for await (const rawRow of parser) {
        rowNumber += 1;
        const validation = this.validateRow(rawRow as Record<string, unknown>);
        if (!validation.ok) {
          skipped += 1;
          if (errors.length < MAX_COLLECTED_ERRORS) {
            errors.push(`Row ${rowNumber}: ${validation.reason}`);
          }
          continue;
        }
        batch.push(validation.value);
        if (batch.length >= BATCH_SIZE) {
          await flush();
        }
      }
      await flush();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `csv-import job ${jobId} failed while streaming/parsing: ${message}`,
      );
      await unlink(filePath).catch(() => undefined);
      await this.notificationsService.notifyCsvImportFailed(jobId, message);
      throw err;
    }

    await unlink(filePath).catch(() => undefined);

    await job.updateProgress({
      processed: totalBytes,
      total: totalBytes,
      percent: 100,
      rowsProcessed: rowNumber,
    } satisfies CsvImportProgress);

    const summary: CsvImportResult = { imported, skipped, errors };

    this.logger.log(
      `csv-import job ${jobId} completed: imported=${imported} skipped=${skipped} errors=${errors.length}`,
    );

    await this.notificationsService.notifyCsvImportCompleted(jobId, summary);

    return summary;
  }

  /**
   * Row validation rules per the CSV-import brief: name non-empty string,
   * age a positive integer, position non-empty string, salary a
   * non-negative number. Deliberately looser than CreateEmployeeDto's
   * 16-100 age band / stricter API-level bounds — a bulk import of external
   * data shouldn't hard-reject every row just because someone's age is 15 or
   * 101; the API-level DTO bounds still apply to single-employee creation.
   */
  private validateRow(row: Record<string, unknown>): RowValidationResult {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) {
      return { ok: false, reason: 'name is required' };
    }

    const ageRaw = row.age;
    const age = this.toNumber(ageRaw);
    if (!Number.isInteger(age) || age <= 0) {
      return {
        ok: false,
        reason: `age must be a positive integer (got ${this.describeRawValue(ageRaw)})`,
      };
    }

    const position =
      typeof row.position === 'string' ? row.position.trim() : '';
    if (!position) {
      return { ok: false, reason: 'position is required' };
    }

    const salaryRaw = row.salary;
    const salary = this.toNumber(salaryRaw);
    if (!Number.isFinite(salary) || salary < 0) {
      return {
        ok: false,
        reason: `salary must be a non-negative number (got ${this.describeRawValue(salaryRaw)})`,
      };
    }

    return { ok: true, value: { name, age, position, salary } };
  }

  /** Coerces a raw CSV cell (always a string, or a number if pre-parsed) to a number, NaN on anything else. */
  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value.trim());
    return NaN;
  }

  /** Safe, lint-clean stringification of a raw CSV cell for error messages. */
  private describeRawValue(value: unknown): string {
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value === null || value === undefined) return String(value);
    return JSON.stringify(value);
  }
}
