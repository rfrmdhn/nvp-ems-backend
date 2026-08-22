# plans/employees.md

Implementation approach for Employee CRUD. See `EMS-BACKEND-PLAN.md` §5.

## Approach

- `EmployeesService` is Prisma-only data access, plus exactly one async side-effect call
  (`EmployeeCreatedProducer.enqueue`) after a successful `create`. It has no other knowledge of
  BullMQ.
- `findOne(id)` throws `NotFoundException` when the row doesn't exist; `update`/`remove` both call
  `findOne` first so the 404 happens before any write attempt, and so `update`/`remove` never
  silently no-op on a missing row.
- `:id` route params are validated with `ParseUUIDPipe` at the controller — a malformed UUID
  never reaches the service/Prisma layer.
- `UpdateEmployeeDto` (via `PartialType(CreateEmployeeDto)`) never carries an `id` field. The row
  to mutate is always the validated `:id` route param — this is the concrete mechanism behind the
  "never trust a client-supplied employee id" non-negotiable rule.
- Server-side pagination/search/sort on `GET /employees` (`AUDIT.md` #6 — resolved as
  server-side, never ship the whole roster to the browser): `page`/`limit` (defaults 1/50, `limit`
  capped at 500) drive `skip`/`take` + a parallel `count()`; `search` becomes an `OR` of two
  Prisma `contains`/`mode: 'insensitive'` clauses against `name` and `position`; `sortBy` is an
  explicit `EmployeeSortBy` enum (`name`/`age`/`position`/`salary`/`createdAt`) fed into
  `orderBy: { [sortBy]: sortOrder }` — never a raw client string, so an invalid value 400s via
  `class-validator`'s `@IsEnum` before it ever reaches Prisma. `count()` is called with the same
  `where` filter as `findMany` so `total` reflects the filtered result set, not the whole table.
  `skip`/`take` is fine at this scale; would need a keyset/cursor approach if the roster grew into
  the millions, which is out of scope here.

## Dependencies

- `EmployeeCreatedProducer` (from `src/queue/`) — injected, not constructed directly.
- `JwtAuthGuard` (from `src/auth/`) — applied at the controller-class level.

## Open decisions

None beyond what's already resolved in `AUDIT.md`/`ASSUMPTIONS_MADE.md`. Filtering is
deliberately a single `search` substring across `name`/`position` only — no per-field or
range filters (e.g. salary between X and Y) — see `specs/employees.md`'s non-goals.
