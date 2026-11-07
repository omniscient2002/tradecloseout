# Implementation status review — 2026-11-06

## Conclusion and scope

The current working tree does **not** implement all requirements in the analysis documents. There is substantial remediation and some new domain functionality, but full pilot acceptance is not established. Passing the existing tests does not establish completion of the roadmap.

Reviewed against `TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md` T01–T20, `TRADECLOSEOUT_FINAL_ROADMAP.md`, the finding register, and `SOL_PRIORITISED_PRODUCT_ROADMAP.md`. Source inspection included API wiring/services, migrations/schema, worker handlers, web upload queue, CI, recovery script and tests. This is a task-level gap review, not exhaustive route-by-route security certification or a production deployment assessment. Existing source changes were preserved; this review adds this report only. The workspace is uncommitted and can change independently of this report.

**Partial** means meaningful code exists but stated requirements or acceptance evidence remain missing. **Not found** means the required workflow was not located in the inspected source inventory and searches; it is not a claim that every possible equivalent was ruled out. **Contained** means unsafe functionality is deliberately disabled, which does not implement its replacement.

## Verification

- `pnpm typecheck`: passed.
- `pnpm --filter @tradecloseout/api exec jest --runInBand`: 20 suites and 149 tests passed with local PostgreSQL access. Initial sandbox execution failed with EPERM for PostgreSQL; the rerun outside that restriction passed.
- Several suites use mocked database responses and SQL-string assertions, including `apps/api/test/discovery-lifecycle-foundations.spec.ts` and `apps/api/test/sol-integrity-verification.spec.ts`. These are useful regressions but do not demonstrate deployed migrations, real provider delivery or completed user workflows.
- No fresh/upgrade migration run, real S3/ClamAV round trip, browser workflow, restore drill, deployment or load test was executed for this review.

## Roadmap coverage

