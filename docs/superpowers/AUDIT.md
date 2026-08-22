# AUDIT.md — Open Ambiguities

Open decisions the brief doesn't pin down precisely, tracked here so an implementer can see the
question and the current resolution without re-litigating it mid-feature-work. Each item's
resolution is recorded in `ASSUMPTIONS_MADE.md`; this file states the question and the
considerations, not the answer.

## #1 — Single "admin" role vs a distinct "HR" role

The brief's prose refers loosely to an "HR" persona managing employees, but the concrete
requirement is "minimal 1 admin via seed" with email+password login — no mention of multiple
roles, permission tiers, or a distinct HR-vs-admin distinction anywhere in the CRUD/queue/CSV
requirements. Building a role system (RBAC table, per-route role checks) speculatively would be
scope creep with nothing in the brief to test it against.

**Question**: does "HR" in the brief's prose imply a second role is expected, or is it just
describing the seeded admin's job function in-world?

## #2 — Notification persistence: ephemeral vs a DB table

The brief says the worker "pushes a realtime notification to the frontend" after job completion.
It doesn't say notifications need to be queryable later (e.g., "show me all notifications from
today" or "notify me even if I wasn't connected when the job finished").

**Question**: should notifications survive a dropped SSE connection (persisted to a table, client
fetches missed ones on reconnect), or is "only clients connected at the moment of completion see
it" an acceptable scope cut for a technical test?

## #3 — Invalid-row handling during CSV import

For a 20,000+ row import, some rows will likely fail validation (missing field, bad age/salary
type, etc.). The brief doesn't specify behavior.

**Question**: does one invalid row fail the entire import (transactional, all-or-nothing), or
should valid rows still be imported while invalid ones are skipped and reported back?

**Resolved and implemented** in `src/queue/processors/csv-import.processor.ts`: skip-and-collect
(see `ASSUMPTIONS_MADE.md` #3). One deliberate deviation from `CreateEmployeeDto`'s bounds: a CSV
row's `age` only needs to be a *positive integer* (not the 16-100 working-age band the single-
employee `POST /employees` DTO enforces) and `salary` only needs to be a non-negative number —
bulk-importing external data shouldn't hard-reject a row just because someone's age is 15 or 101.
The single-employee creation endpoint keeps the stricter bounds.

## #4 — SSE endpoint authentication — RESOLVED

`GET /notifications/stream` is the realtime channel for job-completion events. Browsers'
`EventSource` API cannot set custom headers, so a `Authorization: Bearer <jwt>` guard (as used on
Employees/CSV-import) doesn't transparently apply here without extra plumbing (a `?token=` query
param + a guard that reads it from there instead of the header).

**Resolution**: locked down. A second Passport strategy, `JwtSseStrategy`
(`src/auth/strategies/jwt-sse.strategy.ts`, registered as `'jwt-sse'`), extracts the JWT via
`ExtractJwt.fromExtractors([(req) => req?.query?.token, ExtractJwt.fromAuthHeaderAsBearerToken()])`
— the `?token=` query param first (the only option `EventSource` has), falling back to the
standard `Authorization` header (so curl/Postman testing keeps working). It shares the same
`validate()` mapping and `JWT_SECRET` as the regular `JwtStrategy` via
`src/auth/strategies/jwt-payload.ts`, so there's exactly one place that turns a JWT payload into
`req.user`. `NotificationsController`'s `stream()` handler is guarded with
`@UseGuards(AuthGuard('jwt-sse'))` — this is the ONLY route that accepts a query-string token;
every other route is untouched and still only accepts the `Authorization` header via
`JwtAuthGuard`/`AuthGuard('jwt')`. A missing/invalid/expired token now gets a 401 like any other
guarded route. See `docs/superpowers/specs/notifications.md` for the updated contract.

## #5 — SSE reconnection / backpressure

Native `EventSource` auto-reconnects on drop, but replays nothing it missed while disconnected
(ties into #2). There's also no backpressure handling if a client is slow to consume — RxJS
`Subject` will just keep emitting regardless of consumer speed.

**Question**: is a bare RxJS `Subject` (no backlog buffer, no backpressure strategy) sufficient
for the scale a technical test needs, or does this need a `ReplaySubject`/bounded buffer?

## #6 — GET /employees pagination: client-side vs server-side — RESOLVED

The original frontend plan rendered a virtualized table against 10,000 rows of fake,
client-generated data. Once `GET /employees` is backed by real Prisma data, the same approach
would mean shipping the entire roster (10k+ rows, growing) to the browser in one response and
paginating/filtering/sorting it client-side — which defeats the whole point of the brief's
streaming/scale requirements (the same spirit that requires the CSV importer to never buffer a
whole file).

**Resolution**: server-side pagination, search, and sort. `GET /employees` accepts `page`,
`limit` (capped at 500), `search` (case-insensitive substring match against `name`/`position`,
via Prisma's `contains`/`mode: 'insensitive'`), `sortBy` (allowlisted enum: `name`, `age`,
`position`, `salary`, `createdAt`), and `sortOrder` (`asc`/`desc`). Response shape:
`{ data, total, page, limit }`. See `docs/superpowers/specs/employees.md` for the full contract
and `docs/superpowers/plans/employees.md` for the implementation approach. `sortBy` is validated
against an enum (`class-validator`'s `@IsEnum`) rather than passed straight into Prisma's
`orderBy`, so a client can never probe for arbitrary-column sorting.
