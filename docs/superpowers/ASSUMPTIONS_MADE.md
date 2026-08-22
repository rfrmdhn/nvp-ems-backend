# ASSUMPTIONS_MADE.md

Concrete resolutions for each `AUDIT.md` item, so implementation isn't blocked waiting on
clarification. If the brief's actual intent differs, these are the specific lines to revisit.

## Resolves #1 — Single admin role

**Assumption**: one `Admin` model, no `role` column, no permission tiers. "HR" in the brief's
prose is read as describing the seeded admin's in-world job function, not a second role to model.
If a real HR-vs-admin distinction is needed later, add a `role` enum column to `Admin` and a
`RolesGuard` alongside `JwtAuthGuard` — the JWT payload already carries `sub`/`email` and can be
extended with `role` without a breaking change to the login response shape.

## Resolves #2 — Notifications are ephemeral

**Assumption**: no `Notification` table. The RxJS `Subject` in `NotificationsService`, fed by a
Redis pub/sub channel from the worker process, only reaches clients connected to
`/notifications/stream` at the moment an event fires. A client that reconnects after a job
finished simply doesn't see that notification — acceptable for a technical test whose testable
behavior is "does the toast/list update live while I'm watching," not "is there a durable
notification inbox." If persistence is needed later, add a `Notification` table written
alongside the `publish()` call in `NotificationsService`, and a `GET /notifications` endpoint for
the missed-backlog case.

## Resolves #3 — CSV import: skip-and-collect, not all-or-nothing

**Assumption**: invalid rows are skipped and recorded (row number + reason) rather than failing
the whole import. Rationale: at 20,000+ rows, a single malformed row (e.g., a stray blank line,
one bad salary value) failing the entire batch would be a poor UX for a bulk-import feature and
doesn't match how most real HR data imports behave (partial success is expected and normal). This
is documented as the target behavior for the CSV-import phase in `EMS-BACKEND-PLAN.md` §8 and
`plans/csv-import.md` — **implemented** in `src/queue/processors/csv-import.processor.ts`: each
row is validated independently (name non-empty, age a positive integer, position non-empty,
salary a non-negative number); invalid rows increment `skipped` and are recorded (capped at the
first 20) in the returned `errors` array, valid rows still batch-insert via
`prisma.employee.createMany`.

## Resolves #4 — SSE endpoint authentication

**Assumption (superseded)**: `GET /notifications/stream` originally shipped with no
`JwtAuthGuard` — see AUDIT.md #4's history. Once explicitly asked for, this was locked down:
`NotificationsController.stream()` is now guarded by `AuthGuard('jwt-sse')`, a second Passport
strategy (`JwtSseStrategy`) that reads the JWT from a `?token=` query param first (what native
`EventSource` requires, since it can't set an `Authorization` header) and falls back to the
standard Bearer header otherwise. It reuses `JwtStrategy`'s `validate()` logic and secret via
`src/auth/strategies/jwt-payload.ts` rather than duplicating it. Scoped to this one route only —
no other endpoint accepts a query-string token, since those are more likely to leak into logs or
browser history than headers.

## Resolves #5 — Bare RxJS Subject is sufficient

**Assumption**: a plain `Subject` (not `ReplaySubject`) is used, with no explicit backpressure
handling. The volume of notifications this demo generates (one per employee create, one per CSV
import completion) is far below any threshold where a slow consumer would matter. Revisit if
notification volume/frequency changes materially (e.g., per-row CSV progress events fanned out
over SSE instead of via BullMQ's own `job.progress` polling, which is what §8 actually
recommends).

## Resolves #6 — GET /employees pagination is server-side

**Assumption**: `GET /employees` does the pagination, search, and sort work in Postgres via
Prisma (`skip`/`take` + `WHERE ... ILIKE` equivalent + `ORDER BY`), not in the browser. The
frontend never fetches more than `limit` (capped at 500) rows in one response, regardless of how
large the roster grows — consistent with the same "never load the whole thing into memory/over
the wire at once" principle that governs the CSV importer. `sortBy` is restricted to an explicit
enum (`name`, `age`, `position`, `salary`, `createdAt`) rather than accepting an arbitrary column
name, so a client can never inject an unexpected `ORDER BY` target.
