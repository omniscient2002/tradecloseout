# Phase 3 — Code-only production certification pass plan

**Status:** PLAN ONLY; NOT CERTIFIED / NO-GO. **Source:** Phase 3 audit at commit `f51a90894589091ddeaeaeefea14f86473479568`, eight group reports and draft PR #22. This document does not claim that existing partial fixes or historical CI are independently accepted.

**Goal:** Close 50 actionable code/workflow findings in 27 bounded engineering passes, then execute four integrated assurance passes. Retain eight separately identified external/provider/domain release gates as `BLOCKED_EXTERNAL` until independently evidenced. Total mapping: **58/58 original audit IDs exactly once**. This is a planning estimate; additional discovered defects create new rows and passes, not silently disappeared scope.

**Target branch/PR:** `phasepilot/production-v1-phase-03`, draft PR #22. Do not merge or deploy based solely on a green branch-local CI run. Coordinate Phase 1/2 dependency baselines and Phase 4/5 overlapping code before final acceptance.

## Common definition of done for every engineering pass

1. Re-read original finding and all subrequirements against exact current source (not historical statuses). Record previous accepted behavior to preserve.
2. Implement production-path fix with fail-closed authorization, tenant isolation, lifecycle/version/idempotency controls and rollback; no bypasses to satisfy mocks.
3. Add representative positive, negative, stale-state, unauthorized, concurrency and fault-injection regression tests where applicable. Use restricted PostgreSQL/RLS roles, actual API routes and browser flows for cross-boundary defects; record why any case is not applicable.
4. Run impacted suites and full configured CI on the **exact pass head**; record SHA, test commands, GitHub Actions URLs, migration replay, expected behavior and known gaps.
5. Obtain independent reviewer acceptance per **PH3 ID**, not per commit or vague group. Only mark `CLOSED_ENGINEERING` when source, tests and reviewer evidence are individually verified. Failed/partial remains `PARTIAL`/`OPEN`.
6. Keep integrations intentionally unavailable without real providers (mail, S3, scanning, identity/legal/DSC), using safe disabled paths or explicitly marked test doubles. Never claim simulated delivery/signature/scanner output is genuine.

## 27 engineering passes (50 IDs)

