# EMS Backend — API Test Report

**Target**: EMS Backend (NestJS + Prisma/PostgreSQL + BullMQ/Redis), run locally via
`docker compose up --build` — `http://localhost:3000`, Swagger at `/api/docs`.
**Scope**: backend API only, local environment only (no external/staging target).
**Auth**: seeded admin `admin@nusantaradigital.test` / `ChangeMe123!` via `POST /auth/login`.
**Date of this run**: 2026-08-22/23. **Environment**: single Docker Compose stack
(Postgres 16, Redis 7, `api` + `worker` containers), reset to a clean seeded state
(`docker compose down -v && up --build -d`) before the final verification pass below.

This is the first pass of this scope of testing for this project — `docs/superpowers/tests/*.md`
and root `CLAUDE.md` already listed all nine test types below as **deliberately deferred, not
silently omitted**. This report is that deferred work landing, plus what it found.

How to reproduce everything in this report: see `README.md`'s "Full API test suite" section.

---

## 1. Summary

| Test type | Tool | Result |
|---|---|---|
| Smoke | Jest + supertest (`test/api/smoke.e2e-spec.ts`) | ✅ 4/4 pass |
| Functional | Jest + supertest (`test/api/functional-*.e2e-spec.ts`) | ✅ 46/46 pass |
| Contract | Jest + supertest + `ajv` (`test/api/contract.e2e-spec.ts`) | ✅ 6/6 pass (after fixing the gap below) |
| Integration | Jest + supertest + native `fetch`/SSE (`test/api/integration-workflow.e2e-spec.ts`) | ✅ 1/1 pass |
| Regression | Jest unit suite + full black-box suite (this pass **establishes** the baseline — see §7) | ✅ 21 unit + 78 black-box, all pass |
| Load | k6 via `grafana/k6` (`test/load/load.js`) | ✅ p95 15.76ms, 0% errors, well under target SLA |
| Stress | k6 via `grafana/k6` (`test/load/stress.js`) | ✅ no breaking point found up to 300 VUs — see §5 |
| Security | Jest + supertest (`test/api/security.e2e-spec.ts`) | ✅ 24/24 pass — no vulnerabilities found |
| Fuzz | Jest + supertest (`test/api/fuzz.e2e-spec.ts`) | ✅ 17/17 pass — **2 real gaps found**, see §6 |

**Totals**: 78/78 new black-box tests pass, 21/21 pre-existing unit tests still pass, 15/15
Postman requests (9/9 assertions) pass via Newman. `npm run lint` / `npm run build` are clean.

**Bottom line**: no security vulnerability was found (access control, JWT handling, injection,
mass assignment all hold up under active testing). Two genuine functional/validation gaps were
found by fuzz testing (§6) and are **not fixed in this pass** — they're recommendations. One
contract gap (undocumented response schemas, plus a wire-format subtlety) **was** fixed, since
"make the spec accurate" was explicitly in scope.

---

## 2. Smoke testing

`test/api/smoke.e2e-spec.ts`: `GET /` → `200 {"status":"ok","service":"ems-backend"}`,
`POST /auth/login` with seeded creds → `200` + a JWT, `GET /api/docs` reachable, an unknown route
→ `404` (never a `5xx`). All pass.

## 3. Functional testing

