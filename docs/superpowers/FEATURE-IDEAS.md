# FEATURE-IDEAS.md

A few optional additive ideas beyond the brief, kept short. None of these are planned or
scheduled — they're notes for if the reviewer wants to see initiative beyond the minimum.

- **Refresh tokens / logout**: current JWT is stateless with a fixed expiry; a refresh-token flow
  or a server-side revocation list would let a compromised token be invalidated before expiry.
- **Rate limiting on `/auth/login`**: `@nestjs/throttler` on the login route to blunt brute-force
  attempts against the single seeded admin account.
- **Notification persistence** (ties into `AUDIT.md` #2): a `Notification` table + `GET
  /notifications` so a client that missed an SSE event while disconnected can catch up.
- **Employee soft-delete**: status transition instead of hard delete, if audit history of removed
  employees ever matters.
- **CSV export**: the inverse of CSV import — `GET /employees/export.csv`, streamed the same way
  (never buffer the whole result set), useful once the roster is large.
- **Structured request logging**: correlation IDs across the `api` → BullMQ job → `worker` →
  SSE chain, so a single employee-creation flow can be traced end-to-end in logs.
