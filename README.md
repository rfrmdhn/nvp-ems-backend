# EMS Backend

Employee Management System backend for PT Nusantara Digital — a technical-test project. NestJS +
TypeScript + Prisma + PostgreSQL, JWT auth, BullMQ/Redis job queue, Server-Sent Events for
realtime notifications, and streamed CSV bulk import.

See [`EMS-BACKEND-PLAN.md`](./EMS-BACKEND-PLAN.md) for the full design and
[`CLAUDE.md`](./CLAUDE.md) for contributor/agent instructions and non-negotiable rules.

## Prerequisites

- **Docker Desktop** (Mac/Windows) or **Docker Engine + the Compose plugin** (Linux) — either
  way, the command is the same: `docker compose ...` (not the legacy standalone
  `docker-compose` binary).
- **Podman also works** — `docker-compose.yml` is plain Compose-spec YAML (no Docker-engine-
  specific features, no `docker.sock` mount), and the `Dockerfile` is a standard multi-stage
  build Buildah/Podman builds natively. Substitute `podman compose up --build` (Podman ≥4.7's
  built-in compose) or `podman-compose up --build` (the separate Python tool, ≥1.0.6) for every
  `docker compose ...` command below. Use a recent version — older `podman-compose` releases
  don't always honor the `depends_on: condition: service_completed_successfully` gate the
  one-shot `migrate` service relies on; if your version doesn't, run `podman compose run --rm
  migrate` once by hand before `podman compose up api worker` (the seed is idempotent, so
  running `migrate` twice is harmless).
- Node.js 20+ and npm, only if you want to run things outside Docker (e.g. `npm test` locally).

## Quick start (one command)

```bash
cd backend
docker compose up --build
```

This single command:
1. Builds the app image (multi-stage: install deps → compile TypeScript → slim runtime).
2. Starts Postgres 16 and Redis 7, waiting for both healthchecks.
3. Runs a one-shot `migrate` service: applies Prisma migrations, then runs the idempotent admin
   seed (safe to re-run — it upserts on the admin's unique email).
4. Starts the `api` (HTTP, port `3000` by default) and `worker` (BullMQ job processor, no HTTP
   port) containers.

No manual steps — no `.env` file is even required, every variable has an inline default in
`docker-compose.yml` matching `.env.example`. To customize (e.g. a real `JWT_SECRET`), copy
`.env.example` to `.env` in this directory before running `docker compose up`.

Once it's up:
- API: `http://localhost:3000`
- Swagger docs: `http://localhost:3000/api/docs`
- Seeded admin login: `admin@nusantaradigital.test` / `ChangeMe123!` (or whatever `ADMIN_EMAIL`/
  `ADMIN_PASSWORD` you set in `.env`)

To stop: `docker compose down` (add `-v` to also drop the named Postgres volume and start fresh).

## Environment variables

All variables live in `.env.example` (copy to `.env` to override defaults). Full reference:

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_USER` | `ems` | |
| `POSTGRES_PASSWORD` | `ems_password` | Change for anything beyond local/demo use. |
| `POSTGRES_DB` | `ems` | |
| `DATABASE_URL` | `postgresql://ems:ems_password@postgres:5432/ems?schema=public` | Inside `docker compose`, host is the `postgres` service name. Running the API directly on the host, use `localhost` instead. |
| `REDIS_HOST` | `redis` | Same host-vs-service-name note as above. |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | *(empty)* | |
| `JWT_SECRET` | placeholder string | **Change this** for anything beyond local/demo use. |
| `JWT_EXPIRES_IN` | `1h` | Any `ms`-style string (`15m`, `2h`, `7d`, ...). |
| `ADMIN_EMAIL` | `admin@nusantaradigital.test` | Seeded admin's login email. |
| `ADMIN_PASSWORD` | `ChangeMe123!` | Seeded admin's login password — example only, change it. |
| `PORT` | `3000` | API's HTTP port. |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separate multiple frontend origins if needed. |

## Running tests

```bash
npm install       # once, if not using Docker for this
npm run lint        # eslint --fix
npm test            # jest unit tests (login, employees CRUD, queue handler) — no DB/Redis needed
npm run build       # nest build (tsc)
```

Unit tests mock `PrismaService`/`NotificationsService`/BullMQ producers directly, so `npm test`
needs no live Postgres or Redis connection. See `docs/superpowers/tests/` for what's covered per
feature and what's intentionally deferred.

### Full API test suite (smoke/functional/contract/integration/regression/load/stress/security/fuzz)

Everything below is a **black-box** test — it hits a real, running instance over HTTP, so start
the stack first:

```bash
docker compose up --build -d
```

Then, from this directory:

```bash
npm run test:e2e       # smoke, functional, contract, integration, security, fuzz — test/api/*.e2e-spec.ts
npm run test:postman   # the Postman collection (postman/EMS.postman_collection.json) via Newman
npm run test:load       # k6 load test (steady 20 VUs / 1 min) — needs Docker, pulls grafana/k6 once
npm run test:stress     # k6 stress test (ramps 10 -> 300 VUs over ~3 min)
./test/load/csv-memory-profile.sh   # samples worker RSS during a large CSV import
```