`test/api/functional-auth.e2e-spec.ts`, `functional-employees.e2e-spec.ts`,
`functional-csv-import.e2e-spec.ts` — full CRUD lifecycle for `/employees` (create/read/update/
delete, pagination/search/sort per `docs/superpowers/specs/employees.md`'s table), full
`/auth/login` success/failure matrix, and `/csv-import` upload → poll → `completed` with
`imported: 20`. 46/46 pass. Every employee these suites create is deleted again in `afterAll`.

## 4. Contract testing

`test/api/contract.e2e-spec.ts` fetches the app's own live-generated OpenAPI document
(`GET /api/docs-json`) and validates real responses against it with `ajv` — not a hand-maintained
copy, so it only stays green if the code's decorators actually describe reality.

**Finding (fixed in this pass)**: before this pass, `/employees` and `/csv-import` routes had
**no response schema documented in Swagger at all** (`responses: { "201": { "description": "" } }`,
no `content`/`schema`) — verified by hitting `/api/docs-json` directly. Separately, `salary` is a
Prisma `Decimal` with no custom JSON serializer, so it round-trips as a **string**
(e.g. `"12000000"`), not a `number` — confirmed against the Postman collection's own captured
example response.

**Fix applied**: added `EmployeeResponseDto`/`PaginatedEmployeesResponseDto`
(`src/employees/dto/employee-response.dto.ts`) and `CsvUploadResponseDto`/
`CsvImportStatusResponseDto` (`src/csv-import/dto/csv-import-response.dto.ts`), wired up via
`@ApiResponse({ type: ... })` on every route in both controllers, with `salary` explicitly typed
and documented as a string. Re-verified live: `/api/docs-json` now documents
`EmployeeResponseDto.salary` as `{"type": "string", ...}`, and `contract.e2e-spec.ts`'s explicit
`typeof res.body.salary === 'string'` assertion passes. Also patched
`docs/superpowers/specs/employees.md` with an explicit wire-format note.

## 5. Load & stress testing

Both run via the official `grafana/k6` Docker image (no native `k6` install required) against
`GET /employees` (read-heavy hot path) and `POST /employees` (write path, enqueues a BullMQ job)
— the two realistic traffic shapes this API has. SLA targets are this report's own definition
(there was no pre-existing SLA to inherit): **p95 < 300ms, error rate < 1%**.

### Load (`test/load/load.js`) — 20 constant VUs, 1 minute

```
http_req_duration: p(95)=15.76ms   ✓ (threshold: p(95)<300ms)
http_req_failed:   0.00%           ✓ (threshold: rate<1%)
1435 requests, 1200 iterations, 0 failed checks
```

Comfortably inside the SLA — roughly **19x** better than the p95 target, zero errors.

### Stress (`test/load/stress.js`) — ramp 10 → 300 VUs over 3 minutes

```
Stage:        10 VUs → 50 → 100 → 200 → 300 → 0, 30s per step
http_req_duration: avg=62.41ms  p90=179.53ms  p95=206.08ms  max=484.5ms
http_req_failed:   0.00% (0 of 41,621 requests)
41,621 total requests, 34,749 iterations, 300 peak VUs, 231 req/s peak
```

**No breaking point was found within the tested range.** Latency degrades gracefully (p95 rises
from ~16ms at 20 VUs to ~206ms at 300 VUs) but the error rate stayed at **0.00%** throughout —
there's no rate limiter or connection-pool guard that would produce a clean `429`/`503`, and
Postgres/Prisma's connection pool absorbed 300 concurrent VUs without saturating.
**Recommendation**: re-run with a higher ceiling (600–1000+ VUs) to find the actual limit; not
pursued further in this pass; the working assumption is Prisma's Postgres connection pool would
be the first thing to saturate, but that wasn't reached here.

**Side effect worth flagging**: the stress run's ~7,000 `POST /employees` calls each enqueue an
`employee-created` BullMQ job, and `EmployeeCreatedProcessor` has a deliberate
`await this.delay(300)` per job ("makes the async nature visible in a demo" — its own comment) at
the default BullMQ concurrency of 1 (no `concurrency` option set on `@Processor`). Right after the
stress run, Redis showed **~4,000 backlogged `employee-created` jobs** — at 300ms/job serially,
that's ~20 minutes to drain. This is intentional demo behavior, not a bug, but it means
`employee.created` SSE notifications can lag by minutes under sustained write load — worth
knowing if this queue is ever used somewhere latency-sensitive. (This is also, concretely, why the
integration test intermittently timed out waiting for its SSE event immediately after the stress
run — resolved by resetting the stack, not by changing the test or the code.)

### CSV import memory profile (`test/load/csv-memory-profile.sh`)

Samples the `worker` container's RSS via `docker stats` during a large import — empirical check of
EMS-BACKEND-PLAN.md §8's "never buffer the whole file" claim (item 6 in
`docs/superpowers/tests/csv-import.md`'s deferred list).

| Rows | File size | Import time | Worker RSS |
|---|---|---|---|
| 25,000 | 1,015,060 bytes | ~1.2s | 66.71 MiB → 65.82 MiB (flat) |
| 100,000 | 4,056,170 bytes | ~3.2s | 66.48 MiB → 65.02 MiB (flat) |

A 4x increase in row count produced no measurable increase in worker memory — confirms the
streaming-parse + batched-insert design is doing what it claims, empirically, not just by code
inspection.

## 6. Security testing

`test/api/security.e2e-spec.ts`, 24/24 pass. **No vulnerabilities found.**

- **Access control**: every guarded route (`/employees*`, `/csv-import*`,
  `/notifications/stream`) returns `401` with no token and with a garbage token. Confirmed for
  every method (GET/POST/PUT/DELETE), not just spot-checked.
- **JWT tampering**: a flipped signature byte, an `alg: none` unsigned token, and a
  well-formed-but-wrong-signature token all → `401`. `passport-jwt`/`jsonwebtoken` correctly
  reject the classic "none" algorithm downgrade attack.
- **Mass assignment**: a client-supplied `id` or any unknown extra field on
  `POST /employees` → `400` (`ValidationPipe({ forbidNonWhitelisted: true })` genuinely enforced
  at the HTTP layer, not just true by code inspection).
- **Injection**: a SQL-injection-shaped `search` value (`' OR 1=1; DROP TABLE employees;--`) and a
  NoSQL-operator-shaped one (`{"$ne": null}`) are both treated as literal substrings — Prisma's
  parameterization holds up empirically. A `<script>...</script>` employee name is stored and
  returned verbatim as an inert JSON string (this is a JSON API with no HTML rendering surface on
  the backend, so this isn't XSS-exploitable server-side; relevant if a frontend ever renders it
  unescaped — out of scope here, backend-only).
- **Error responses never leak internals**: confirmed across every error case exercised in this
  pass (see §8) — `AllExceptionsFilter` consistently returns the generic
  `{statusCode, timestamp, path, message}` shape with no stack trace or driver error text, even
  for unhandled `PrismaClientUnknownRequestError`s.
- **IDOR — not applicable**: this is a single-admin, single-tenant system
  (`docs/superpowers/AUDIT.md` #1) with no user-scoped resources, so there's no ownership boundary
  to cross. Recorded explicitly rather than silently skipped.

**Recommendation (not tested with an actual brute-force run, from code inspection only)**:
`POST /auth/login` has no rate limiting / attempt throttling (no `@Throttle` or equivalent). Low
urgency for a local technical test with one seeded account, but worth adding
(`@nestjs/throttler`) before this pattern goes anywhere real.

## 7. Regression testing

There was no prior baseline for this scope — `npm test` (21 unit tests) already existed and still
passes unchanged. This pass's job was to **establish** the baseline going forward: the full suite
(21 unit + 78 black-box + 15 Postman requests) is now the regression gate, and
`contract.e2e-spec.ts`'s live-OpenAPI-doc validation is what a future breaking change would surface
first (a renamed/retyped/removed field fails that suite before anything else).

## 8. Fuzz testing

`test/api/fuzz.e2e-spec.ts`, 17/17 pass — including two tests that pin down **real, reproducible
gaps** by asserting their current (not ideal) behavior, explicitly labeled `FINDING:`. Both were
reproduced directly against the running API (not just observed as test artifacts) and are
**not fixed in this pass** — recommendations only, since fixing app validation logic wasn't in
this pass's approved scope (the contract-doc fix in §4 was).

### FINDING A (High) — a wrong-column-count CSV row fails the entire import job

**Reproduction**: upload a CSV where one row has fewer/more columns than the header (e.g. `name,
age, position, salary` header, a row with only 2 values). `POST /csv-import/upload` still returns
`202`, but the job ends in `state: "failed"` with
`errors: ["Invalid Record Length: columns length is 4, got 2 on line 3"]` — rows before the bad
line that already flushed stay imported, but nothing after it is processed, and the client sees a
hard failure, not a partial success.

**Root cause**: `csv-import.processor.ts` streams rows via `for await (const rawRow of parser)`
where `parser` is `csv-parse` with `columns: true` (default `relax_column_count: false`).
`csv-parse` itself throws on a column-count mismatch — this happens *before* the row ever reaches
`validateRow()`, so the processor's "skip-and-collect" logic (which handles semantically-invalid
rows like a bad age or negative salary just fine — verified by a separate passing test in this
same suite) never gets a chance to run. The outer `try/catch` treats this parser-level throw as
fatal, matching `unlink`+`notifyCsvImportFailed`+`throw` — i.e. the whole-job-fails path.

**Why this matters**: `docs/superpowers/AUDIT.md` #3 documents skip-and-collect as the *resolved*
behavior for "invalid-row handling during CSV import" specifically to avoid one bad row failing an
entire 20,000+ row import. A wrong-column-count row (a very plausible real-world CSV error — a
stray comma, a truncated export) defeats that resolution entirely.

**Recommended fix**: pass `relax_column_count: true` to `csv-parse`'s `parse()` options, then add
an explicit column-count check inside `validateRow()` (or immediately before it) so a
wrong-column-count row becomes a normal skipped/collected row like any other, instead of a parser
exception.

### FINDING B (Medium) — a NUL byte (`\x00`) in `name` causes a `500`, not a `400`

**Reproduction**: `POST /employees` with `name` containing a `\x00` byte → `500`
`{"statusCode":500,...,"message":"Internal server error"}`. Server-side log:
`PrismaClientUnknownRequestError: ... PostgresError { code: "22021", message: "invalid byte
sequence for encoding \"UTF8\": 0x00" }`.

**Root cause**: `class-validator`'s `@IsString()` accepts any string, NUL byte included, so it
passes DTO validation and reaches Postgres, which rejects it at the encoding level. The exception
is an uncaught `PrismaClientUnknownRequestError`, not an `HttpException`, so
`AllExceptionsFilter` correctly falls back to a generic `500` — no leak, but the wrong status for
what's fundamentally a bad-input case.

**Recommended fix**: either a custom `class-validator` decorator rejecting control characters in
`name`/`position`, or a `class-transformer` `@Transform` that strips them before validation.

### FINDING C (Medium, same shape as B) — a salary beyond the `Decimal(14,2)` range causes a `500`, not a `400`

**Reproduction**: `POST /employees` with `salary: 1e30` → `500`, same generic shape.
Server-side: `PostgresError { code: "22003", message: "numeric field overflow", detail: "A field
with precision 14, scale 2 must round to an absolute value less than 10^12." }`.

**Root cause**: `CreateEmployeeDto.salary` has `@Min(0)` but no upper bound matching the Prisma
column's `@db.Decimal(14, 2)` (max ~10^12). Same "reaches Postgres, not the DTO" shape as
Finding B.

**Recommended fix**: add `@Max(999_999_999_999.99)` (or equivalent) to `CreateEmployeeDto.salary`
and `UpdateEmployeeDto` inherits it via `PartialType`.

### FINDING D (Low) — no upper bound on `name`/`position` length

**Reproduction**: a 100,000-character `name` is accepted (`201`) — `CreateEmployeeDto` has no
`@MaxLength`, and the Prisma column is unbounded `TEXT`. Not an error today, but an unbounded
storage/oversized-payload vector. **Recommended fix**: `@MaxLength(255)` (or whatever the real
business limit is) on `name`/`position`.

### Everything else in this suite passed cleanly

Malformed JSON body, wrong content-type, empty body, wrong types on every field (string where
number expected, etc.), negative age/salary, `NaN`/`Infinity`, arrays/objects where a scalar is
expected, deep Unicode/emoji/RTL names (echoed back byte-for-byte correctly), an empty `.csv`, a
header-only `.csv` (`imported: 0`, no crash), semantically-invalid-but-same-column-count CSV rows
(skip-and-collect genuinely works for these), binary garbage with a `.csv` extension, and a double
extension (`.csv.exe`, rejected by the file filter) — all handled gracefully, all in the standard
error shape, never a leaked stack trace.

**One low-confidence, unconfirmed observation, not counted as a finding**: while iterating on the
CSV fuzz tests under rapid back-to-back requests, a single instance of `GET
/csv-import/:jobId/status` returning `state: "completed"` with `imported`/`skipped`/`errors`
still `undefined` was seen once. It was not reproducible in 20+ follow-up attempts (both manual
`curl` loops and repeated test runs), so this is recorded as a "watch for it" item, not a
confirmed bug — `fuzz.e2e-spec.ts`'s status-poll helper tolerates one extra poll past
`state: "completed"` before treating a missing summary as a hard failure, specifically so this
doesn't make the suite flaky if it recurs.

## 9. Integration testing

`test/api/integration-workflow.e2e-spec.ts`: login → open the SSE stream → create an employee →
receive the matching `employee.created` SSE event → CSV upload → poll to `completed` → confirm
`GET /employees` reflects both the single create and all 20 CSV rows. Passes cleanly on a stack
that isn't backlogged (see §5's stress-test side effect for the one environmental case where this
timed out, and why).

