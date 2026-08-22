# specs/csv-import.md

Behavior/edge cases for CSV bulk import. See `EMS-BACKEND-PLAN.md` §8 and `plans/csv-import.md`.
**Fully implemented** — upload, enqueue, streaming parse + batch insert, progress reporting
(BullMQ `job.updateProgress` + SSE), and the status endpoint are all real.

## Realtime events (`GET /notifications/stream`, SSE)

Pushed through the same `NotificationsService`/Redis-pub-sub bridge the `employee-created`
processor already uses (§7/§7.1) — no second notification path.

The stream requires `?token=<jwt>` (see `docs/superpowers/specs/notifications.md`'s
Authentication section and `AUDIT.md` #4) — a client watching CSV-import progress connects via
`new EventSource('/notifications/stream?token=' + jwt)`, same as for `employee.created` events.

| `type` | `data` payload | When |
|---|---|---|
| `csv-import.progress` | `{ jobId: string, processed: number, total: number, percent: number, rowsProcessed: number }` | Once per batch flush (every `BATCH_SIZE` rows, not every row). `processed`/`total` are **byte counts** (bytes read / total file size), not row counts — see `plans/csv-import.md`'s "Progress reporting" section for why byte-based was chosen over a row-count pre-pass. `rowsProcessed` is a plain row-count convenience field. `percent` is capped at 99 until the job fully resolves. |
| `csv-import.completed` | `{ jobId: string, imported: number, skipped: number, errors: string[] }` | Once, when the job resolves. `errors` is capped to the first 20 entries; `imported`/`skipped` are exact counts. |
| `csv-import.failed` | `{ jobId: string, error: string }` | Once, if the job throws before it can resolve (e.g. the uploaded file went missing, an unexpected parse error). |

## POST /csv-import/upload — implemented

| Input | Expected behavior |
|---|---|
| Valid `.csv` file, field name `file` | `202 Accepted`, `{ jobId }`. File streamed to `uploads/<uuid>.csv` on disk (never buffered fully in memory by Multer). |
| No file / wrong field name | `400 Bad Request`. |
| Non-`.csv` extension | `400 Bad Request` (`fileFilter` rejects before the file is fully written). |
| File exceeds 200MB | Multer's `limits.fileSize` rejects with an error (surfaces as a `413`/`400` depending on Multer's error handling — verify exact status if this limit is ever tuned). |
| No `Authorization` header | `401 Unauthorized`. |

## GET /csv-import/:jobId/status — implemented

Guarded by `JwtAuthGuard` at the controller-class level, like every other route in this module.

Response shape: `{ jobId: string, state: string, processed?: number, total?: number, percent?:
number, rowsProcessed?: number, imported?: number, skipped?: number, errors?: string[] }`.
`state` is one of BullMQ's job states (`waiting|active|completed|failed|delayed|...`).
`processed`/`total`/`percent`/`rowsProcessed` come from the last `job.updateProgress()` payload
(present once the job has flushed at least one batch); `imported`/`skipped`/`errors` come from
`job.returnvalue` once `state === 'completed'`. A `failed` job reports `errors: [job.failedReason]`.

| Input | Expected behavior |
|---|---|
| Valid `jobId`, job still `waiting`/hasn't flushed a batch yet | `200 OK`, `{ jobId, state: 'active' }` with no progress fields yet. |
| Valid `jobId`, job actively processing | `200 OK`, `{ jobId, state: 'active', processed, total, percent, rowsProcessed }`. |
| Valid `jobId`, job finished | `200 OK`, `{ jobId, state: 'completed', percent: 100, processed, total, rowsProcessed, imported, skipped, errors }`. |
| Valid `jobId`, job threw | `200 OK`, `{ jobId, state: 'failed', errors: [<failedReason>] }` (plus whatever progress fields were last recorded). |
| Non-existent `jobId` | `404 Not Found`. |

## Streaming parse + batch insert — implemented

| Scenario | Actual behavior |
|---|---|
| 20,000+ row well-formed CSV | Every row imported in batches of 500 via `prisma.employee.createMany`; `job.progress` (byte-based `percent`) advances smoothly over the course of processing (not a single jump from 0 to 100); final job result `{ imported: 20000, skipped: 0, errors: [] }`. |
| A few rows fail validation (bad age, blank name, negative salary, etc.) | Those rows are skipped and recorded in `errors` (row number + reason, capped at the first 20); all other valid rows still import. The whole job does not fail because of them. |
| Header row missing or malformed columns | Every data row fails validation (skip-and-collect still applies — result is `{ imported: 0, skipped: N, errors: [...] }`, capped at 20 error entries, rather than a hard job failure). |
| Duplicate rows within the same file | `createMany({ skipDuplicates: true })` — Employee has no natural-key uniqueness constraint beyond its generated `id`, so "duplicate" here would only matter if a future uniqueness rule (e.g. one row per name) is added; as currently modeled, `skipDuplicates` is a no-op safety net, not an active dedup mechanism. |
| Worker process crashes mid-import | Already-flushed batches (committed `createMany` calls) remain in the DB; the job is left in a failed/stalled state depending on BullMQ's lock timeout — no partial-import rollback (see `plans/csv-import.md`'s "no transaction wrapping the whole import" decision). |
| Uploaded file goes missing before the worker picks up the job | `fs.statSync` throws, the processor publishes `csv-import.failed` and rethrows; BullMQ marks the job `failed`. |
| Client polls `/csv-import/:jobId/status` while processing | `state: 'active'`, `percent` reflects the byte-based percentage computed so far (capped at 99 until the job fully resolves). |
| Client is connected to `GET /notifications/stream` while an import runs | Receives `csv-import.progress` events (one per batch), then one `csv-import.completed` (or `csv-import.failed`) event — no need to poll the status endpoint at all unless the connection was missed. |

## Non-goals for this phase

- No resumable uploads, no chunked multipart uploads beyond what Multer/browser already do.
- No virus/malware scanning of uploaded files.
