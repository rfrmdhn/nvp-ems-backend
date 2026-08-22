# tests/employees.md

Required coverage for Employees, mapped to the brief's "Unit Test: CRUD employee" requirement.

## Implemented — `src/employees/employees.service.spec.ts`

- `create`: calls `prisma.employee.create` with the expected `data` shape, then calls
  `EmployeeCreatedProducer.enqueue` with the new row's id; returns the created row.
- `findAll`: calls `prisma.employee.findMany`/`count` with the expected `skip`/`take` and
  defaults (`page` 1, `limit` 50, `createdAt desc`, no filter), returns
  `{ data, total, page, limit }`; computes `skip`/`take` correctly for a non-default
  `page`/`limit`; builds the `OR`-of-`contains`/`mode: insensitive` `where` clause against
  `name`/`position` when `search` is given (and passes the same `where` to `count`); sorts by
  the requested `sortBy`/`sortOrder`.
- `findOne`: returns the row when found; throws `NotFoundException` when
  `prisma.employee.findUnique` resolves `null`.
- `update`: throws `NotFoundException` (and never calls `prisma.employee.update`) when the row
  doesn't exist; otherwise calls `update` with only the changed fields.
- `remove`: throws `NotFoundException` (and never calls `prisma.employee.delete`) when the row
  doesn't exist; otherwise deletes and returns the row.

All mock `PrismaService` and `EmployeeCreatedProducer` — no real DB/Redis connection needed.

## Implemented — `test/api/*.e2e-spec.ts` (black-box, against a running `docker compose` stack)

Both items below are done, as part of the fuller 9-type API test pass documented in
`../../../API_Test_Report.md`:

- Controller-level HTTP behavior (`ParseUUIDPipe`/`ValidationPipe` in the loop, not just the
  service layer) — `test/api/functional-employees.e2e-spec.ts` covers the full CRUD +
  pagination/search/sort table above end-to-end, plus mass-assignment (client-supplied `id`) and
  malformed-`:id` cases.
- Every Employees route 401s without a JWT, plus tampered/expired/`alg: none` JWTs — no longer
  code-inspection-only — `test/api/security.e2e-spec.ts`.

This pass also found and fixed three validation gaps in `CreateEmployeeDto`
(`src/employees/dto/create-employee.dto.ts`), inherited by `UpdateEmployeeDto` via `PartialType`:
unbounded `name`/`position` length (now `@MaxLength(255)`), control characters including a NUL
byte in `name`/`position` reaching Postgres as an uncaught 500 (now `@Matches` rejects them), and
a `salary` beyond the `Decimal(14,2)` column's range 500ing instead of 400ing (now `@Max`). See
`API_Test_Report.md` §8 (Findings B/C/D) for reproduction and re-verification.
