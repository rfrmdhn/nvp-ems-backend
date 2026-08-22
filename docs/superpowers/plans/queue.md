# plans/queue.md

Implementation approach for the BullMQ queue architecture. See `EMS-BACKEND-PLAN.md` §6.

## Approach

- One Redis connection (`BullModule.forRootAsync`), two named queues
  (`employee-created`, `csv-import`) registered via `BullModule.registerQueue`.
- Producers (`EmployeeCreatedProducer`, `CsvImportProducer`) are thin wrappers around
  `@InjectQueue()` — the only thing calling code needs to know is "enqueue this payload," never
  BullMQ's `Queue` API directly.
- `EmployeeCreatedProcessor extends WorkerHost`, decorated `@Processor('employee-created')` (the
  `@nestjs/bullmq` v11 pattern — `process(job)` method, not the older `@nestjs/bull`
  `@Process()`-decorated-method style). Fully implemented: re-fetches the employee, waits ~300ms
  to simulate real post-creation work, calls `NotificationsService.notifyEmployeeCreated`.
- `CsvImportProcessor` is registered the same way but its `process()` body is a stub — see
  `plans/csv-import.md` for the full next-phase design.
- **Both `main.ts` (api) and `worker.ts` (worker) bootstrap the same `AppModule`**, so both
  processes register `QueueModule`'s processors and therefore both run a BullMQ `Worker` instance
  per queue. This is intentional for this technical test (see `EMS-BACKEND-PLAN.md` §10/§6.3
  reasoning restated in `app.module.ts`'s doc comment) — BullMQ dedupes job consumption across any
  number of workers on the same queue via its own locking, so this doesn't cause double
  processing, it just means the `api` container is a secondary (idle-most-of-the-time) consumer
  alongside the dedicated `worker` container. A stricter separation (processors registered only in
  a worker-specific module) is a reasonable follow-up if this needs to scale independently later.

## Dependencies

- `@nestjs/bullmq`, `bullmq`, `ioredis` (via `@nestjs/bullmq`'s own Redis client).
- `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` env vars.
- `NotificationsService` (employee-created processor's only external side-effect).

## Open decisions

None specific to the employee-created path. csv-import's queue payload/consumer is fully
specified in `EMS-BACKEND-PLAN.md` §8 but not yet implemented.
