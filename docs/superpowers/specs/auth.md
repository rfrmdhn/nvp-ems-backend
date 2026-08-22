# specs/auth.md

Behavior/edge cases for `POST /auth/login`. See `EMS-BACKEND-PLAN.md` §4.

## Happy path

- Valid `email` + `password` matching the seeded admin → `200 OK`,
  `{ accessToken: string, expiresIn: string }`.
- `accessToken` is a JWT signed with `JWT_SECRET`, payload `{ sub, email, iat, exp }`.

## Edge cases

| Input | Expected behavior |
|---|---|
| Unknown email | `401 Unauthorized`, generic `"Invalid credentials"` message — no hint that the email doesn't exist. |
| Known email, wrong password | `401 Unauthorized`, same generic message as above. |
| Missing `email` or `password` field | `400 Bad Request` (class-validator via global `ValidationPipe`). |
| Malformed email (not `@`-shaped) | `400 Bad Request` (`@IsEmail()`). |
| Empty-string password | `400 Bad Request` (`@MinLength(1)`). |
| Extra unexpected body fields | Stripped silently by `ValidationPipe({ whitelist: true })`, not an error. |

## Protected routes (any Employees/CSV-import endpoint)

| Input | Expected behavior |
|---|---|
| No `Authorization` header | `401 Unauthorized`. |
| Malformed/expired/wrong-secret JWT | `401 Unauthorized`. |
| Valid JWT | Request proceeds, `req.user = { id, email }` available via `@CurrentUser()`. |

## Non-goals for this phase

- No refresh tokens, no logout/revocation endpoint (JWT is stateless, expires naturally).
- No rate limiting on login attempts (see `FEATURE-IDEAS.md`).