Notes:

- `test:e2e` targets `http://localhost:3000` by default; override with `API_BASE_URL` (and
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` if you changed the seeded admin) if your stack runs elsewhere.
- `test:load`/`test:stress` run k6 via the official `grafana/k6` Docker image over
  `--network host`, rather than requiring a native `k6` install.
- `test:postman` deliberately excludes the collection's "Notifications" folder — an SSE stream
  request has no natural end, so it isn't a good fit for an unattended Newman run (same reason the
  collection's own description recommends `curl -N` for manually testing that one). The SSE path
  is covered instead by `test/api/integration-workflow.e2e-spec.ts`.
- Every test in `test/api/` creates and deletes its own employees (see each spec's
  `beforeAll`/`afterAll`), but `test:postman`/`test:load`/`test:stress`/the memory-profile script
  do leave rows behind (Postman's happy-path Create/Delete pair cleans itself up, but its CSV
  upload and k6's traffic do not) — `docker compose down -v && docker compose up --build -d` gives
  you a clean seeded database again if that matters for what you're doing next.
- Results from an actual run of all of the above — latency numbers, the stress test's observed
  breaking point (or lack of one), and every finding — are in
  [`API_Test_Report.md`](./API_Test_Report.md).

## API docs & Postman

- **Swagger** (interactive, generated from the running app): `GET /api/docs` once the API is up.
- **Postman collection**: [`postman/EMS.postman_collection.json`](./postman/EMS.postman_collection.json)
  — import into Postman, set `{{baseUrl}}` (defaults to `http://localhost:3000`), run "Login"
  first to auto-populate `{{token}}` for the guarded requests. Includes a "Security & Negative
  Tests" folder (401/400/mass-assignment/injection-shaped-input checks) alongside the happy-path
  requests; runnable unattended via `npm run test:postman` (Newman) — see "Running tests" above.

## CSV import test data

- `scripts/sample-employees.csv` — ~20 realistic rows for a quick manual test.
- `scripts/invalid-employees.csv` — 1 valid row + 4 deliberately broken ones (blank name,
  non-numeric age, non-numeric salary, negative salary), for exercising skip-and-collect. Shared
  with the frontend's own e2e fixture (`../frontend/e2e/fixtures/invalid-employees.csv`, kept
  byte-identical) so both sides of the stack test against the same malformed input. Used by
  `test/api/fuzz.e2e-spec.ts`'s "semantically-invalid-but-same-column-count rows" case.
- `scripts/sample-employees-large.csv` — 20,000 rows, committed to the repo so the bulk-import
  path can be exercised at the brief's minimum scale without generating a file first. Verified
  end-to-end via `docker compose up --build`: uploads in ~20ms (202 Accepted, non-blocking),
  worker stream-parses + batch-inserts (500 rows/batch) all 20,000 rows in under a second, and
  `GET /csv-import/:jobId/status` plus the `csv-import.progress`/`.completed` SSE events reflect
  real progress throughout.
- `scripts/generate-large-csv.mjs` — generates a large CSV (defaults to 25,000 rows) for testing
  the bulk-import path at an even bigger scale:
  ```bash
  node scripts/generate-large-csv.mjs            # 25000 rows -> scripts/generated-employees.csv
  node scripts/generate-large-csv.mjs 100000      # custom row count
  node scripts/generate-large-csv.mjs 100000 /tmp/big.csv   # custom row count + output path
  ```

The CSV upload endpoint, streaming parse, batched `createMany` insert, and progress reporting
(polling + SSE) are all real and implemented — see `src/csv-import/` and
`src/queue/processors/csv-import.processor.ts`.

**Important (Docker/multi-container deployments only):** the `api` and `worker` services run as
separate containers and must share the same `/app/uploads` directory — `api` writes the uploaded
file there via Multer, and `worker` reads it back to stream-parse. Both `docker-compose.yml` (this
repo) and the root-level convenience compose file mount a shared named volume
(`csv_uploads`/`ems_csv_uploads`) at `/app/uploads` in both services for this reason. If you add a
new deployment target (e.g. Kubernetes, separate hosts per service), you must provision an
equivalent shared filesystem for `/app/uploads` — otherwise every CSV import job fails with
"Uploaded file is missing or unreadable" once the worker tries to read a file only the api
container's local filesystem has.

## How the frontend should connect

- Point the frontend at this API's base URL via its own `VITE_API_URL` (or equivalent) env var,
  e.g. `VITE_API_URL=http://localhost:3000`.
- `POST /auth/login` → `{ accessToken, expiresIn }`; send `Authorization: Bearer <accessToken>`
  on every `/employees` and `/csv-import` request.
- Open an `EventSource` against `GET /notifications/stream` (no auth required in this phase — see
  `docs/superpowers/AUDIT.md` #4) to receive `employee.created` / `csv-import.completed` events
  live.
- Set `CORS_ORIGIN` (backend env var) to match wherever the frontend dev server actually runs
  (default assumes Vite's `http://localhost:5173`).

## Project structure

See `CLAUDE.md`'s structure diagram and `docs/superpowers/KNOWLEDGE-MAP.md` for the full
per-feature file layout.
