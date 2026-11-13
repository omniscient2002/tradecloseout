# PH2-NEW-014 — contract command admission

Baseline: `495dd76f1ef73ad2bad433ddce9153700cfa79f2`. Parent findings PH2-G05-002/005 retain their original IDs and independent acceptance states.

The contract command ignored unsupported fields, accepted control characters in reference/title, and retained caller-owned fields across asynchronous project locking. It now snapshots only its declared data fields without invoking accessors, validates the project UUID before SQL and rejects unsupported/invalid envelopes with422. References/titles remain bounded and now exclude ASCII control characters. Existing exact nonnegative paise, retention basis points, calendar/order and current same-tenant party checks are retained. The type signature now explicitly accepts the decimal strings already supported by the exact-money parser. Intentional zero remains zero; missing price remains NULL. Existing schema retention/status defaults are retained, without certifying contractual or engineering approval.

Before correction, the boundary suite had10 failed /13 passed cases and the real project-lock test failed when the command reread a mutated party after admission. After correction, the boundary suite passes23 cases. The DB/adjacent regression command passes4 tests across3 suites. It verifies the original reference/title/party/retention/dates survive a real project-lock wait, large exact paise and zero/unknown values round-trip, locked project states and foreign/archived parties remain denied, and a synthetic audit failure rolls back contract and history. Row locks/transactions and SQL use restricted tc_app in a disposable PostgreSQL16 database; this is command defense, not a production HTTP authentication bypass claim.

Commands used Node22.23.5/pnpm12.4.1 and only the existing environment-local fixture on127.0.0.1:55441:

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-contract-admission.spec.ts`:23 passed.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-contract-admission-db.spec.ts test/phase2-project-money-variations-db.spec.ts test/phase2-owner-digest-commercial-db.spec.ts`:4 passed across3 suites.
- `pnpm typecheck`:passed.

Evidence and raw/stored log hashes are in `evidence/commercial-records-20261113/`; stored logs normalize terminal whitespace only. An initial test invocation had no matching file because the file creation command was accidentally gated by a no-match search; it is a setup error, not reproduction evidence. The corrected baseline run and final passing runs are retained. Counts overlap later integrated regressions and must not be summed. No migration, privilege, lockfile or provider change is part of this first repair. Final integrated verification will accompany the second specification-scope fix. Original independent closures remain unchanged; no merge, deployment or production acceptance is claimed.
