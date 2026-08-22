# specs/queue.md

Behavior/edge cases for the queue layer. See `EMS-BACKEND-PLAN.md` §6.

## employee-created queue

| Scenario | Expected behavior |
|---|---|
| `EmployeesService.create()` succeeds | A job `{ employeeId }` is added to `employee-created`. |
| Processor picks up the job, employee still exists | ~300ms delay, then `NotificationsService.notifyEmployeeCreated(employee)` is called with the employee's fields (salary serialized to a string, since Prisma's `Decimal` isn't directly JSON/Redis-safe). |
| Processor picks up the job, employee was deleted in the meantime | Logs a warning, does **not** call `notifyEmployeeCreated`, resolves the job normally (not a failure — the employee genuinely no longer exists, that's not an error condition). |
| Job processing throws an uncaught error | BullMQ's default retry policy applies (attempts/backoff are queue defaults, not customized in this phase — small/fast queue, defaults are adequate). |

## csv-import queue (stub — see `specs/csv-import.md` for the full next-phase spec)

| Scenario | Expected behavior (current stub) |
|---|---|
| `CsvImportService.enqueueImport()` called | A job `{ filePath, originalFilename }` is added to `csv-import`, returns `{ jobId }` immediately. |
| Processor picks up the job | Logs a warning that streaming parse/batch insert isn't implemented yet, calls `job.updateProgress(100)`, resolves with `{ imported: 0, skipped: 0, errors: ['NOT_IMPLEMENTED'] }`. This is a deliberate placeholder, not a silent no-op — the returned `errors` array makes the stub state visible to any caller polling status. |

## Cross-process notes

Both `api` and `worker` containers run the same `AppModule`, so both instantiate BullMQ `Worker`s
for both queues (see `plans/queue.md`). A job added from either process is picked up by whichever
worker instance claims it first — functionally correct, just not the leanest possible topology.
