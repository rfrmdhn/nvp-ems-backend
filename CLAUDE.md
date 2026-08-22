# EMS Backend — Claude Code Instructions

## Docs to Read First

Before any change, read in this order:
1. `EMS-BACKEND-PLAN.md` — the single source of truth for design/architecture/phases.
2. `docs/superpowers/AGENTS.md` — index into the plan-grounded harness below.
3. `docs/superpowers/AUDIT.md` — open decisions/ambiguities that must be resolved before
   touching the relevant area.
4. `docs/superpowers/plans/<feature>.md`, `docs/superpowers/specs/<feature>.md`,
   `docs/superpowers/tests/<feature>.md` — for the specific feature you're about to touch.

**Harness through CSV Import (§13 phases 1, 3, 5) are done** — NestJS + TypeScript, Prisma schema
+ initial migration, Docker (Postgres/Redis/migrate/api/worker), auth (real, login + JWT guard),
employees CRUD with server-side pagination/search/sort (real, Prisma-backed — see
`docs/superpowers/specs/employees.md`), the employee-created queue → SSE notification path (real,
full end-to-end), and csv-import (upload, enqueue, **real streaming-parse + batched
`createMany`**, byte-based progress over both `job.updateProgress` and SSE, status endpoint) are
all in place. `npm run build`/`lint`/`test` all pass. Read `docs/superpowers/plans/csv-import.md`
before touching `src/queue/processors/csv-import.processor.ts` or `src/csv-import/`.

## Key Rules (non-negotiable, §-references into EMS-BACKEND-PLAN.md)

- Every Employees and CSV-import route is behind `JwtAuthGuard`, applied at the
  controller-class level (not per-method) so a newly added route can never ship unguarded (§4,
  §5).
- Passwords are always bcrypt-hashed — never stored or compared in plaintext (§4).
- CSV files must always be stream-parsed (`csv-parse`'s streaming API via a
  `fs.createReadStream`) — never buffered fully into RAM, at either the Multer upload layer
  (`diskStorage`, never `memoryStorage`) or the worker's parse layer (§8).
- CSV inserts must be batched/chunked inside the worker (`prisma.employee.createMany` per
  batch) — never row-by-row (§8).
- Employee creation must always go through the BullMQ `employee-created` job — never a
  synchronous fake notification call (§6.1).
- Never trust a client-supplied employee `id` on update/delete — `UpdateEmployeeDto` never
  carries an `id` field; the validated `:id` route param (via `ParseUUIDPipe`) is the only
  source of truth for which row gets mutated (§5).
- The seed script (`prisma/seed.ts`) must stay idempotent — `upsert` on the admin's unique
  email, never plain `create` (§10).
- **`docker-compose.yml` is the single source of truth for local setup and must always be kept
  up to date** — `docker compose up --build` must always fully provision the stack (migrated +
  seeded) with zero manual steps. Any change affecting startup — a new env var, a new service, a
  new migration — must update `docker-compose.yml` in the same change (§10).
