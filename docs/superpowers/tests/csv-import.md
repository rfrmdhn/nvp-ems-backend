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

Item 5 (integration, real Postgres/Redis) and item 6 (load/stress, 20,000+ row memory profile)
remain deferred per root `CLAUDE.md`'s Testing Strategy — not required for this technical test,
but `scripts/generate-large-csv.mjs 20000` plus manual memory observation was used to sanity-check
the "never buffer the whole file" claim during implementation.
