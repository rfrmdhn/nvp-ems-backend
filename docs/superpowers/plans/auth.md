# plans/auth.md

Implementation approach for admin login. See `EMS-BACKEND-PLAN.md` §4.

## Approach

1. `LoginDto` validates `email`/`password` shape only — no business logic in the DTO.
2. `AuthService.login(email, password)`:
   - `prisma.admin.findUnique({ where: { email } })`.
   - If not found → `UnauthorizedException('Invalid credentials')`.
   - `bcrypt.compare(password, admin.passwordHash)` — if false, same generic exception. This is
     deliberate: the API must never let a caller distinguish "no such email" from "wrong
     password" (a common enumeration vector).
   - On success, sign a JWT via `@nestjs/jwt`'s `JwtService.signAsync`, payload
     `{ sub: admin.id, email: admin.email }`, `expiresIn` from `JWT_EXPIRES_IN`.
3. `JwtStrategy` (passport-jwt) extracts the bearer token, verifies signature/expiry (handled by
   passport-jwt itself against `JWT_SECRET`), and its `validate()` hook maps the payload to
   `{ id, email }` on `req.user`.
4. `JwtAuthGuard` is just `class JwtAuthGuard extends AuthGuard('jwt') {}` — no custom logic
   needed, Passport does the work.

## Dependencies

- `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `bcrypt`.
- `JWT_SECRET`/`JWT_EXPIRES_IN` env vars, validated at bootstrap (`src/config/env.validation.ts`).

## Open decisions

None specific to auth beyond `AUDIT.md` #1 (single role, no RBAC) — already resolved in
`ASSUMPTIONS_MADE.md`.
