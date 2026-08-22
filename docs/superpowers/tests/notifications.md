# tests/notifications.md

Notifications aren't one of the brief's three explicitly required unit-test areas (login, CRUD
employee, queue handler), so no dedicated spec file exists for it — its behavior is exercised
indirectly through `employee-created.processor.spec.ts`, which asserts
`NotificationsService.notifyEmployeeCreated` is called with the right payload shape (see
`tests/queue.md`).

## Authentication (jwt-sse guard)

`NotificationsController.stream()` is now guarded by `AuthGuard('jwt-sse')` (see
`docs/superpowers/AUDIT.md` #4 and `docs/superpowers/specs/notifications.md`). No dedicated spec
file was added for this — it's a thin Passport strategy reusing `JwtStrategy`'s validated
`secretOrKey`/`validate()` mapping (via `src/auth/strategies/jwt-payload.ts`), the same shape
already exercised by `auth.service.spec.ts`'s token-issuance assertions. The only genuinely new
behavior is the extractor's query-param-first-then-header order, which is Passport/library-level
plumbing rather than app logic worth a bespoke unit test for a technical test's scope. Verified
manually instead (curl with no token -> 401, curl with `?token=<jwt>` -> connects). A future
`notifications.controller.spec.ts` asserting the guard is applied (e.g. via
`Reflect.getMetadata` on the route, or an e2e 401 check) is a reasonable next-phase candidate,
same spirit as the "every route 401s without a token" item already listed below.

## Not implemented this phase (candidates if scope expands)

- A `notifications.service.spec.ts` that mocks `ioredis` and asserts: `notifyEmployeeCreated`
  publishes the expected JSON to the `ems:notifications` channel; a message received on the
  subscriber's `'message'` event gets forwarded into `stream$` (subscribe to `stream$` in the
  test, assert the emitted value).
- An e2e test that opens an HTTP connection to `/notifications/stream`, triggers an employee
  creation, and asserts an SSE event arrives (would need a real or fake Redis + a real HTTP
  server — more integration than unit).
