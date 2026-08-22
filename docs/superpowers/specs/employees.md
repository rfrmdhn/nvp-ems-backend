# specs/employees.md

Behavior/edge cases for `/employees`. See `EMS-BACKEND-PLAN.md` §5. All routes require a valid
JWT (see `specs/auth.md`'s protected-route table) — omitted below for brevity.

## POST /employees

| Input | Expected behavior |
|---|---|
| Valid `{ name, age, position, salary }` | `201 Created`, full employee row (incl. generated `id`, `createdAt`, `updatedAt`), enqueues an `employee-created` job. |
| Missing/empty `name` or `position` | `400 Bad Request`. |
| `age` outside 16-100, non-integer, or missing | `400 Bad Request`. |
| Negative `salary` or missing | `400 Bad Request`. |
| Extra body fields (e.g. a client-supplied `id`) | Silently stripped by `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — actually `forbidNonWhitelisted` turns this into a `400` rather than a silent strip, so a client trying to set its own `id` on create gets a hard rejection, not a quiet ignore. |

## GET /employees

Server-side pagination/search/sort (see `docs/superpowers/AUDIT.md` #6 / `ASSUMPTIONS_MADE.md`
#6) — the frontend never fetches the whole roster in one response.

**Query params** (all optional, all validated by `QueryEmployeesDto`):

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int, min 1 | `1` | |
| `limit` | int, min 1, max 500 | `50` | Capped to prevent a client from requesting the whole roster in one page. |
| `search` | string | none | Case-insensitive substring match against `name` OR `position` (Prisma `contains` + `mode: 'insensitive'`). |
| `sortBy` | enum: `name` \| `age` \| `position` \| `salary` \| `createdAt` | `createdAt` | Allowlisted — never passed straight into Prisma's `orderBy` as a raw string. |
| `sortOrder` | enum: `asc` \| `desc` | `desc` | |

**Response** (`200 OK`): `{ data: Employee[], total: number, page: number, limit: number }` —
`total` is the count matching the `search` filter (not the whole table), so the frontend can
compute total pages / know when it has fetched everything for infinite-scroll purposes.

| Input | Expected behavior |
|---|---|
| No query params | `200 OK`, page 1, limit 50, `createdAt desc`, no search filter. |
| `?page=2&limit=5` | `200 OK`, correct `skip`/`take` slice (`skip = (page-1)*limit`), `{ data, total, page, limit }`. |
| `?search=engineer` | `200 OK`, only rows whose `name` or `position` case-insensitively contains "engineer"; `total` reflects the filtered count. |
| `?sortBy=salary&sortOrder=asc` | `200 OK`, rows ordered by `salary` ascending. |
| `?sortBy=notacolumn` | `400 Bad Request` (`sortBy` is validated against the enum, not passed through to Prisma). |
| `page`/`limit` non-integer, `< 1`, or `limit > 500` | `400 Bad Request`. |

## GET /employees/:id

| Input | Expected behavior |
|---|---|
| Existing uuid | `200 OK`, the employee row. |
| Well-formed but non-existent uuid | `404 Not Found`. |
| Malformed (non-uuid) `:id` | `400 Bad Request` (`ParseUUIDPipe`), never reaches Prisma. |

## PUT /employees/:id

| Input | Expected behavior |
|---|---|
| Partial valid body (e.g. only `salary`) | `200 OK`, only that field changes, `updatedAt` bumps. |
| Non-existent `:id` | `404 Not Found`, no write attempted. |
| Body includes an `id` field | Rejected by `ValidationPipe({ forbidNonWhitelisted: true })` — `UpdateEmployeeDto` has no `id` property, so this is a `400`, not a silent redirect to another row. |
| Invalid field value (e.g. `age: -5`) | `400 Bad Request`. |

## DELETE /employees/:id

| Input | Expected behavior |
|---|---|
| Existing uuid | `200 OK`, returns the deleted row. |
| Non-existent uuid | `404 Not Found`. |

## Non-goals for this phase

- No soft-delete/status transitions (see `FEATURE-IDEAS.md`).
- No filtering beyond a single `search` substring match against `name`/`position` (no per-field
  filters, no range filters on `age`/`salary`, no multi-column sort).
