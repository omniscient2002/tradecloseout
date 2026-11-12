# Phase 5 fixes — exact candidate and release ledger

**Status: DRAFT / NO-GO. No independent approval, production deployment, provider verification or merge.**

- Implementation branch: `fix/phase-5-fixes` / PR #20, based on main `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`.
- Audit authority: PR #18, `docs/audits/remaining-phases-2026-11-12/phase5/G23.md`, `G22.md`, `G28.md` at `f51a90894589091ddeaeaeefea14f86473479568`. Audit examined a **different, unmerged** app candidate `36c8efb94ce2ed77ef016ef58ad44d494bfc6e84`. Do not treat its observations as automatically re-proven after integration.
- Phase 5 audit covers **25 items** (G23=8, G22=8, G28=9), including one P0 (PH5-G28-001). These are group obligations, not 25 independent root causes.
- Implementation vs acceptance: **all 25 findings remain canonically OPEN or BLOCKED_EXTERNAL** pending per-ID independent review and final integrated-source/provider evidence. The candidate statuses below only describe code progress.
- External providers, service accounts and real-world acceptance remain deferred per user request. Do not substitute synthetic READY statuses or development fixtures.

## Per-ID candidate status

| Finding | Candidate | Changes / outstanding closure |
|---|---|---|
| PH5-G23-001 | PARTIAL | Upload modal now reports browser-local draft persistence instead of completed submission; all actual end-to-end product journeys remain incomplete |
| PH5-G23-002 | PARTIAL | Audit-page missing/metadata-only hashes handled; shared typed DTO/permission integration pending |
| PH5-G23-003 | OPEN | Server-derived per-action capability UI missing |
| PH5-G23-004 | PARTIAL | Removed invented warranty/defect defaults; authoritative scoped reporting still missing |
| PH5-G23-005 | CANDIDATE | Safe UTF-8 CSV/Blob export, formula-prefix policy, regression tests; consumer/large-file acceptance pending |
| PH5-G23-006 | PARTIAL | Technical evidence upload has associated labels, keyboard-accessible file input and live/error messages; full assistive-tech/mobile journey verification missing |
| PH5-G23-007 | PARTIAL | Distinct warranty/defect failure, empty/loading/retry states; stale response fence and other pages pending |
| PH5-G23-008 | BLOCKED_EXTERNAL | Human user/accessibility acceptance |
| PH5-G22-001 | CANDIDATE | Bounded URL refresh/retry, stable uploaded receipts, backend blocks refresh when intent is no longer PENDING_UPLOAD/PENDING; real provider acceptance pending |
| PH5-G22-002 | CANDIDATE | Origin-wide Web Locks serialize drains; unsupported environments fail closed; tab crash/mobile coverage pending |
| PH5-G22-003 | PARTIAL | Persist completion request before POST, interrogate server after lost response, only retry when server confirms PENDING_UPLOAD, status-only PROCESSING reconciliation; retry/cancellation policies pending |
| PH5-G22-004 | PARTIAL | Server-derived member/tenant queue partition, auth/tenant-boundary epoch rotation and strict no-auto-replay after same-user re-login; original actor can list/discard old generation; explicit authorized recovery UI remains open |
| PH5-G22-005 | PARTIAL | Atomic 100 MiB file, 300 MiB actor, 500 MiB browser and 10-draft limits; actor-only inventory and abort-first discard, safe replay of already-committed abort, denial preserves original; TTL/eviction/real-device proof pending |
| PH5-G22-006 | CANDIDATE | Incremental 1 MiB SHA-256 original-byte hashing matches known vectors/Node crypto across block boundaries; real 100 MiB mobile peak-memory and worker/cancellation evidence pending |
| PH5-G22-007 | PARTIAL | No closed-tab provider writes; unsupported lock surfaces fail closed; upload modal explicitly distinguishes saved draft vs scanned/verified evidence; device/scope acceptance pending |
| PH5-G22-008 | BLOCKED_EXTERNAL | Real provider, device and interruption acceptance |
| PH5-G28-001 | PARTIAL (P0 OPEN) | Passwordless restricted role migration + DB privilege tests; RB09 quarantine, source-package and archive URL denial for invalidated evidence, new submission denial under locks, and fail-closed upload URL refresh. Operator identity/approval binding, prior signed-URL/copied-archive revocation, accepted-recipient invalidation and real end-to-end runbook proof still open |
| PH5-G28-002 | OPEN | Validated deployable infrastructure, privilege and network contract |
| PH5-G28-003 | OPEN | Promoted image/DB migration/rollback pipeline |
| PH5-G28-004 | PARTIAL | Isolated DB dump/restore drill uses its own consistent snapshot, cleanup trap, restricted file permissions and safe preflight; actual PITR, RPO/RTO, S3 bytes and KMS recovery unverified |
| PH5-G28-005 | BLOCKED_EXTERNAL | Load/soak/on-call/alert/chaos receipts |
| PH5-G28-006 | PARTIAL | Real queue exercised against loopback provider/IndexedDB/Web Locks; added quota, actor inventory/discard, lost completion and SHA-256 vectors, backend URL refresh states and DB incident role tests; full service E2E pending |
| PH5-G28-007 | PARTIAL | Passwordless least-privilege incident DB role migration and no service-account credential provided; independent operator IAM/approval and complete admin surface still missing |
| PH5-G28-008 | OPEN | Legal hold, retention and complete deletion contract |
| PH5-G28-009 | BLOCKED_EXTERNAL | One final integrated, independently reviewed production release |

