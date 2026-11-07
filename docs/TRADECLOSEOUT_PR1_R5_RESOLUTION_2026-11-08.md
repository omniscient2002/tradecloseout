# PR #1: closed-project baseline mutation repaired

The R1–R4 fixes were verified at 4f6ea459f4ac2171afb1ac6a0bdf883994cb4a54. This slice repairs the remaining R5 gap: consultant imports and snapshot reapplication could replace an accepted contractual baseline after project closure without reopening the project.

## Implementation

Every baseline writer now calls the same `lockEditableProject` policy: canonical snapshot application, consultant imports, snapshot reapplication and manual requirement additions. The policy obtains the tenant-scoped project row lock and then checks lifecycle state. Closed projects return HTTP 409 with `CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN`. Purged projects reject; archived, cancelled and suspended projects are not editable. Draft, active and handover workflows remain supported.

The guard runs within the caller's existing tenant transaction. It shares the lock used by closure, so an import waiting for a closing transaction cannot proceed using a stale editable state. Rejected commands leave the accepted snapshot, requirements, audit and outbox unchanged. No database migration is needed. Formal reopening continues through the existing authorized reopen command.

## Regression evidence

Before the implementation, the new tests failed in two relevant cases: importing after actual closure succeeded, and a waiting import succeeded after closure won the race. After the repair, those tests pass.

The retained database/HTTP tests cover:

- Actual successful close followed by rejection of import, reapply, direct canonical snapshot application and manual addition.
- HTTP import/reapply return 409 for the owner and 403 for a site role; permission checks and real database transactions run, while session authentication is an explicit test fixture.
- Rejected writes preserve snapshot/requirement/audit/outbox counts and the original accepted active snapshot.
- Formal reopen records its audit event and permits a new import.
- Deterministic races where either closure or import acquires the project lock first: the other operation rejects appropriately; no closed project gets an unaccepted replacement baseline.
- Archived, cancelled, suspended and purged projects reject canonical baseline changes.

## Local validation

- `pnpm typecheck`: passed.
- Production build: passed, 6 tasks. As documented in earlier reviews, a temporary shell wrapper was used for this machine's shebang-less pnpm launcher; application/global tool installation was not changed.
- Root `pnpm test`: passed. API 28 suites / 249 tests; shared 44 tests; database 10 including parent; archive browser 6; PDF 3 scripted checks; worker 13 including parent.
- `pnpm test:security`: 3 suites / 15 tests passed.
- `pnpm test:rbac`: 1 suite / 8 tests passed.
- Diff whitespace check: passed.

The old import, waiver, readiness and acceptance regressions remain enabled. This is a scoped domain repair, not a claim that deferred templates, payment ingestion, production provider acceptance, full application browser journeys, backup/restore or commercial rollout have been completed. Local Node is v26.4.0; CI runs Node 22 with qpdf. The exact pushed commit must pass CI before merge.
