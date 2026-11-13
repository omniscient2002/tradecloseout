# PH2-NEW-013 — bounded project creation contract

Baseline after completing the first fix: `04d5dae7b4460821d38bbedd61f144f784a28120`. Parent PH2-G05-002 retains its original ID and independent acceptance state. The preceding variation fix is documented in `VARIATION-ADMISSION-2026-11-13.md`.

## Reproduced behavior and correction

The public project-create wrapper accessed malformed envelopes directly and silently discarded unsupported fields. The internal draft command accepted unbounded site/settings JSON, called request getters, and retained mutable input across asynchronous connection acquisition. Its response and audit event used the original untrimmed name while the project row stored the trimmed value.

Both entry points now snapshot their declared data fields before validation or SQL. Unknown/symbolic/hidden/accessor fields and nonordinary envelopes are rejected with a controlled 422. The public contract retains its existing field set; it does not gain an arbitrary settings/site update API. The internal command supports its existing site/settings objects, each limited to 32KiB with the existing bounded JSON validator's depth/node/JSON-value restrictions. Both objects are detached before awaiting a connection. Omitted objects retain empty defaults; explicit malformed/null objects are rejected. The selected project-type vocabulary and omitted-type default are retained, while explicit null is invalid. Existing exact-paise, calendar/chronology, current tenant-party eligibility and DRAFT creation checks remain intact.

The project name is normalized once, so row, response and business history agree. An admitted command cannot reread a subsequently changed name, party, dates, project type or nested metadata from its caller. These controls do not grant project creation authority or bypass authenticated-session/permission controls. No engineering template, requirement mapping, supplier qualification, signing/payment event or approval is inferred from a draft project or variation. Unknown money remains NULL and intentional zero remains zero.

## Evidence

Before correction, the new unit suite had 16 failed / 6 passed cases. Two real database cases also failed: the public command returned the unnormalized name, and the internal command reread a mutated foreign party after admission rather than the validated input. Two later unit cases add explicit-null project-type coverage; the final creation boundary suite has 24 cases.

After correction, the combined creation/variation unit command passes 43 tests across 2 suites. The targeted DB/domain command passes 18 tests across 6 suites. Real SQL runs as restricted tc_app in independently created disposable PostgreSQL 16 databases. A controlled connection gate coordinates input mutation; it does not replace database queries or transactions. The tests verify original nested metadata and dates survive the wait, current project-type selection remains HOSPITAL, exact large/zero/unknown amounts persist correctly, the creator gets one project membership, and row/response/audit/outbox identities agree. A synthetic audit-insert exception proves project/member/history rollback. Foreign tenant-party linkage remains denied.

Commands and source provenance use Node 22.23.5/pnpm 12.4.1 and only environment-local PostgreSQL 16 at 127.0.0.1:55441, Redis at 127.0.0.1:56379 and the previously verified real qpdf. Existing dependencies were reused; lockfile, migration files, runtime privileges, provider gates and canonical acceptance policy are unchanged.

- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-project-create-admission.spec.ts test/phase2-variation-admission.spec.ts`: 43 passed across 2 suites.
- `pnpm --filter @tradecloseout/api exec jest --runInBand test/phase2-project-create-admission-db.spec.ts test/phase2-variation-admission-db.spec.ts test/phase2-project-money-variations-db.spec.ts test/phase2-easy-ten-db.spec.ts test/phase2-owner-digest-commercial-db.spec.ts test/hvac-checklist-readiness-branch.spec.ts`: 18 passed across 6 suites.
- `pnpm typecheck`: passed on both fixes.
- `pnpm build`: passed; 6 tasks, 5 unchanged tasks cached and API rebuilt.

Evidence, raw/stored log hashes and changed-source hashes are under `evidence/two-input-contracts-20261113/`. Stored text normalizes terminal whitespace only; results/messages are retained. Counts overlap later full workspace/security/RBAC results and must not be summed. These are completed scoped command-admission fixes, not independent closure of every project/contract/specification input issue. Actual application browser journeys, exact-head remote CI, independent review and qualified engineering/provider acceptance remain separate gates. Root browser projects cover archive/auth storage; no `pnpm test:e2e` application acceptance is claimed. The stacked PR still targets the Phase2 integration branch, while application/group CI triggers only for main. No merge, deployment or production acceptance is authorized or claimed.

## Final integrated checkpoint

- `pnpm test`: passed in one complete invocation — **646 API tests across 97 suites**, **33 worker**, **91 shared**, **13 database**, **10 archive/auth-storage browser tests**, and PDF inspection/front-matter/compilation checks.
- `pnpm test:security`: **15 passed**; `pnpm test:rbac`: **8 passed**.
- `git diff --check`: passed. Changed implementation/test hashes match `source-hashes.json`.

The first completed repair is committed as `04d5dae7b4460821d38bbedd61f144f784a28120`; the next commit contains the second repair and final integrated evidence. The implementation proposes both scoped fixes for review. Original canonical statuses, independent closure counts and external acceptance requirements remain unchanged.
