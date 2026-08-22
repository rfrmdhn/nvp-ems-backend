# tests/queue.md

Required coverage for the queue layer, mapped to the brief's "Unit Test: queue handler"
requirement.

## Implemented — `src/queue/processors/employee-created.processor.spec.ts`

- Processing a job for an employee that still exists: asserts `prisma.employee.findUnique` was
  called with the job's `employeeId`, and `NotificationsService.notifyEmployeeCreated` was called
  with an object matching the employee's `id`/`name`/`salary` (salary as a string).
- Processing a job for an employee that no longer exists: asserts
  `NotificationsService.notifyEmployeeCreated` is **not** called.

Both mock `PrismaService` and `NotificationsService` directly (no real Redis/BullMQ connection
needed — the test calls `processor.process(job)` directly rather than going through an actual
BullMQ `Worker`).

## Not implemented this phase (candidates if scope expands)

- `CsvImportProcessor` unit test — deferred until the real streaming/batch-insert logic exists
  (testing the current stub's `NOT_IMPLEMENTED` return value would be testing a placeholder, not
  real behavior).
- An integration test that actually spins up BullMQ against a real (test) Redis instance and
  verifies a job added via `EmployeeCreatedProducer.enqueue()` gets picked up end-to-end.
- `EmployeeCreatedProducer`/`CsvImportProducer` unit tests (currently trivial pass-throughs to
  `Queue.add()` — covered indirectly via `employees.service.spec.ts`'s assertion that `enqueue`
  gets called).
