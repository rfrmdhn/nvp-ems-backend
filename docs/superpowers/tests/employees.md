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

## Not implemented this phase (candidates if scope expands)

- E2E tests hitting the real HTTP routes with `ParseUUIDPipe`/`ValidationPipe` in the loop (the
  unit tests above cover the service layer only, not controller-level validation behavior
  described in `specs/employees.md`).
- A test asserting every Employees route actually 401s without a JWT (currently guaranteed by
  code inspection — `@UseGuards(JwtAuthGuard)` at the controller-class level — not by a test).
