# tests/auth.md

Required coverage for auth, mapped to the brief's "Unit Test: login" requirement.

## Implemented — `src/auth/auth.service.spec.ts`

- Login with correct email + correct password → resolves with `{ accessToken, expiresIn }`,
  `JwtService.signAsync` called with `{ sub, email }` payload.
- Login with unknown email → rejects with `UnauthorizedException`, `signAsync` never called.
- Login with known email + wrong password → rejects with `UnauthorizedException`, `signAsync`
  never called.

All three mock `PrismaService` and `JwtService` — no real DB/Redis connection needed to run
`npm test`.

## Not implemented this phase (candidates if scope expands)

- E2E test hitting `POST /auth/login` over HTTP against a real (test) database.
- `JwtStrategy.validate()` unit test (currently trivial enough to be covered indirectly by the
  employees e2e-guard behavior, if/when that's added).
- Guard-level test asserting `JwtAuthGuard` actually rejects unauthenticated requests to a
  protected route (currently only verified by code inspection — see root `CLAUDE.md` non-negotiable
  rule on this).
