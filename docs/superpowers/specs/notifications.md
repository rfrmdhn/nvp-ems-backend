# specs/notifications.md

Behavior/edge cases for `GET /notifications/stream`. See `EMS-BACKEND-PLAN.md` §7.

## Authentication

Guarded by `AuthGuard('jwt-sse')` (`JwtSseStrategy`, `src/auth/strategies/jwt-sse.strategy.ts`) —
**not** the usual `JwtAuthGuard`/`AuthGuard('jwt')`. Native `EventSource` cannot set an
`Authorization` header, so this route (and only this route) requires the JWT as a query-string
parameter instead:

```
GET /notifications/stream?token=<jwt>
```

`token` is literally the parameter name. A request with no `token` query param and no
`Authorization` header, or with an invalid/expired token, gets `401 Unauthorized` — same as any
other guarded route. For non-browser clients (curl/Postman) the standard `Authorization: Bearer
<jwt>` header still works as a fallback, since the extractor checks the query param first, then
the header. See `docs/superpowers/AUDIT.md` #4.

## Happy path

- Client opens an `EventSource` connection to `/notifications/stream?token=<jwt>` (a plain
  `new EventSource(url)` call cannot set headers, so the token must be in the URL).
- Connection stays open (HTTP chunked response, `Content-Type: text/event-stream`).
- When an employee is created, within ~300ms (the processor's simulated delay) the client
  receives an SSE `MessageEvent` with `type: 'employee.created'`, `id: <ISO timestamp>`, and
  `data: <employee fields>` (the created employee row, `salary` serialized as a string). `data`
  is the raw payload, not a nested envelope — the frontend never has to unwrap a `data.data`.

## Edge cases

| Scenario | Expected behavior |
|---|---|
| No requests have happened yet | Connection stays open, no events emitted, no error. |
| Client disconnects and reconnects | `EventSource`'s native retry handles reconnection; any events published while disconnected are lost (see `AUDIT.md` #2/#5 — no backlog replay in this phase). |
| Multiple browser tabs connected simultaneously | Every connected client receives every event (RxJS `Subject` fan-out, one per HTTP response stream). |
| Redis briefly unavailable | `NotificationsService`'s publisher/subscriber log a warning and rely on ioredis's own reconnect logic; events published during the outage are dropped (not queued for later delivery). |
| Request has no `?token=` and no `Authorization` header | `401 Unauthorized` — resolved per `AUDIT.md` #4. |
| `?token=` is invalid, malformed, or expired | `401 Unauthorized`, same as any other guarded route. |
| Client connected with a valid token whose JWT later expires mid-stream | The connection is not proactively dropped by the server on expiry (Passport only checks the token at the initial handshake); the client would only see a 401 on its *next* reconnect attempt after a drop. |

## Non-goals for this phase

- No persisted notification history, no replay-on-reconnect, no per-client filtering (every
  client sees every event type).