| Pass | PH3 IDs | Bounded task | Required verification |
| --- | --- | --- | --- |
| 01 | PH3-G08-002 | **P0 asset-scope isolation.** Enforce live membership, project/asset scope, derived records, every route alias and transaction boundary. | Restricted-PG/RLS wrong tenant, hidden asset, narrowed membership, concurrent revoke and negative HTTP tests. |
| 02 | PH3-G10-002 | **P0 immutable storage receipts.** Reject absent, empty, literal-null or mutable object versions consistently in upload, download, preview and workers; fail closed in provider-disabled mode. | Receipt parsing, object-version replay, corrupted/changed version and signed-download rejection tests. |
| 03 | PH3-G11-001 | **P0 one terminal review decision.** Single-winner terminal settlement across all assignments, atomic sibling handling, idempotent retries, no double commit or stale approval. | Real PG simultaneous reviewer decisions, reordered locks, stale state and lost-response replay. |
| 04 | PH3-G12-001 | **P0 witness-proof forgery.** Reject caller-minted verification/attestation fields across HTTP, nested inputs and older aliases; quarantine untrusted historical provenance. | HTTP/schema/DB spoofing, extra field, historical record projection and trust-state tests. |
| 05 | PH3-G07-001, PH3-G07-002 | **Waiver semantics and revision fence.** One canonical WAIVE/NOT_APPLICABLE contract; lifecycle locks, obligation row-version and no stale active waiver readiness. | Mandatory/optional and dual-approver cases, stale checklist revision, project close and restricted PG tests. |
| 06 | PH3-G07-003, PH3-G07-004 | **Durable waiver decisions and assignment.** Idempotent requests/withdraw/reject/countersign/audit plus requirement assignment, handoff, owner and evidence contracts. | Retry/lost-response, two-actor, revoked/suspended assignee, outbox rollback and browser cases. |
| 07 | PH3-G07-005, PH3-G07-006 | **Evidence qualification and snapshot lineage.** Select one approved immutable version consistently in readiness, checklist and packages; enforce active baseline lineage and authorized change. | Revision supersession, contradictory waiver/evidence, concurrent change and immutable history tests. |
| 08 | PH3-G08-001, PH3-G08-003 | **Atomic asset imports and safe tags.** Accurate dry run, single-transaction imports, valid PATCH/import tags and escaped matching. | Failing row rolls back whole import, concurrent imports, regex/meta input, large batch tests. |
| 09 | PH3-G08-004, PH3-G08-005 | **Asset lineage and category metadata.** Truthful retired/replaced lifecycle and distinct predecessor; category-specific required data, system links and asset creation rules. | Replacement cycles, hidden/cross-project predecessor, category validation, stale/retired references. |
| 10 | PH3-G08-006, PH3-G08-007 | **Asset revalidation and usable registers.** Bind revalidation to current exact evidence and preserve historical stale decisions; scoped search/register/CSV exports and import UI. | Scope-filtered totals/exports, changed evidence, pagination and full asset journey. |
| 11 | PH3-G10-001, PH3-G10-003 | **Hostile-file parsing and format validation.** Count compressed PDF objects and bound verification; check detected vs declared format and container signatures. | Compressed xref, polyglot/spoofed type, corrupt files, zip bombs and resource-budget negatives. |
| 12 | PH3-G10-004, PH3-G10-005 | **Upload state machine and short transactions.** Serialize active/latest document version publication, eliminate long provider work under DB locks, recover reservations. | Simultaneous settle, double upload, timeout, stale worker, task replay and quota consistency. |
| 13 | PH3-G10-006, PH3-G10-007 | **Storage reclamation and isolated scanners.** Durable orphan cleanup and retention accounting; scanner/converter identity, sandbox and resource ceilings. | Crash-after-upload, orphan sweeper, isolation, process kill, size/memory/time and retention replay. |
| 14 | PH3-G09-001, PH3-G09-002 | **Document accounting and retention guards.** Fix BIGINT delete/restore quotas, enforce project/hold/approved-package references under locks; no physical loss on failure. | Restricted PG type, rollback, duplicate restore, close-vs-delete race, legal holds and archive references. |
| 15 | PH3-G09-003, PH3-G09-004 | **Revision and qualification truth.** Typed document metadata, revision corrections and explicit separate upload/link/scan/approved/qualified states. | Historical revision projection, invalid metadata, linked-but-unapproved, changed/failed scanning tests. |
| 16 | PH3-G09-005, PH3-G09-006 | **Bulk transmittals and search registers.** Honest bulk import/transmittal response lifecycle and permission-filtered scalable document search/export. | Partial failure, idempotent response, hidden document data/counts and large pagination tests. |
| 17 | PH3-G04-001, PH3-G04-002 | **Party registry and delegation identity.** Complete party CRUD/validation; independently verified counterparty grant authority and revocation model. | Malformed identity, same-name parties, forged delegation, live grant revoke and cross-project negatives. |
| 18 | PH3-G04-003, PH3-G04-004 | **PO lifecycle and supplier intake ledger.** Validated purchase-order change/cancel rules and durable independently approved per-obligation intake decisions. | PO edits, old asset links, live contractor grant, version mismatch, command retries, audit rollback. |
| 19 | PH3-G04-005, PH3-G04-006 | **External journeys and lifecycle cleanup.** Supplier-facing scoped requests, truthful upload/decision status, contact/grant offboarding, audit-safe cleanup. | Guest revocation, deleted contact, stale session, denied data projection and complete mocked-provider UI. |
| 20 | PH3-G11-002, PH3-G11-003 | **Submission eligibility and reviewer assignment.** Require current eligible immutable submitted evidence and assign a separate live authorized reviewer. | Creator/self-review, suspended reviewer, stale evidence, wrong scope and concurrent submission. |
| 21 | PH3-G11-004, PH3-G11-005 | **Coherent review outcomes.** Atomic requirement/document/review state and identical validated version/decision contract on all legacy/new routes. | Decision reversals, stale/missing version, bypass via alias, reject/resubmit and rollback tests. |
| 22 | PH3-G11-006, PH3-G11-007 | **Review projections and advanced stages.** Secure scoped review/comment/annotation reads; explicitly implement or disable advanced stages, overrides and external response. | Comment visibility, hidden count, override authority, stage change, accessible HTTP/UI flows. |
| 23 | PH3-G12-002, PH3-G12-003 | **Immutable attestations and recovery.** Bind actor, declaration, exact inspection/evidence revision and timestamp to auditable receipt; implement reject/correct/reissue. | Replay, self-attestation, changed inspection, revoked actor and recovered incomplete attempt. |
| 24 | PH3-G12-004, PH3-G12-005 | **Disabled signatures and verification privacy.** No fake cryptographic signing until real verification; public receipt token privacy, rate limits and immutable audit policy. | Disabled-mode UI/API, guessing/enumeration, expired/revoked token, PII leakage and tampering negatives. |
| 25 | PH3-G21-001, PH3-G21-003 | **Work queue authorization and legacy removal.** Live per-action/per-resource queue filtering with accurate counts; remove obsolete workflow entry points. | Role/asset scope change, hidden count, dead code alias, API contract and pagination tests. |
| 26 | PH3-G21-002, PH3-G21-004 | **Assignment succession and action contracts.** Eligible delegate/backup/reassignment on leave or revoke; truthful versioned actions, mandatory fields and idempotency keys. | Assignee removal, retry, stale action, wrong role and end-to-end queue execution. |
| 27 | PH3-G21-005, PH3-G21-006 | **Transition events and SLA recovery.** Transactional audit/outbox for every transition, due/SLA lifecycle, escalations, recovery and exception paths. | Crash/replay, two workers, event order, overdue recovery, deadline/timezone and duplicate notification stub. |

