# tests/csv-import.md

CSV import isn't one of the brief's three explicitly required unit-test areas (login, CRUD
employee, queue handler), and its core logic isn't implemented yet in this phase — so there is no
test file for it today. This doc is the target coverage list for when `plans/csv-import.md` is
implemented.

## Required when the streaming/batch-insert logic ships

1. **Unit — row validation**: valid row passes, each individual invalid case (missing name, age
   out of range, negative salary, non-numeric salary) is rejected with a specific reason string.
2. **Unit — batching**: given a mocked Prisma client, N rows produce `ceil(N / BATCH_SIZE)` calls
   to `createMany`, each with at most `BATCH_SIZE` rows.
3. **Unit — skip-and-collect**: a stream mixing valid and invalid rows results in all valid rows
   passed to `createMany` and all invalid rows recorded in the returned `errors` array with
   correct row numbers.
4. **Unit — progress**: `job.updateProgress` is called at least once per batch flush, with
   monotonically increasing values, ending at 100.
5. **Integration** (needs a real or test Postgres + Redis): upload a real CSV fixture via
   `scripts/sample-employees.csv`, verify the resulting employee count in the DB matches the file
   minus deliberately-broken fixture rows, and that `GET /csv-import/:jobId/status` eventually
   reports `state: 'completed'`.
6. **Load/stress** (see root `CLAUDE.md`'s Testing Strategy — deferred, not required for this
   technical test): generate a 20,000+ row file via `scripts/generate-large-csv.mjs` and confirm
   peak worker process memory stays roughly flat regardless of file size (proves the "never
   buffer the whole file" requirement empirically, not just by code inspection).

## Currently implemented

`src/queue/processors/csv-import.processor.spec.ts` covers items 1-4 above against real temp
files on disk (`fs.mkdtempSync`) with `PrismaService`/`NotificationsService` mocked:

- A small (3-row) valid CSV batches through a single mocked `createMany` call and resolves with
  `{ imported: 3, skipped: 0, errors: [] }`.
- A file mixing valid and invalid rows (blank name, non-numeric age, negative salary) skips and
  collects exactly the invalid ones with correct row numbers/reasons, while the valid rows still
  reach `createMany`.
- A 750-row file (> `BATCH_SIZE` of 500) flushes as two batches (500 + 250); `job.updateProgress`
  is called with monotonically increasing byte-based `percent` values ending at 100, and
  `NotificationsService.notifyCsvImportProgress` fires at least once per batch.
- A missing source file causes `NotificationsService.notifyCsvImportFailed` to fire and the job
  to reject, rather than silently resolving.

## Now implemented

- **Item 5 (integration, black-box against a real running stack)**:
  `test/api/functional-csv-import.e2e-spec.ts` uploads `scripts/sample-employees.csv`, polls
  `GET /csv-import/:jobId/status` to `completed`, and asserts `imported: 20, skipped: 0`.
  `test/api/integration-workflow.e2e-spec.ts` chains this into the full
  login → create → SSE → CSV import → list workflow.
- **Item 6 (load/stress, 20,000+ row memory profile)**: `test/load/csv-memory-profile.sh` samples
  the `worker` container's RSS via `docker stats` while a large import runs. Actual runs (see
  `API_Test_Report.md`): 25,000 rows in ~1.2s and 100,000 rows in ~3.2s, worker RSS flat at
  ~65-67MB in both cases — empirically confirms the "never buffer the whole file" claim, not just
  by code inspection.

One genuine gap surfaced by `test/api/fuzz.e2e-spec.ts` while covering this area: a row with the
**wrong column count** (structurally malformed, not just semantically invalid) makes `csv-parse`
itself throw from inside the streaming loop, which the processor's outer `try/catch` treats as
fatal — the whole job ends in `failed`, not skip-and-collect, contradicting `AUDIT.md` #3's
documented resolution. See `API_Test_Report.md` for the reproduction and recommended fix
(`relax_column_count: true` + an explicit column-count check inside `validateRow`); not fixed in
this pass.