---

## Open findings & recommendations (not fixed in this pass)

| # | Severity | Area | Issue | Fix |
|---|---|---|---|---|
| A | High | CSV import | Wrong-column-count row fails the whole job, not skip-and-collect | `relax_column_count: true` + explicit column check |
| B | Medium | Employees validation | NUL byte in `name` → `500` not `400` | Reject/strip control chars before validation |
| C | Medium | Employees validation | Salary beyond `Decimal(14,2)` → `500` not `400` | `@Max` on `CreateEmployeeDto.salary` |
| D | Low | Employees validation | No max length on `name`/`position` | `@MaxLength` |
| E | Low | Auth | No rate limiting on `POST /auth/login` (code-inspection only, not brute-force-tested) | `@nestjs/throttler` |
| F | Info | Load/stress | Stress-level create traffic backlogs `employee-created` notifications by minutes (300ms/job demo delay × concurrency 1) | Raise `@Processor` concurrency, or drop/shrink the demo delay, if realtime-under-load ever matters |
| G | Info | Stress test | No breaking point found up to 300 VUs | Re-run with a higher VU ceiling |

Fixed in this pass: the contract gap in §4 (undocumented response schemas; `salary`-as-string now
explicit).

## What changed in this pass

- **New tests**: `test/api/{smoke,functional-auth,functional-employees,functional-csv-import,
  contract,integration-workflow,security,fuzz}.e2e-spec.ts`, `test/api/helpers/client.ts`,
  `test/load/{load,stress}.js`, `test/load/csv-memory-profile.sh`.
- **Source changes**: `src/employees/dto/employee-response.dto.ts` (new),
  `src/csv-import/dto/csv-import-response.dto.ts` (new), `@ApiResponse` annotations on
  `EmployeesController`/`CsvImportController` — contract-doc fix only, no behavior change.
- **Postman**: fixed `Upload CSV`'s `formdata.src` so it works unattended under Newman; added a
  "Security & Negative Tests" folder (7 requests, 9 assertions).
- **Config**: `package.json` — `newman`/`ajv` devDependencies, `test:postman`/`test:load`/
  `test:stress` scripts; `eslint.config.mjs` — relaxed `no-unsafe-*` for `test/api/**` only (these
  specs assert on supertest's untyped `Response.body`, i.e. real JSON from a live server — the
  actual point of a black-box test).
- **Docs**: `docs/superpowers/specs/employees.md` (salary wire format), `docs/superpowers/tests/
  {employees,csv-import}.md` (marked deferred items done, linked findings), `CLAUDE.md` (Testing
  Strategy section rewritten to point at this report and how to run everything), `README.md`
  ("Running tests" section expanded).
