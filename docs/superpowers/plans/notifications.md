# plans/notifications.md

Implementation approach for realtime notifications over SSE. See `EMS-BACKEND-PLAN.md` §7/§7.1.

## Approach

- `NotificationsService` holds an RxJS `Subject<NotificationEvent>`, exposed as `stream$`.
- Because the BullMQ processors run in the `worker` process (or, per `plans/queue.md`, possibly
  also `api` — but conceptually "the worker") and the SSE endpoint is served by the `api`
  process, a same-process `Subject.next()` call from the processor would never reach the SSE
  clients in a genuinely multi-process deployment. The bridge: the processor calls
  `NotificationsService.notifyEmployeeCreated(...)`, which `publish()`es a JSON-serialized event
  onto a Redis pub/sub channel (`ems:notifications`); every process running `NotificationsService`
  also subscribes to that channel on `onModuleInit` and forwards received messages into its own
  local `Subject`. The `api` process's SSE endpoint observes that local `Subject`.
- `NotificationsController`'s `@Sse('stream')` handler maps each `NotificationEvent` into Nest's
  `MessageEvent` shape (`{ type, data }`) — `EventSource` on the frontend receives this as a
  named/default SSE event depending on how the frontend chooses to listen.
- Two Redis client connections are held (`publisher`, `subscriber`) because ioredis requires a
  dedicated connection once a client enters subscribe mode — the same connection can't also
  `PUBLISH`.
- Both clients attach `.on('error', ...)` handlers that log-and-continue rather than let an
  unhandled `error` event crash the process during a transient Redis outage.

## Dependencies

- `ioredis` (direct usage, separate from BullMQ's own internal Redis connection).
- `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` env vars (same Redis instance BullMQ uses, different
  logical channel).

## Open decisions

See `AUDIT.md` #2 (persistence), #4 (auth), #5 (backpressure). #2/#5 resolved as "ephemeral, bare
Subject" for this phase; #4 (auth) resolved differently from that original plan — the stream is
now guarded via `AuthGuard('jwt-sse')` + a `?token=` query param (`JwtSseStrategy`), not left
unauthenticated. See `ASSUMPTIONS_MADE.md` and `specs/notifications.md`.