## Integrated engineering certification passes

| Pass | Gate | Completion evidence |
| --- | --- | --- |
| 28 | **Restricted PostgreSQL security, state and concurrency** | Replay migrations against fresh and upgrade fixtures; RLS owner/member/guest negative matrix; deadlocks, serializability, revocation, races, duplicate commands, crashed workers, durable outbox/reconciliation, retention and immutable version invariants, repeatable in CI. |
| 29 | **Real API + browser user journeys with services safely stubbed/disabled** | Owner/contractor/reviewer/supplier/guest workflows: asset intake → evidence upload/qualification → approval/waiver → package prerequisites; role reduction, disconnection, stale tabs, wrong-project reads and safe recovery; no synthetic success shown as external delivery. |
| 30 | **Integrated source and operations hardening** | Rebase/reconcile approved Phase 1 and 2 dependencies, Phase 4/5 overlapping interfaces, migrations and RLS; frozen lockfile, typecheck, production build, unit/integration/security/RBAC/DB/browser tests; dependency/security scan, configuration fail-closed, observability, backup/restore rehearsal on deterministic local test dependencies. Passes on one pinned integrated commit SHA, not stitched branch-specific run links. |
| 31 | **Independent engineering certification decision** | 50 engineering-ID matrix rows individually accepted with evidence+reviewer+SHA; findings re-audited for new/escape defects; reproducible CI artifact manifest, migration/rollback operational runbook, threat model, permissions and codeowner signoff. Issue explicit **CONDITIONAL CODE-ONLY PASS** only if all engineering gates close, with eight external gates still blocked and no production/service enablement. Otherwise **NO-GO**. |

## Eight deferred external and domain gates (tracked, not silently excluded)

| PH3 ID | Deferred evidence |
| --- | --- |
| PH3-G07-007 | Approved engineering checklist baseline and domain signoff |
| PH3-G08-008 | Actual equipment/evidence lifecycle domain acceptance |
| PH3-G10-008 | Real object store/scanner and interrupted transfer provider acceptance |
| PH3-G09-007 | Real verified document bytes and physical-document revision acceptance |
| PH3-G04-007 | Verified external representatives and actual delivery acceptance |
| PH3-G11-008 | Independent real reviewer approval and immutable history acceptance |
| PH3-G12-006 | Real attestation identity, DSC/cryptographic verifier acceptance |
| PH3-G21-007 | Real multi-party responsibility and distributed operational acceptance |

## Exit criteria and reporting

- **Engineering code-only PASS** requires all 50 engineering IDs individually accepted; 0 open P0/P1 engineering defects, 0 unreviewed authorization/lifecycle/data-integrity regressions, reproducible full green CI on exact integrated SHA, and independently reviewed browser/PG/concurrency/upgrade evidence.
- **Full production certification remains NO-GO** until the eight external gates, legal/domain/provider acceptance and any cross-phase release blockers are separately satisfied. Do not infer release readiness from code-only status or mocks.
- Status ledger per finding: `OPEN | IN_PROGRESS | PARTIAL_VERIFY | CLOSED_ENGINEERING | BLOCKED_EXTERNAL`. Include commit SHA, direct regression links, negative/race proof, reviewer, review date and remaining risks.
- At each pass conclusion report: scope IDs; source diff; pass-specific tests; CI commit/run; security/domain behavior; unresolved subrequirements; regressions; independent review; next-pass dependencies. Do not automatically carry a `CLOSED` claim to a new integrated head.
- Planning expectation: **31 scoped passes minimum** (27 engineering + 4 integrated). Allow contingency for issues newly discovered during tests; there is no credible promise of zero defects or a fixed pass count independent of evidence.