| Task | Assessment | Existing implementation | Remaining requirement or evidence |
|---|---|---|---|
| T01 Migration and tenant integrity | Partial | `packages/db/src/run-migrations.ts` serializes runners, validates checksums, rejects unknown ledger entries and checks legacy aliases. Migration 0013 adds procurement composite relationships. | Demonstrate fresh/known-upgrade convergence, mismatch and concurrent-runner tests; complete relationship/schema parity review. Health currently checks connectivity rather than schema compatibility. Presence of migration files does not prove application to deployed databases. |
| T02 Authentication/logout | Partial | Member OTP verification uses atomic Redis Lua; guest proof/session checks exist; logout revokes token hash and web calls POST logout; org switch rotates CSRF. | Real delivery absent (T11). Member challenge IDs are identifiers rather than opaque challenge IDs; request rate increment/expiry are separate operations and recipient/IP/provider budget coverage is incomplete. Prove parallel consume, persisted cooldown and revoked-session flows with real dependencies. |
| T03 Central resource authorization | Partial | Permission guard resolves several indirect resource IDs and verifies project membership; tenant service and document methods enforce guest scope. | `visibility-projection.interceptor.ts` remains a recursive field denylist rather than endpoint allowlists. Full direct-service, nested payload, list/count/search/export and route-alias matrix is not demonstrated. Policy remains distributed across guards/services/shared helpers. |
| T04 Real uploads/revisions | Partial | S3-backed upload service, multipart operations, immutable provider version receipts and document lock before revision allocation exist. | Demonstrate actual multipart interruption/resume/abort and concurrent allocation against storage/DB, including reconciliation when provider operation succeeds but DB commit fails. |
| T05 Bounded verification | Partial | Worker fetches immutable S3 version; scan checks hash/type and fails closed; tenant-bound atomic file/object updates and terminal failure handling exist. | No real S3/ClamAV integration executed. File-scan download in `apps/worker/src/main.ts` pipelines provider body to disk before verification without an explicit streamed byte ceiling; parser/concurrency memory/disk limits and scan attestations need acceptance evidence. |
| T06 Transactions/receipts/jobs | Partial | Tenant transaction helper commits events/audit with business state; idempotency claim fails closed and receipt persistence is awaited; worker uses tenant contexts, stable job IDs and schedule periods. | Idempotency business mutation and final response receipt remain separate transactions in the interceptor. Crash between them can leave committed work with an unresolved receipt. Outbox dispatch only handles scan/package events; other domain events accrue retries rather than having complete consumers/recovery. |
| T07 Review authority | Partial | Active review service checks reviewer roles, uploader separation, file state, companions and external proof; the legacy stamp-back method currently throws `STAMP_BACK_RETIRED` rather than approving versions. | Multiple decision implementations remain. `review-decision.service.ts` and `v021-workflows.service.ts` are referenced by simulation code rather than normal controller wiring and have different guards. Consolidate or isolate these paths and prove aliases/internal-call parity, exact submitted-version authority and append-only decisions. |
| T08 Qualified satisfaction | Partial | Readiness requires approved, READY versions with verified storage and checks valid waivers; companion checks exist in reviews. | Readiness still follows document-wide links and current approved pointer. It does not query pending `evidence_revalidations` created when equipment identity changes. No complete version/requirement-revision/asset-identity qualification and slot assessment model was found. Thus identity change invalidation is not demonstrated through readiness. |
| T09 Dossiers/submissions/archives | Partial | Frozen package items, real compilation/persistence worker, downloadable artifact and recipient response records exist; RA pack creation snapshots evidence. | `exportProjectArchive` explicitly returns a manifest-only receipt and no portable archive. Independent artifact verification, complete recipient loop and archive file recovery acceptance remain unproven. |
| T10 False signature assurance | Containment implemented in inspected service | Signing/preparation methods throw Gone; verification always reports `verified: false` with NOT_CHECKED/DIGEST_MATCH/DIGEST_MISMATCH. | Full public metadata/privacy and browser wording review remains. This implements truthful containment, not a cryptographic signing provider; building an owned signing engine is explicitly excluded by SOL. |
| T11 Delivery lifecycle | Missing provider implementation | Unavailable adapters fail honestly; external notifications are QUEUED rather than falsely SENT. | SMS and transactional mail methods in `identity.module.ts` unconditionally throw ServiceUnavailableException. No notification delivery worker/provider callbacks/retries/bounce lifecycle found. Non-debug OTP login cannot succeed through those adapters. |
| T12 Upload/offline UX | Partial | Queue entries have actor partition; processing polling retains recoverable state; main upload UI uses API. | Consolidation, logout/org-switch draft disposition, browser isolation/recovery scenarios and full mobile/offline conflicts still need proof. Legacy upload components remain in the source inventory. |
| T13 Representative release tests | Partial | API unit/security/DB suites and CI PostgreSQL/Redis checks exist. | `apps/web/e2e/critical-flows.spec.ts` has only redirect/login scenarios. CI does not run Playwright, real S3/ClamAV workflow, provider failure or independent package verification gates. |
| T14 Production/recovery | Partial; recovery script defects | Terraform, health endpoint and restore script exist. | Restore script uses audit column names inconsistent with schema and `pg_tables.forcerowsecurity`, which that view does not expose. It checks storage metadata but does not restore/retrieve and hash objects. Actual runtime roles, RTO/RPO, outage/load, dependency and deployment evidence remain unverified. |
| T15 Workspace/inbox/import | Partial foundations | Dashboard, project views and checklist import endpoint exist. | No complete actionable inbox, saved views, bounded cross-resource search or revisioned import draft/impact/commit workflow found. Asset import catches creation errors without reporting each failed commit row. Project UI remains composed around a large project page. |
| T16 Equipment/supplier workflow | Partial | Asset identity revisions, evidence revalidation records, passport query, scoped supplier grants and procurement/obligation tables exist. | Complete installed-unit allocation, supplier documentary stages, persistent comment closure, QR revocation and passport UX/identity-impact acceptance not demonstrated. Tables alone do not deliver these workflows. |
| T17 Inspections/commissioning | Not found as specified | Ordinary uploaded test/calibration documents and companion evidence provide limited foundations. | No structured inspection/test-run/reading/instrument/calibration-at-test module found. Templates, hold/witness points and retest workflow remain future work. |
| T18 Acceptance/aftercare | Partial | Recipient responses, warranty events, defects and evidence-required closure exist. | Full sectional acceptance/exceptions, training/spares receipts, separate contractual DLP clocks and independently verified remedy closure not demonstrated. Aftercare is still owned by the billing module. |
| T19 Commercial readiness | Partial | RA evidence packs, commercial closeout summary and contract/retention fields exist. | No complete tranche/application/certification/payment-receipt ledger found. `NotificationsService.getOwnerDigest` still defaults missing commercial data to INR 15,000,000 and 5%, which invents financial inputs. |
| T20 Assistive AI/experiments | Not found; deliberately future gated | No proposal-only AI module found. | Permission, labelled evaluation, source-cited proposals, human dispositions and spend/isolation gates remain. This is future scope, not a present pilot blocker. Do not implement SOL's explicit NO items to claim full coverage. |

## Concrete unresolved items to address first

