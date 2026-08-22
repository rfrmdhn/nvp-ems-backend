# AGENTS.md — EMS Backend / docs/superpowers

Context document for AI agents working on the EMS backend. This folder is a **plan-grounded**
companion to `../../EMS-BACKEND-PLAN.md` (the single source of truth) and to the root `CLAUDE.md`.
Read those first; this folder adds per-feature detail, open-decision tracking, and a
test-coverage target on top.

This harness was originally written during the Harness phase (repo scaffold), before the
CSV-import streaming/batch-insert logic existed; csv-import's plan/spec/test docs have since been
updated to describe the real, implemented behavior (§8). Every document here cites a `§<n>`
section number from `EMS-BACKEND-PLAN.md` alongside real file paths.

## Product overview

EMS backend is a NestJS + TypeScript + Prisma + PostgreSQL API for PT Nusantara Digital's
Employee Management System: one seeded admin logs in with email+password, gets a JWT, and can
CRUD an Employee roster. Employee creation (single or via CSV) goes through a BullMQ/Redis queue;
a worker processes jobs and pushes realtime notifications to the frontend over Server-Sent Events.
See `EMS-BACKEND-PLAN.md` §1-§2 for the full overview and stack rationale.

Source layout (see root `CLAUDE.md`'s structure diagram for the full tree):

```
src/
├── auth/            ← login, JWT strategy/guard
├── employees/       ← CRUD, guarded by JwtAuthGuard
├── queue/            ← BullMQ producers + processors
├── notifications/    ← SSE endpoint + RxJS/Redis pub-sub bridge
├── csv-import/       ← upload endpoint (stub streaming logic)
├── prisma/           ← PrismaService/PrismaModule
├── config/           ← env validation
└── common/           ← guards/filters/decorators
```

## Build / run / test

```bash
npm run build              # nest build — passes
npm run lint                # eslint --fix — passes
npm test                    # jest (unit tests) — passes
npm run prisma:migrate:dev  # after editing prisma/schema.prisma
npm run prisma:seed         # idempotent admin upsert
docker compose up --build   # full stack: postgres, redis, migrate, api, worker
```

Copy `.env.example` to `.env` before running `docker compose up` (though every variable has an
inline default in `docker-compose.yml`, so even the un-copied defaults work).

## Non-negotiables (condensed — see root `CLAUDE.md` for the full list)

- Every Employees/CSV-import route is behind `JwtAuthGuard`, applied at the controller-class
  level (§4, §5).
- Passwords are always bcrypt-hashed (§4); CSV is always stream-parsed, never buffered fully into
  RAM, and inserted in batches inside the worker (§8).
- Employee creation always goes through the BullMQ job — never a synchronous fake notification
  (§6.1).
- Never trust a client-supplied employee `id` on update/delete — the DTOs never carry one; the
  route's validated `:id` param is the only source of truth (§5).
- `docker-compose.yml` is the single source of truth for local setup and must always fully
  provision the stack with zero manual steps (§10).

## Where to look

- `AUDIT.md` — open ambiguities from the brief needing a documented decision.
- `ASSUMPTIONS_MADE.md` — the concrete resolution landed on for each `AUDIT.md` item.
- `KNOWLEDGE-MAP.md` — per-feature: owned Prisma models, file locations, `EMS-BACKEND-PLAN.md`
  §-reference.
- `FEATURE-IDEAS.md` — a few optional additive ideas beyond the brief.
- `plans/<feature>.md` — implementation approach per feature.
- `specs/<feature>.md` — behavior/edge cases per feature.
- `tests/<feature>.md` — required unit/integration coverage target per feature, mapped to the
  brief's "Unit Test" section (login, CRUD employee, queue handler).
- Root `CLAUDE.md`'s "Testing Strategy" section — the full testing-type checklist, scoped down to
  what this technical test actually requires.

## Feature index

**Fully implemented**: `auth` (login, JWT), `employees` (CRUD + server-side pagination/search/
sort — see `specs/employees.md` and `AUDIT.md` #6), `queue` (both `employee-created` and
`csv-import` producers+processors, full), `notifications` (SSE + Redis pub-sub bridge, full —
now also carries `csv-import.progress`/`.completed`/`.failed` events), `csv-import` (upload,
enqueue, real streaming-parse + batched `createMany`, byte-based progress, status endpoint — see
`plans/csv-import.md` and `EMS-BACKEND-PLAN.md` §8).
