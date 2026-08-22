# plans/csv-import.md

Full implementation plan for CSV bulk import — **implemented** in
`src/queue/processors/csv-import.processor.ts` (see `EMS-BACKEND-PLAN.md` §8). This doc is kept
as the design record / rationale for the choices actually landed on. Read this doc before
touching `src/queue/processors/csv-import.processor.ts` or `src/csv-import/`.

## Why this was originally a separate phase

The brief requires streaming-parsing 20,000+ rows without buffering the whole file, dispatching a
BullMQ job, chunked/batched inserts in the worker, and frontend-visible progress — that's a
meaningfully sized, independently testable unit of work distinct from the CRUD/auth/queue
plumbing the harness phase already proved works end-to-end via the employee-created path.
Shipping a stub first (registered, compiling, wired into the module graph) rather than a
half-done implementation avoided a half-working feature masquerading as done; this doc now
reflects the completed implementation.

## Step-by-step plan (as implemented)

1. **Upload endpoint** (already implemented in this phase —
   `src/csv-import/csv-import.controller.ts`): `POST /csv-import/upload`, guarded, `FileInterceptor`
   with `diskStorage` (never `memoryStorage`), `.csv`-only `fileFilter`, 200MB `limits.fileSize`.
   Nothing to change here unless the size limit or accepted mimetypes need adjusting.

2. **Enqueue** (already implemented — `src/csv-import/csv-import.service.ts` /
   `src/queue/csv-import.producer.ts`): adds `{ filePath, originalFilename }` to the `csv-import`
   queue, returns `{ jobId }`. Nothing to change here.

3. **Processor** (`src/queue/processors/csv-import.processor.ts` — real implementation):
   - `fs.createReadStream(job.data.filePath).pipe(parse({ columns: true, trim: true,
     skip_empty_lines: true }))`, consumed with `for await (const row of parser)` — never
     materializes the whole file.
   - `BATCH_SIZE = 500`. Valid rows accumulate into a `ValidEmployeeRow[]` batch array; on
     reaching `BATCH_SIZE`, `flush()` calls `prisma.employee.createMany({ data: batch,
     skipDuplicates: true })`, adds `result.count` to `imported`, clears the array, and reports
     progress (see below). A final `flush()` after the loop handles the trailing partial batch.
   - Invalid rows increment `skipped` and push `Row <n>: <reason>` onto `errors` — capped at the
     first `MAX_COLLECTED_ERRORS = 20` entries so a mostly-garbage file doesn't blow up the job's
     return value; `skipped` itself still counts every bad row accurately.
   - On stream end: delete the temp file (`fs/promises unlink`, swallowing errors — best-effort
     cleanup), call `job.updateProgress(...)` one final time at `percent: 100`, publish
     `NotificationsService.notifyCsvImportCompleted(jobId, { imported, skipped, errors })`, and
     return that same summary as the job's `returnvalue`.
   - On any thrown error while streaming/parsing (including `fs.statSync` failing because the
     upload file is missing): best-effort `unlink`, publish
     `NotificationsService.notifyCsvImportFailed(jobId, message)`, then rethrow so BullMQ marks
     the job `failed`.

4. **Progress reporting — byte-based (the choice actually made)**:
   `fs.statSync(filePath).size` gives total bytes upfront with **no pre-pass over the file** (a
   row-count pre-pass would require reading the whole file twice — once to count lines, once to
   parse — which is wasteful for a 20,000+ row file and adds real wall-clock time to every
   import). `fs.ReadStream` exposes a live `.bytesRead` property as it streams, so
   `percent = min(99, floor(bytesRead / totalBytes * 100))` gives a real, monotonically
   increasing percentage the whole way through, capped at 99 until the job actually finishes
   (then set to 100 explicitly) so a client never sees "100%" while the temp-file cleanup /
   final notification is still in flight. The progress payload also carries `rowsProcessed` (a
   plain count of valid+invalid rows seen so far) as a convenience field for a "X rows processed"
   label — it is not used for the percentage itself.
   Reported once per batch flush (not per row) via `job.updateProgress({ processed, total,
   percent, rowsProcessed })` **and** as a `csv-import.progress` SSE event through
   `NotificationsService.notifyCsvImportProgress(jobId, progress)` — reusing the exact
   worker→api Redis pub/sub bridge (§7.1) the `employee-created` processor already uses, not a
   second parallel notification path.

5. **Validation** (`CsvImportProcessor.validateRow`, hand-rolled rather than
   `class-validator`/`plainToInstance` for per-row overhead at 20k+ iterations): name non-empty
   string, age a positive integer, position non-empty string, salary a non-negative number.
   Deliberately looser than `CreateEmployeeDto`'s 16-100 age band (see AUDIT.md #3) — a bulk
   import of external data shouldn't hard-reject a row just because someone's age is 15 or 101;
   the single-employee `POST /employees` endpoint keeps the stricter bounds.

6. **Status endpoint** (`GET /csv-import/:jobId/status`, guarded by `JwtAuthGuard` at the
   controller-class level): `CsvImportService.getStatus(jobId)` looks up the job via
   `Queue.getJob(jobId)`/`job.getState()`, merges in the last `job.updateProgress()` payload
   (when it looks like a `CsvImportProgress` object) and, once `state === 'completed'`,
   `job.returnvalue` (`{ imported, skipped, errors }`); a `failed` job's `errors` falls back to
   `[job.failedReason]`. Returns `{ jobId, state, processed?, total?, percent?, rowsProcessed?,
   imported?, skipped?, errors? }` — this is the fallback for a client that missed the SSE
   events (e.g. the page was refreshed mid-import).

7. **Cleanup**: always delete the temp uploaded file on completion (success or failure) — the
   `uploads/` directory is scratch space, not permanent storage.

## Dependencies

- `csv-parse` (already installed) — its streaming API, imported as `import { parse } from
  'csv-parse'` (Node stream transformer), not `csv-parse/sync`.
- `prisma.employee.createMany({ skipDuplicates: true })` for batch inserts.

## Open decisions (resolved in `AUDIT.md`/`ASSUMPTIONS_MADE.md`, restated here for convenience)

- Invalid rows are skipped and reported (`AUDIT.md` #3) — never fail the whole import for one
  bad row.
- No transaction wrapping the whole import — each batch's `createMany` is its own atomic unit;
  a mid-import crash leaves already-flushed batches committed (acceptable for a bulk import, which
  is inherently a best-effort operation over untrusted external data, not a single all-or-nothing
  financial transaction).
- Progress is byte-based, not row-count-based (see step 4 above) — chosen for a real percentage
  without a wasteful pre-pass over the file.
- The collected `errors` list is capped at 20 entries; `skipped` is not (it's a plain counter,
  always accurate).

## Testing

`src/queue/processors/csv-import.processor.spec.ts` covers: a small valid CSV batches correctly
through a mocked `prisma.employee.createMany`; a file mixing valid and invalid rows
skips-and-collects the invalid ones (with correct row numbers/reasons) while still importing the
rest; a 750-row file (> `BATCH_SIZE`) flushes as two batches (500 + 250) with monotonically
increasing byte-based `percent` values ending at 100, and at least one `notifyCsvImportProgress`
call per batch; and a missing source file publishes `csv-import.failed` and rethrows rather than
silently resolving. All three run against real temp files on disk (via `fs.mkdtempSync`) with
Prisma/NotificationsService mocked — no real DB/Redis needed.
