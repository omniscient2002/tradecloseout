# PH2-NEW-012 — explicit immutable variation proposals

Baseline: `a811a1a74bb73e97a81deef14cb93d64549bc42c`. Parent findings PH2-G05-002/005 retain their original IDs and independent acceptance states.

The baseline variation command converted missing/null cost deltas into zero, ignored unsupported fields and reread caller-owned text after waiting for a database lock. The new command snapshots declared data fields without invoking accessors, requires an explicit exact signed paise amount, validates target UUIDs and bounded text without control characters, and preserves detached scope JSON. An intentional zero is valid; an omitted or null amount is rejected before connection acquisition. Existing project lifecycle locking, active exact-scope parent contract checks, DRAFT status and atomic audit/outbox emission remain intact. No approval or engineering obligation is invented from a proposal.

Baseline verification: the new unit suite had 11 failed / 8 passed cases; the real PostgreSQL test reproduced an omitted amount being persisted as zero. After correction, the new unit suite passes19 tests. The real DB/adjacent regression command passes20 tests across4 suites. A real project-lock wait test mutates the original DTO while the command is blocked, then verifies the committed reference/title/amount/scope and business event still match the admitted proposal. It also round-trips zero, negative, beyond-JavaScript-safe and PostgreSQL bigint boundary amounts through restricted tc_app.

Commands (Node22.23.5, pnpm12.4.1, environment-local PostgreSQL16 on127.0.0.1:55441):

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-variation-admission.spec.ts`:19 passed after correction.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-variation-admission-db.spec.ts test/phase2-project-money-variations-db.spec.ts test/phase2-easy-ten-db.spec.ts test/phase2-easy-ten.spec.ts`:20 passed across4 suites.
- `pnpm typecheck`:passed.

Logs and their raw/stored hashes are in `evidence/two-input-contracts-20261113/`. Stored text normalizes terminal whitespace only. Counts overlap later full regression and must not be summed. These tests exercise command admission, actual locks and draft history, not full HTTP authorization, qualified HVAC approval, real provider acceptance or independent audit closure. No migration, lockfile, permission or acceptance-policy change is included. Final integrated build/workspace/security/RBAC results will accompany the second scoped fix before PR publication; no merge or deployment is authorized.