- Keep `docker-compose.yml` and the `Dockerfile` **engine-neutral** — no Docker-specific features
  (no `docker.sock` mounts, no BuildKit-only syntax) — so `podman compose`/`podman-compose` keeps
  working as a drop-in substitute for `docker compose` (verified — see README's Prerequisites).

## Stack

NestJS · TypeScript · Prisma ORM · PostgreSQL 16 · BullMQ · Redis 7 · Server-Sent Events
(`@Sse()`) · Passport JWT · bcrypt · class-validator · Multer (disk storage) · csv-parse
(streaming) · Swagger · Jest · Docker Compose.

## Test / Build

```bash
npm run build                # nest build (tsc) — passes
npm run lint                  # eslint --fix — passes
npm test                      # jest unit tests — passes, no DB/Redis needed (mocked deps)
npm run test:cov              # jest with coverage
npm run test:e2e              # test/app.e2e-spec.ts — needs a real app bootstrap
npm run prisma:migrate:dev    # after editing prisma/schema.prisma (needs a live Postgres)
npm run prisma:migrate:deploy # apply pending migrations (what the `migrate` compose service runs)
npm run prisma:seed           # idempotent admin upsert
npm run start:dev             # API process, watch mode
npm run start:worker          # worker process, watch mode
docker compose up --build     # full stack — see README.md Quick Start
```

Copy `.env.example` to `.env` before running anything against a real database — though every
docker-compose variable already has an inline default, so `docker compose up --build` works even
without a `.env` file.

## Testing Strategy

The brief's own scope is narrow: "minimal unit tests: login, CRUD employee, queue handler." This
is the required baseline, implemented as three Jest suites
(`src/auth/auth.service.spec.ts`, `src/employees/employees.service.spec.ts`,
`src/queue/processors/employee-created.processor.spec.ts` — see `docs/superpowers/tests/` for
what each covers and what's deliberately deferred), plus a fourth added once CSV import shipped
real logic (`src/queue/processors/csv-import.processor.spec.ts` — batching, skip-and-collect,
progress). Unit + this scope of integration (each test exercises a service/processor with a
mocked Prisma/Redis layer, not a live DB) is the floor for this project — do not skip it for a
new feature.

On top of that floor, a full 9-type black-box API test pass (smoke, functional, contract,
integration, regression, load, stress, security, fuzz) has since been implemented against a
running `docker compose` stack — see `API_Test_Report.md` for results, findings, and severity, and
run it yourself:

```bash
docker compose up --build -d          # stack must be running for every suite below
npm run test:e2e                       # smoke/functional/contract/integration/security/fuzz — test/api/*.e2e-spec.ts
npm run test:postman                   # Postman collection via Newman (Auth/Employees/CSV Import/Security folders)
npm run test:load                      # k6, steady 20 VUs / 1 min — needs Docker (grafana/k6 image)
npm run test:stress                    # k6, ramps 10->300 VUs over ~3 min
./test/load/csv-memory-profile.sh      # worker RSS while importing a large CSV
```

- **Smoke** — `test/api/smoke.e2e-spec.ts` (GET /, login, Swagger reachability, unknown-route 404).
- **Contract** — `test/api/contract.e2e-spec.ts` validates real responses against the app's own
  live-generated OpenAPI doc (`/api/docs-json`) via `ajv`. This surfaced a real gap (no response
  schema was documented for Employees/CSV-import routes at all, and `salary` needed documenting as
  a string) — fixed via `src/employees/dto/employee-response.dto.ts` and
  `src/csv-import/dto/csv-import-response.dto.ts`, wired up with `@ApiResponse({ type: ... })`.
- **Integration** — `test/api/integration-workflow.e2e-spec.ts`: login → create employee → SSE
  `employee.created` received → CSV import → poll to completion → `GET /employees` reflects both.
- **Regression** — there was no prior baseline; this pass establishes one (the full suite below +
  the OpenAPI snapshot the contract test validates against).
- **Load / stress** — `test/load/{load,stress}.js` (k6, via the `grafana/k6` Docker image) plus
  `test/load/csv-memory-profile.sh` for the CSV-import memory claim specifically.
- **Security** — `test/api/security.e2e-spec.ts`: 401 on every guarded route without/with a
  tampered/`alg:none` JWT, mass-assignment (`400` on a client-supplied `id` or unknown field),
  injection-shaped `search` values treated as literal data.
- **Fuzz** — `test/api/fuzz.e2e-spec.ts`: malformed JSON, wrong types, huge strings, CSV
  structural/semantic malformation. Found two real gaps (unbounded name/position length; a
  wrong-column-count CSV row failing the whole job instead of skip-and-collect) — both documented
  as open findings in `API_Test_Report.md`, not fixed in this pass.

## Environments

Single environment for this technical test — local Docker Compose, no staging/production split.
`.github/workflows/ci.yml` runs lint/test/build on every push and PR using placeholder env vars
(unit tests mock Prisma/Redis, so no live database is needed for CI to pass).

## Structure

```
src/
├── main.ts              ← API process bootstrap (HTTP, Swagger, ValidationPipe, CORS)
├── worker.ts             ← worker process bootstrap (no HTTP listener)
├── app.module.ts          ← shared root module for both entry points
├── config/                ← ConfigModule + Joi env validation
├── prisma/                ← global PrismaService/PrismaModule
├── auth/                  ← login, JWT strategy/guard, DTOs
├── employees/             ← CRUD, guarded by JwtAuthGuard
├── queue/
│   └── processors/        ← employee-created (full), csv-import (full)
├── notifications/         ← SSE endpoint + Redis pub-sub bridge
├── csv-import/            ← upload endpoint + status endpoint (full)
└── common/                ← guards/filters/decorators
prisma/
├── schema.prisma
├── migrations/
└── seed.ts                ← idempotent admin upsert
docs/superpowers/           ← AGENTS/AUDIT/ASSUMPTIONS_MADE/KNOWLEDGE-MAP/FEATURE-IDEAS + plans/specs/tests per feature
scripts/                     ← CSV generator + sample data
postman/                     ← Postman collection
```

## Development Phases (§13)

Harness (done) → Auth (done) → Employees CRUD incl. server-side pagination/search/sort (done) →
Queue/Notifications (done — employee-created path is fully real) → CSV Import (done — real
streaming parse + batched insert + progress) → Unit Tests (done for CSV import) → Docs/Postman
(specs/plans updated for the real CSV-import and `GET /employees` contracts; Postman collection
itself not re-exported in this pass).