## Code mechanics and verification

The browser regression file `apps/web/e2e/offline-queue-phase5.spec.ts` executes the actual queue against a stubbed API client, real Chromium IndexedDB/Web Locks and loopback HTTP PUTs. It covers expired presigned URL refresh, concurrent drains, actor isolation, per-actor/global quota, scoped draft inventory/discard, missing completion responses and same-key retry when the server remains pending, plus injected browser-storage exhaustion. `apps/web/e2e/chunked-sha256.spec.ts` compares original-byte SHA-256 against known empty/abc vectors and Node crypto across padding/segment boundaries. `apps/web/e2e/csv-export.spec.ts` covers Unicode, #/%/CRLF, quoting, formula prefixes and malformed values. Backend regressions check restricted incident SQL privileges and deny refresh of quarantined upload intents. These are fixture/DB mechanics tests, **not** production provider or end-to-end acceptance.

**Latest verified passing engineering head before this ledger edit:** `93f5d132d36d348303c2058b3093fe7fd49669d8`, GitHub `verify-and-test` and `group-register` successful. The prior `71ccd765` head included **17 passing** Chromium archive-project checks and **257 passing** API tests. This confirmed head also includes lost-completion, backend URL-refresh and abort-replay regressions; later auth epoch changes require a fresh exact-head result. Always check the exact latest head before claiming that its tests passed.

Useful commands on a clean Node 22/pnpm 12.4.1 checkout with isolated PG16/Redis and Chromium:
```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
pnpm --filter @tradecloseout/web exec playwright test --project=archive
# Full application e2e requires live isolated API/web/worker fixtures:
pnpm test:e2e
```

## Local evidence safety / memory caveats

The browser queue enforces the API's current 100 MiB maximum per file, a 300 MiB per-actor cap, a 500 MiB total cap and 10 active drafts per actor; quota validation and persistence occur within the same IndexedDB readwrite transaction. The upload modal lists only the current actor's drafts; an explicit discard of an unfinished remote intent first asks the server to abort. A lost abort response may be reconciled only against an authoritatively FAILED/QUARANTINED version; a 401/403 never implies permission to delete. Discard refuses a pending scan/processing receipt. These are **logical per-origin controls**, not disk encryption; use separate browser profiles for different people on shared devices. Browser storage may still be evicted. A device-level storage persistence contract, TTL and completed-intent cleanup remain required.

The original-blob SHA-256 digest now uses a streaming incremental implementation reading 1 MiB slices rather than `file.arrayBuffer()`. Known vectors and segment boundaries match Node's SHA-256. Full mobile peak-memory profiling, background-worker offload and cancellation are unaccepted.

## Actor-bound queue recovery contract

