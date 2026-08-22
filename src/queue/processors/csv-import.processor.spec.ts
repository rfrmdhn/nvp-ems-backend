import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CsvImportProcessor, CsvImportProgress } from './csv-import.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CsvImportJobData } from '../csv-import.producer';

interface EmployeeInsert {
  name: string;
  age: number;
  position: string;
  salary: number;
}

type CreateManyArgs = { data: EmployeeInsert[]; skipDuplicates: boolean };
type CreateManyMock = jest.Mock<Promise<{ count: number }>, [CreateManyArgs]>;
type UpdateProgressMock = jest.Mock<Promise<void>, [CsvImportProgress]>;

describe('CsvImportProcessor', () => {
  let processor: CsvImportProcessor;
  let prisma: { employee: { createMany: CreateManyMock } };
  let notificationsService: {
    notifyCsvImportProgress: jest.Mock;
    notifyCsvImportCompleted: jest.Mock;
    notifyCsvImportFailed: jest.Mock;
  };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'csv-import-test-'));

    prisma = {
      employee: {
        createMany: jest.fn((args: CreateManyArgs) =>
          Promise.resolve({ count: args.data.length }),
        ) as CreateManyMock,
      },
    };
    notificationsService = {
      notifyCsvImportProgress: jest.fn().mockResolvedValue(undefined),
      notifyCsvImportCompleted: jest.fn().mockResolvedValue(undefined),
      notifyCsvImportFailed: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvImportProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    processor = module.get<CsvImportProcessor>(CsvImportProcessor);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeCsv(fileName: string, lines: string[]): string {
    const filePath = join(tmpDir, fileName);
    writeFileSync(filePath, ['name,age,position,salary', ...lines].join('\n'));
    return filePath;
  }

  function makeJob(
    filePath: string,
    id = 'job-1',
  ): Job<CsvImportJobData> & { updateProgress: UpdateProgressMock } {
    return {
      id,
      data: { filePath, originalFilename: 'test.csv' },
      updateProgress: jest
        .fn()
        .mockResolvedValue(undefined) as UpdateProgressMock,
    } as unknown as Job<CsvImportJobData> & {
      updateProgress: UpdateProgressMock;
    };
  }

  it('streams a small valid CSV, batch-inserts via createMany, and reports completion', async () => {
    const filePath = writeCsv('valid.csv', [
      'Siti Nurhaliza,28,Software Engineer,12000000',
      'Budi Santoso,35,Product Manager,22000000',
      'Citra Wijaya,24,QA Engineer,9500000',
    ]);
    const job = makeJob(filePath);

    const result = await processor.process(job);

    expect(result).toEqual({ imported: 3, skipped: 0, errors: [] });
    expect(prisma.employee.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.employee.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: 'Siti Nurhaliza',
          age: 28,
          position: 'Software Engineer',
          salary: 12000000,
        },
        {
          name: 'Budi Santoso',
          age: 35,
          position: 'Product Manager',
          salary: 22000000,
        },
        {
          name: 'Citra Wijaya',
          age: 24,
          position: 'QA Engineer',
          salary: 9500000,
        },
      ],
      skipDuplicates: true,
    });
    expect(notificationsService.notifyCsvImportCompleted).toHaveBeenCalledWith(
      'job-1',
      { imported: 3, skipped: 0, errors: [] },
    );
    // Temp file is cleaned up regardless of outcome.
    expect(existsSync(filePath)).toBe(false);
  });

  it('skips invalid rows and collects them instead of failing the whole job', async () => {
    const filePath = writeCsv('mixed.csv', [
      'Siti Nurhaliza,28,Software Engineer,12000000', // valid
      ',30,Product Manager,10000000', // invalid: blank name
      'Budi Santoso,not-a-number,Product Manager,10000000', // invalid: bad age
      'Citra Wijaya,24,QA Engineer,-500', // invalid: negative salary
      'Dedi Kusuma,41,Operations Manager,18000000', // valid
    ]);
    const job = makeJob(filePath, 'job-2');

    const result = await processor.process(job);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatch(/^Row 2: name is required/);
    expect(result.errors[1]).toMatch(/^Row 3: age must be a positive integer/);
    expect(result.errors[2]).toMatch(
      /^Row 4: salary must be a non-negative number/,
    );

    // Only the 2 valid rows ever reach Prisma.
    expect(prisma.employee.createMany).toHaveBeenCalledTimes(1);
    const insertedNames = prisma.employee.createMany.mock.calls[0][0].data.map(
      (row) => row.name,
    );
    expect(insertedNames).toEqual(['Siti Nurhaliza', 'Dedi Kusuma']);

    // The job resolves normally (skip-and-collect, not a hard failure).
    expect(notificationsService.notifyCsvImportFailed).not.toHaveBeenCalled();
    expect(notificationsService.notifyCsvImportCompleted).toHaveBeenCalledWith(
      'job-2',
      result,
    );
  });

  it('reports progress once per batch (not per row) and flushes multiple batches for large files', async () => {
    const rows: string[] = [];
    for (let i = 0; i < 750; i += 1) {
      rows.push(`Employee ${i},30,Engineer,10000000`);
    }
    const filePath = writeCsv('large.csv', rows);
    const job = makeJob(filePath, 'job-3');

    const result = await processor.process(job);

    expect(result.imported).toBe(750);
    expect(result.skipped).toBe(0);

    // BATCH_SIZE is 500, so 750 rows flush as 500 + 250.
    expect(prisma.employee.createMany).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = prisma.employee.createMany.mock.calls;
    expect(firstCall[0].data).toHaveLength(500);
    expect(secondCall[0].data).toHaveLength(250);

    // One updateProgress call per batch flush plus a final 100% call.
    expect(job.updateProgress.mock.calls.length).toBeGreaterThanOrEqual(3);
    const progressValues = job.updateProgress.mock.calls.map((call) => call[0]);
    const percents = progressValues.map((p) => p.percent);
    expect(percents[percents.length - 1]).toBe(100);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }

    // SSE progress notification fired at least once per batch.
    expect(
      notificationsService.notifyCsvImportProgress.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(notificationsService.notifyCsvImportProgress).toHaveBeenCalledWith(
      'job-3',
      expect.objectContaining({ rowsProcessed: expect.any(Number) as number }),
    );
  });

  it('publishes csv-import.failed and rethrows if the file cannot be read', async () => {
    const job = makeJob(join(tmpDir, 'does-not-exist.csv'), 'job-4');

    await expect(processor.process(job)).rejects.toThrow();

    expect(notificationsService.notifyCsvImportFailed).toHaveBeenCalledWith(
      'job-4',
      expect.any(String),
    );
    expect(
      notificationsService.notifyCsvImportCompleted,
    ).not.toHaveBeenCalled();
  });
});
