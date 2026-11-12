# Phase 4 · Pass 02 — defect revision/recovery and severity contract

Date: 2026-11-12
Scope: PH4-G17-005 and PH4-G17-006
Source: [30-pass plan](./phase4-production-closure-pass-plan.md)
Working draft: [PR #23](https://github.com/omniscient2002/tradecloseout/pull/23)

## Implemented in this pass (not independent closure)

1. Migration `0049_phase4_defect_transition_ledger.sql`: tenant-RLS, append-only `defect_transition_events` with composite foreign keys, immutable action and actor, exact previous/next row version, due date, assignee, supplier party, evidence object, remedy version, decision reason and original/canonical severity. Runtime `tc_app` receives SELECT/INSERT only; UPDATE/DELETE explicitly revoked. Unique per-defect next version blocks duplicate history. Previously existing defects retain their current state and do not gain fabricated historic events.
2. Assignment/reassignment: supervisor-only, active project member and active supplier party qualification, exact row-version compare and project-first locks. Assigned defect moves into `IN_PROGRESS`; explicit unassignment remains `OPEN`. An assignment update atomically appends an event and emits audit/outbox.
3. Remedy submission and independent closure now append their exact versioned immutable evidence records in the same transaction as `defects` updates.
4. Rejection of a `RECTIFIED` remedy: independent QC/PM/owner verifier, no self-verification, specific bounded reason, compare-and-set version, state reverts to `IN_PROGRESS`, current evidence pointer is cleared while prior remedy object/version remains in immutable history. A later resubmission adds a *new* version, never overwriting prior evidence history.
5. Nonmandatory waiver: accountable supervisor with reason and row-version compare only while OPEN/IN_PROGRESS. Mandatory defects fail with `DEFECT_MANDATORY_WAIVER_SECOND_APPROVAL_REQUIRED` until a separately approved two-party workflow is designed; no optimistic waivers.
6. Reopen CLOSED/WAIVED: supervisor role, meaningful decision reason, version check, project lifecycle restrictions from Pass 01; resets active closure/remedy pointers but retains prior accepted/rejected evidence in the ledger. CLOSED contractual baseline cannot be reopened while project CLOSED.
7. Canonical severity correction: supervisor-only with typed LOW/MEDIUM/HIGH/CRITICAL values; legacy MINOR/MAJOR input aliases map to LOW/HIGH. Historical and new severity values are recorded on the transition. Work items now show OPEN/IN_PROGRESS/RECTIFIED, valid next actions (assignment, remedy or verification), exact row version, canonical priority, overdue high-risk escalation and assigned-vs-unassigned recovery.
8. Guarded HTTP endpoints for assign, severity correction, rejection, waiver, reopen and scoped ledger history; no external provider integrations enabled.

## Tests to pass on the exact candidate

- `apps/api/test/phase4-pass2-defect-transitions.spec.ts`: assignment and eligible members/parties, stale/replayed versions, reject→resubmit evidence provenance, self-verifier rejection, mandatory waiver denial, nonmandatory waiver/reopen, severity mapping/reason, supervisor role negative matrix.
- `apps/api/test/phase4-pass2-defect-ledger-db.spec.ts`: fresh PostgreSQL migrations, real RLS, actual app-role UPDATE/DELETE denial, composite rows, versioned assignment and severity, cross-tenant ledger isolation.
- Existing independent aftercare, document-version qualification, lifecycle, project closure, audit, storage and browser suites must remain green. The current exact-head CI status belongs in PR #23 after completion.

## Explicitly unresolved / acceptance dependencies

- No real customer policy has approved mandatory defect waiver by a second signer; this path intentionally remains disabled.
- No multi-process live HTTP role/recipient/revision and end-to-end browser acceptance, independent HVAC severity policy, notification provider receipts or genuine OEM remediation proof has been supplied.
- Work-item queue is an actionable *projection*, not proof that a notification was delivered or an obligation accepted by a counterparty.
- Historical pre-0049 remedy and waiver rows cannot be silently backfilled as attributable events. A controlled audit/reconciliation process and positive legacy sample evidence are still required.
- No deployment GO, no merge, no external provider integration, no independent closure of either G17-005 or G17-006 on code/CI alone.

## Status
PARTIAL / VERIFY — engineering implementation checkpoint. Record exact commit/CI and independent review separately; do not increase independently closed count without all subrequirements passing.