1. **Real identity delivery:** implement selected mail/SMS providers and delivery lifecycle in `apps/api/src/modules/identity/identity.module.ts` and notification processing. Merely configuring credentials cannot make the current throwing methods send messages.
2. **Qualification after equipment changes:** make readiness/package selection respect pending evidence revalidation and pin qualified evidence to the relevant requirement and asset identity. Relevant files: `assets/assets.service.ts`, `handover/handover.service.ts`, review services and schema.
3. **Atomic command outcome:** put retry receipt and mutation outcome in one transaction, or introduce a durable command/reconciliation design. Awaiting a separate receipt write does not eliminate the crash window.
4. **Explicit external projections:** replace denylist serialization with endpoint DTO allowlists and prove the role/resource matrix.
5. **Portable export:** build an archive containing actual immutable files plus manifest and verifier; the existing manifest receipt is explicitly incomplete for T09.
6. **Repair recovery verification before relying on it:** use schema audit fields `chain_seq`, `hash`, `prev_hash` and `pg_class.relforcerowsecurity`; recompute hashes, compare expected counts and restore/verify real storage objects. Avoid claiming a recovery drill passed from metadata checks alone.
7. **Release evidence:** real upload → scan → review → package → download → recipient response tests, upgrade migration tests and browser negative-boundary flows.

## SOL roadmap cross-check

The SOL roadmap contains required, differentiating, validate-first, future and explicitly excluded items; implementing every row would violate its scope.

| SOL ranked items | Current coverage |
|---|---|
| 1 Simulated success | Multiple important surfaces repaired or disabled, including provider success claims and unsupported bulk import. Continue route/UI audit; containment does not deliver replacement workflows. |
| 2 Schema/duplicate simplification | Partial: ledger hardening and migrations exist; duplicate decision logic and billing/aftercare coupling remain. |
| 3 Real delivery | Missing provider implementation. |
| 4 Import-first onboarding | Partial: existing checklist import and asset import; controlled revisioned baseline workflow incomplete. |
| 5 Supplier request page | Partial: guest page, scope and uploads exist; complete request/reminder/receipt loop unproven. |
| 6 Inbox/Today/status vocabulary | Partial dashboard/UI foundations; full actionable inbox not found. |
| 7 Mobile shell/offline sync | Partial PWA/queue foundations; full assigned-data/offline acceptance unproven. |
| 8 Handover builder | Partial: real compiler, snapshots and responses; complete templates/acceptance UX unproven. |
| 9 Warranty/DLP clocks | Partial warranty implementation; full independent DLP scope incomplete. |
| 10 Equipment passport | Partial backend passport and identity revision foundations. |
| 11–12 Decision intake/waiting ledger | No complete email/WhatsApp decision ingestion or delay evidence pack workflow found. |
| 13 Money gates | Partial summaries; clause/tranche/receipt workflow incomplete. |
| 14 Inspection requests | Structured hold-point workflow not found. |
| 15 MAR/delivery/MIR | Procurement schema foundations; complete chain not demonstrated. |
| 16 Approved-make guard | No completed dedicated workflow verified in this review. |
| 17 Structured tests/calibration | Not found as specified. |
| 18 Snag/DLP desk | Partial defect/warranty functionality. |
| 19 Equipment QR | Complete revocable client-FM workflow not demonstrated. |
| 20 Portfolio analytics | Dashboard counts exist; supplier/consultant cycle/rejection analytics not demonstrated. |
| 21 File-to-deliverable suggestions | Asset matching foundations; complete suggestion/disposition workflow not demonstrated. |
| 22 RA bill support | Evidence pack exists; validated full billing-cycle acceptance unproven. |
| 23 Variation trail | Some domain/schema foundations; complete decision-linked evidence workflow not demonstrated. |
| 24–25 OCR/serial/clause extraction | Proposal/evaluation workflows not found; validation/future gates apply. |
| 26 Archive export | Manifest only; portable archive absent. |
| 27 Supplier scorecards | Complete workflow not demonstrated; future scope. |
| 28 Field languages | Complete translated field workflow not demonstrated. |
| 29–31 Explicit NO scope | Exclusions, not missing features to build. Some existing billing/signature modules should be assessed for containment/scope reduction. |

## Interpretation

No percentage is assigned: a schema table, mocked test and usable end-to-end feature are different levels of completion. T01–T14 remain release gates until their concrete acceptance evidence is available. T15/T16 require the MVP subsets defined in the final roadmap; T17–T20 and several SOL differentiators are intentionally later work. Findings should be closed against tested boundaries and an identifiable code revision rather than against source comments or this report alone.