On the contractor project screen, `GET /api/v1/auth/me` supplies `userId` and `activeOrgId`; these define the upload partition instead of stale browser-provided input. Session and organisation changes clear the partition and rotate a non-secret local generation value. Enqueued originals are tagged with their current generation; legacy drafts without one and pre-logout drafts are **not automatically replayed**, even if the same user signs back in. The returning original actor may inspect and deliberately discard drafts; restoring old bytes for upload would require an explicit server-verified authority check and user confirmation (still outstanding). Browser-local storage is **not** a security boundary against people sharing one OS/browser profile.

## Incident operation limitations (PH5-G28-001)

`scripts/execute-runbooks.ts` now requires `INCIDENT_DATABASE_URL` for a separately provisioned `tc_incident_operator` login; `INCIDENT_OPERATOR_ID` and (for actual execution) `INCIDENT_APPROVAL_REF`. No superuser/migrator fallback exists. Invocation is:

```sh
pnpm tsx scripts/execute-runbooks.ts RB-09 <org-uuid> <document-version-uuid> "<12+ character incident reason>" --dry-run
# --execute only after independently approved, restricted IAM and staging rehearsal
```

Migration `0021_incident_operator_restricted_role.sql` creates `tc_incident_operator` without a password, grants only necessary SELECT, single-column containment writes and append-only audit inserts, and refuses unsafe pre-existing elevated role attributes. A deployment must independently establish short-lived credentials and bind approval to a real operator identity; supplying `INCIDENT_OPERATOR_ID` as an environment variable is **not sufficient authentication of that named human**.

RB09 changes the **storage_objects** state rather than overwriting an APPROVED document version to violate `review_status <> APPROVED OR file_status = READY`. Existing document download/preview/stream endpoints deny non-READY storage objects. Package PDF download and new handover submissions now reject included evidence whose storage or review state is no longer qualified; submission uses row locks to serialize against quarantine. Completed portable archive downloads also require every manifest-pinned source version/object to remain READY and match the immutable object SHA/version; source records are held with FOR SHARE while issuing future URLs. This cannot revoke URLs issued before the incident or delete already distributed archive copies. These controls **do not revoke previously distributed provider-signed URLs or copied exports**, and they are not sufficient to close the P0. Real restricted-PG dry-run/execute/replay, audit-chain, package/acceptance/archives propagation and operator IAM must be accepted independently.

## Honest upload-state and accessibility behavior

The technical evidence modal no longer reports a successful upload merely because IndexedDB accepted the original file. It keeps the dialog open, displays an explicit local-only persistence warning and no longer suggests that an unverified draft has been scanned/approved. Labels are now associated with file, revision, date and comment controls. The modal also includes an actor-scoped draft inventory and explicit discard. These do not substitute for browser eviction handling, expiry/recovery policy, live confirmation or screen-reader acceptance.

## Database restore drill hardening

`scripts/run-restore-drill.sh` now refuses to run without `RESTORE_DRILL_SCOPE=disposable-staging-only` and explicit `RESTORE_SOURCE_DATABASE_URL`, uses `umask 077`, an isolated randomized database, an EXIT cleanup trap and `psql -v ON_ERROR_STOP=1`. The previous live-source COUNT comparison after `pg_dump` was removed because it measures a different snapshot during concurrent writes. The script verifies the restored snapshot's metadata, basic hash links and row counts but **does not recover object bytes, KMS keys, independent audit anchors, WAL PITR, or certify production RPO/RTO**. Preflight tests validate Bash syntax and reject unacknowledged execution; a genuine isolated PG restore run is still mandatory.

## Remaining prerequisite integration

- Main does not contain all still-unmerged Phase1/2/3/4 candidate code. Bring separately reviewed changes onto a coordinated SHA, resolve migration numbering and execute full regression on that actual tree. Do not automatically copy provider credentials, change audit registers, claim old approvals, merge or deploy.
- Supported browser/device/version matrix, accessible UI and explicit user draft recovery remain required.
- Actual S3/object-version/checksum, scanner quarantine, approved domain content, finance, counterparty receipts, deployment restoration and on-call approval are **not provided**. Keep unsupported features safely disabled.
