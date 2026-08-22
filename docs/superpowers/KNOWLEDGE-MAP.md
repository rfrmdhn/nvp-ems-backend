# KNOWLEDGE-MAP.md

Per-feature breakdown: owned Prisma models, file locations, and the `EMS-BACKEND-PLAN.md`
section that defines each feature's design.

## auth

- **Owned models**: `Admin` (read-only from this feature's perspective — no admin-creation
  endpoint, only the seed script writes to it).
- **Files**: `src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`,
  `strategies/jwt.strategy.ts`, `guards/jwt-auth.guard.ts`, `dto/login.dto.ts`,
  `dto/login-response.dto.ts`, `auth.service.spec.ts`.
- **Plan reference**: `EMS-BACKEND-PLAN.md` §4.

## employees

- **Owned models**: `Employee` (full CRUD).
- **Files**: `src/employees/employees.module.ts`, `employees.controller.ts`,
  `employees.service.ts`, `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`,
  `dto/query-employees.dto.ts`, `employees.service.spec.ts`.
- **Plan reference**: `EMS-BACKEND-PLAN.md` §5.

## queue

- **Owned models**: none directly — reads `Employee` (employee-created processor re-fetches the
  row for its notification payload).
- **Files**: `src/queue/queue.module.ts`, `queue.constants.ts`, `employee-created.producer.ts`,
  `csv-import.producer.ts`, `processors/employee-created.processor.ts` (full),
  `processors/csv-import.processor.ts` (stub), `processors/employee-created.processor.spec.ts`.
- **Plan reference**: `EMS-BACKEND-PLAN.md` §6 (§6.1 employee-created, §6.2 csv-import,
  §6.3 Redis connection).

## notifications

- **Owned models**: none — ephemeral, see `docs/superpowers/AUDIT.md` #2.
- **Files**: `src/notifications/notifications.module.ts`, `notifications.controller.ts`,
  `notifications.service.ts`, `notification-event.interface.ts`.
- **Plan reference**: `EMS-BACKEND-PLAN.md` §7 (§7.1 cross-process bridging).

## csv-import

- **Owned models**: none directly — the (not-yet-implemented) processor will bulk-write to
  `Employee` via `createMany`.
- **Files**: `src/csv-import/csv-import.module.ts`, `csv-import.controller.ts`,
  `csv-import.service.ts` (upload/enqueue/status stub — status lookup is implemented against
  BullMQ's own job state, the parse/insert loop is the TODO).
- **Plan reference**: `EMS-BACKEND-PLAN.md` §8 (full design for the next phase).

## prisma / config / common (cross-cutting, no dedicated feature docs)

- `src/prisma/prisma.service.ts`, `prisma.module.ts` — global PrismaService.
- `src/config/env.validation.ts`, `configuration.ts` — Joi-validated env surface.
- `src/common/decorators/current-user.decorator.ts`,
  `src/common/filters/all-exceptions.filter.ts` — shared cross-cutting concerns.
- **Plan reference**: `EMS-BACKEND-PLAN.md` §3 (data model), §10 (Docker/env).
