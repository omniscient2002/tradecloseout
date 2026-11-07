# Production review and implementation instructions — 2026-11-07

## Decision

The project has useful working closeout foundations, but current code still has production correctness and workflow gaps. This pass found additional concrete cases beyond the earlier FV01–FV08 fixes. Production readiness should be earned through explicit release gates; neither the old defect list nor a passing unit suite establishes an issue-free application.

This is an engineering review of the current working tree, including uncommitted work. It covers API/authorization, database/migrations, worker/scheduling/storage, web/offline behavior, domain workflows, tests, CI and recovery tooling. It is not a certification of every branch, deployment, customer workflow or external provider. Existing earlier reports remain historical evidence. Findings below distinguish **DB reproduction**, **source-confirmed contract gap**, and **operational acceptance still required**. Severity expresses release priority, not a claim of demonstrated exploitation.

No application source was modified by this review. Synthetic probes used newly created disposable databases, the restricted application role and freshly built API services. No real messages were sent. See [evidence and completion-time source hashes](TRADECLOSEOUT_FULL_PRODUCTION_REVIEW_EVIDENCE_2026-11-07.json), [replay harness](evidence/production-review-2026-11-07/replay-probes.ts) and [observed results](evidence/production-review-2026-11-07/probe-results.jsonl). The harness uses this checkout's absolute path, builds from API dist, and requires the existing disposable-test PostgreSQL credentials; run with `node --import tsx docs/evidence/production-review-2026-11-07/replay-probes.ts` after building packages and API. The notification probe runs only during actual India quiet hours.

## Verification performed

- `pnpm typecheck`: passed.
- `pnpm --filter @tradecloseout/api build`: passed.
- Root `pnpm test`, with host access for test services: DB 10 tests passed; shared 44 passed; archive browser 6 passed; three PDF scripted checks passed. API: **24 suites passed, 1 failed; 212 tests passed, 1 failed**.
- Root failure: `contractor-user-journey.spec.ts`, PostgreSQL `57P01`, “terminating connection due to administrator command.” Its isolated rerun **passed, 1/1**. Treat this as an intermittent integration/test-lifecycle failure until traced; the available output does not prove an application bug or its exact cause.
- The worker suite was invoked separately because the root run stopped at the API failure: **13/13 passed**.
- Additional service/PostgreSQL probes reproduced witness identity acceptance, empty seasonal completion, negative flow persistence, unchanged effective warranty after an extension, fabricated subscription fallback and notification starvation.
- Full application Playwright journeys, actual vendor storage/ClamAV/provider acceptance, installed-qpdf acceptance, production build/deploy, fault/load testing and object-byte restore were not certified in this pass. The journey test uses programmable storage/scanner protocol fixtures; that is valuable integration coverage, not proof of real vendor operation.
- No current dependency advisory rescan was performed. Prior advisory dispositions need fresh verification before release; this report does not assert that historical advisory versions remain current.

## Priority register

| ID | Priority | Area | Evidence |
|---|---|---|---|
| NP01 | P1 | Witness identity and delegated authority are not established | DB reproduction + source |
| NP02 | P1 | Seasonal lifecycle is not exposed; service allows empty completion | Route inventory + DB reproduction |
| NP03 | P1 | Confirmed warranty extension does not change effective asset dates | DB reproduction |
| NP04 | P1 | Subscription lookup bypasses tenant transaction and manufactures ACTIVE fallback | DB reproduction + source |
| NP05 | P1 | Work-item commands contain unregistered paths and incomplete action contracts | Source route comparison |
| NP06 | P2 | Quiet-hour/dead-first notification batches starve eligible notifications | DB reproduction |
| NP07 | P1 | Offline upload ownership, recovery and processing are incomplete | Source |
| NP08 | P1 | Upload cleanup deletes versions without reconciling document pointers/provider sessions | Source |
| NP09 | P2 | Commissioning measurement validation accepts invalid input | DB reproduction + source |
| NP10 | P1 | Ordinary review commands do not enforce client revision preconditions | Source |
| NP11 | P1 | Billing commands retain divergent calculations and unavailable-provider semantics | Source |
| NP12 | P1 | Durable command and execution outcomes remain incomplete | Source; existing PA14/17 |
| NP13 | P1 | Production boot/readiness/resource/recovery gates remain incomplete | Source; existing PA18–23/32 |
| NP14 | P1 | CI and integration evidence do not cover the actual production journey reliably | Executed tests + source |

## NP01 — Establish who actually witnessed an inspection

**Sources:** `apps/api/src/modules/commissioning/commissioning.controller.ts:48`, `commissioning.service.ts:378`.

The witness route requires `document.upload`. The service checks nonempty names and a role string, optionally checks a party exists, and appends a witness with the current user ID. It does not establish that the user represents the named party, is an appointed witness, or can sign for the claimed representative. It also accepts witness lists on inspection creation. Required-party completion, immutable sign-off revisions and independent verifier policy are absent.

**Observed:** the same synthetic actor that recorded the inspection successfully signed as “Unverified synthetic consultant”, representative “Someone else”, role `CONSULTANT`, with no party/delegation record. The real actor ID is retained, so this is unverified representation, not impersonation of the underlying session ID.

**Implement:** distinguish recorded attendance from authenticated attestation. Persist required witness appointments with tenant/project/party/user, permitted stage, delegation and validity. A sign command resolves the appointment from the authenticated actor; derive identity fields server-side. Bind signature to immutable inspection/run revision and decision. External attendance captured by a contractor must say “recorded by”, and require independent confirmation before satisfying a mandatory witness. Define withdrawal/correction history and duplicate handling.

**Acceptance:** unauthorized uploader, invented party/role, foreign project, expired delegation and stale run reject; appointed witness signs the exact revision; edits require renewed signatures; concurrent duplicate requests create one attestation. Test through HTTP as well as the service.

## NP02 — Finish seasonal commissioning as a usable lifecycle

**Sources:** `commissioning.controller.ts:60`, `commissioning.service.ts:546`; web source has no connected seasonal workflow.

The controller offers creation/listing but no route for `updateSeasonalSchedule`. That method exists and is directly called in tests. It accepts `COMPLETED` as `PERFORMED` without requiring results or qualified evidence, allows arbitrary transitions between mapped statuses, and retains a previous completion timestamp when moving back to scheduled/deferred. This method is currently a latent service weakness, not a demonstrated public completion endpoint.

**Observed:** a new schedule followed by `{status:'COMPLETED'}` persisted `PERFORMED` with `testResults:null`.

**Implement:** define separate planned visit, performed test and accepted result states. Expose a validated, permissioned API with mandatory expected revision and stable command ID. Require configured procedure/run results and evidence for performance, independent acceptance where required, and authorized reason/next date for deferral or waiver. Preserve history rather than recycling completion timestamps. Connect project/equipment work items, ownership, due-date reminders and a field-friendly screen.

**Acceptance:** empty completion fails; a valid result can be recorded and reviewed from UI; stale transitions reject; waiver permissions and deferral obligations hold; reopening preserves historical completion separately from current state.

## NP03 — Reconcile warranty events into effective coverage

**Source:** `apps/api/src/modules/billing/warranty-and-billing.service.ts:23`, especially asset update near line 94.

All nonconflicting event types use `COALESCE(warranty_start, new_start)` / `COALESCE(warranty_end, new_end)`. Once an asset has dates, a later `EXTENSION` can be `CONFIRMED` without changing effective coverage. Conversely, a `CLAIM` can initialize missing coverage dates through the same generic path. A supplied evidence object is not qualified here before confirming the event. Matching basis alone does not establish event authority or coverage.

**Observed:** registration through 2027-11-07 followed by a same-basis extension through 2028-11-07 returned `CONFIRMED`, while `assets.warranty_end` stayed at 2027-11-07 (the JSON timestamp is previous-day UTC because PostgreSQL DATE parsing uses the local zone).

**Implement:** make coverage derivation event-type-aware. Store proposed, verified, disputed and superseded changes with source proof, scope, effective dates and authority. Extension modifies the effective end only after its defined verification; a claim does not itself create coverage. Rebuild asset/read-model dates from authoritative events, preserving the contracted basis and disputes. Validate real dates and exact evidence version/project/asset. Provide correction and conflict resolution commands.

**Acceptance:** registration, extension, duplicate/replayed extension, shortened correction, conflicting basis, claim-only record and concurrent changes produce consistent asset/passport/warranty views. Test exact calendar dates independent of server timezone.

## NP04 — Stop manufacturing subscription state

**Source:** `warranty-and-billing.service.ts:539`.

`getSubscription` uses `pool.query` directly instead of binding tenant RLS context. For forced-RLS tenant tables, a real subscription can therefore be invisible. If no row is returned it invents an ACTIVE Growth subscription, price, limits and a new UUID. This also misrepresents an organisation with no subscription. Returned persisted rows use snake_case while the fallback uses camelCase; `||` defaults overwrite legitimate zero limits.

**Observed:** an organisation with no subscription returned `status:'ACTIVE'`, Growth pricing and quotas with a synthetic ID.

**Implement:** query within the tenant unit of work; return a stable explicit absent/unconfigured state. Use one response DTO for every branch and derive entitlements from persisted plan/subscription policy. Preserve zero with null-aware defaults. If trials are a product decision, create a real trial record with expiry and audit; never infer a paid plan from an empty query.

**Acceptance:** restricted-role lookup sees only its real tenant subscription; absent, expired, suspended and zero-limit plans render correctly; no fabricated IDs or prices; UI and server enforcement use the same entitlements.

## NP05 — Make every work-item action executable and authorized

**Source:** `apps/api/src/modules/work-items/work-items.service.ts:84–193`; compare checklist/assets/review controllers.

The waiver action uses `/projects/:projectId/checklists/waivers/:waiverId/countersign`, while the registered command is `/api/v1/waivers/:id/countersign` (plus other aliases). Supplier obligation `/intake` has no matching implementation in the API inventory. Action paths omit the API prefix. Reviews report `version_no` as entityVersion, which is not an optimistic row version. Queue construction gates project visibility but does not select actions by actual review assignment or independent defect verifier eligibility.

These are broken action contracts even though the current web UI does not yet consume this queue as a full action desk.

**Implement:** return stable action identifiers, canonical versioned route, required payload/precondition schema and authority/disabled reason. Build a typed command registry shared by route generation and queue projection. Query the actual review assignment and independent verifier policy. Provide the missing supplier intake domain command with verified evidence and audit, or expose a waiting-only item until that exists.

**Acceptance:** obtain one item of each type from actual fixtures, execute its advertised command as the intended user, verify state/audit; stale versions reject, unauthorized users see a truthful waiting state, all paths resolve. Do not only snapshot strings.

## NP06 — Prevent notification starvation

**Source:** `apps/worker/src/scheduler.ts:410`.

The dispatcher selects the oldest 25 QUEUED rows and applies quiet-hour filtering afterward. When those rows are SMS/WhatsApp during quiet hours, it repeatedly selects and skips them; an eligible email or IN_APP row behind them cannot progress. Repeated gateway failures can similarly monopolize the oldest batch because there is no next-attempt schedule or terminal disposition.

**Observed during India quiet hours:** 25 older synthetic SMS rows followed by an IN_APP row; dispatch returned zero and the IN_APP row remained QUEUED. No external gateway or messages were used.

**Implement:** apply delivery eligibility/next-attempt time in the selection query before LIMIT. Persist retry attempts, next_attempt_at, failure class and terminal/operator state. Give channels fair batches. Claim rows in a short transaction, deliver outside long DB locks using a stable provider key, then reconcile acknowledgement. Keep gateway deduplication across crash/retry.

**Acceptance:** 25 deferred SMS rows do not block email/IN_APP; poison notifications do not starve later rows; retries back off; quiet boundaries use India time; multiple workers and provider-ack/DB-commit failure never duplicate an accepted notification.

## NP07 — Finish offline recovery and account ownership

**Sources:** `apps/web/src/lib/offline-upload-queue.ts`, `api-client.ts`, `components/pwa-register.tsx`, `public/sw.js`.

Persisted part URLs are reused without calling the existing refresh endpoint after expiry. Multiple tabs/calls can drain the same item concurrently. The actor partition is checked only before asynchronous work; account/guest changes while awaiting storage/network are not fenced before later authenticated calls. A PROCESSING item returns to completion submission on another drain instead of having a distinct status-only reconciliation path. Background sync only messages open windows, so it cannot upload by itself when no page is open. The shell currently caches login/manifest/static chunks, not the full authenticated field-capture journey.

**Implement:** persist a queue state machine with an exclusive lease/Web Lock and heartbeat. Resolve the actual session actor, freeze it for the job and recheck at every authenticated phase; cancel/block on actor change. Persist expiry and refresh only missing parts using the same upload intent. Reconcile completion unknown outcomes and poll verification separately from transport. Show per-item queued/blocked/uploading/processing/failed states and manual retry/export/discard. Define explicitly whether first-load/closed-app offline capture is supported; implement and test the chosen promise.

**Acceptance:** two tabs, sign-out/sign-in mid-upload, guest revocation, browser restart, 403 expired URL, partial multipart completion, lost complete response, slow scan, no active window and storage quota exhaustion. Prove no evidence is attributed to a different actor and no local bytes disappear before an authoritative receipt.

## NP08 — Reconcile upload expiry instead of deleting referenced history

**Sources:** `apps/worker/src/scheduler.ts:322`, `documents.service.ts` upload-intent creation; `packages/db/migrations/0000_complete_v021_schema_and_rls.sql` document pointers.

Cleanup deletes PENDING_UPLOAD versions older than 24 hours and unattached pending storage rows. It does not repair `documents.latest_version_id`, whose initial schema field has no reference constraint, nor abort provider multipart sessions. Offline queue intent lifetime and the 168-hour idempotency receipt lifetime are not reconciled with this 24-hour deletion. This leaves a source-confirmed dangling-pointer/provider-cleanup risk; a complete runtime reproduction was not run in this pass.

**Implement:** retain terminal EXPIRED/ABORTED intent records with reason and command outcome. In one transaction, expire the lease and reconcile latest eligible version under parent locking. Enqueue idempotent provider abort/object cleanup and reconcile it separately. Define matching receipt/draft expiry and a recoverable replacement operation; never replay an expired receipt as a usable upload target. Add appropriate pointer constraints after repairing existing rows.

**Acceptance:** expire initial upload and replacement upload; document detail/download/review stays consistent; provider uploads are eventually aborted; a week-old offline draft gets a clear resumable-or-expired outcome. Race cleanup against completion and prove exactly one valid result.

## NP09 — Use executable measurement contracts

**Source:** `commissioning.service.ts:53`; controller input types are erased interfaces.

The service error text says positive design and actual flow are required, but actualFlow is not checked for positivity and finite-number checks are absent. Unit checks special-case AIR_SIDE and WATER_SIDE; the other allowed system types do not receive equivalent dimensional policy. Readings/metadata lack bounded nested DTO validation. Nonpositive readings may represent a legitimate engineering observation, but must be deliberately classified, not accidentally accepted as ordinary measurements.

**Observed:** a WATER_SIDE reading with design 100 and actual -10 persisted as NEEDS_REBALANCING. It was not incorrectly marked compliant; the defect is the inconsistent input contract and unqualified measurement semantics.

**Implement:** define finite bounded measurement schemas per procedure/system/unit. Explicitly support zero/reverse-flow observations with direction and failure interpretation where appropriate; otherwise reject them. Do not hard-code a generic tolerance as a claim of engineer-approved acceptance. Bind instrument/calibration, procedure revision, conditions, operator and immutable result/evidence. Validate malformed arrays, enum, date, UUID and size before opening a transaction.

**Acceptance:** negative/zero/nonfinite/overflow values, unit mismatch, unknown system, null reading, oversized set and tolerance boundaries; an engineer-reviewed valid measurement remains accepted. Verify HTTP returns structured validation errors rather than SQL exceptions.

## NP10 — Enforce review preconditions across every public alias

**Sources:** `reviews.controller.ts:59–118`, `dto/decide-review.dto.ts`, `reviews.service.ts:509–790`; compare the stricter external-approval command and separate `review-decision.service.ts`.

Ordinary decisions lock server rows and check assignment, but do not consume an expected row version/If-Match from the user's displayed version. A row lock serializes writes; it does not prove that the reviewer saw the current metadata/evidence/obligation revision. The API client can send If-Match, but these handlers do not enforce it. Separate review implementations preserve different policies. The canonical DTO validates decision values, so its fallback-to-APPROVE expression alone is not evidence that arbitrary HTTP decisions approve documents; do not report that false positive.

**Implement:** route every decision through one command with explicit version, evidence/requirement revision, assignment, valid predecessor state and independent authority. Mandatory preconditions must be enforced consistently for every supported alias and bulk action. Retire unused alternative executors or make them delegate to the same policy. Derive every readiness/projection from the same qualified decision.

**Acceptance:** reviewer opens revision N, another command changes relevant state to N+1, old decision rejects without effects. Test approve/reject/change requests, assignment changes, metadata changes, new uploads, shared requirements and alternate endpoints. Test actual HTTP header-to-domain propagation.

## NP11 — Unify billing commands and provider capability states

**Sources:** `billing.service.ts:89`, `gst-einvoice-tds.service.ts:33`, `billing.controller.ts`, `billing.module.ts`.

Two live invoice paths implement distinct policies: the basic path hardcodes tax and count-plus-random numbering; the alternate path uses configured rates/sequences. Inline DTOs permit invalid money/section inputs to reach BigInt/SQL. The configured-invoice path emits ISSUED/NOT_APPLICABLE if e-invoicing is enabled but the optional GSP client is absent. No provider is wired in the module. This is a software state/configuration inconsistency; this review does not certify tax treatment or statutory requirements.

**Implement:** consolidate invoice issuance into one validated money/date/numbering command, with authorized immutable tax configuration and subscription ownership. Use a deliberate unavailable/pending provider state when a required configured integration is missing. Put external issuance behind stable operation IDs and durable reconciliation, outside long-held financial sequence transactions. Keep SaaS invoices separate from contractor commercial applications. Disabled payment/signature endpoints are explicit missing integrations, not successful implementation.

**Acceptance:** both aliases yield identical calculations and state; unsafe integers/fractions/negative/overflow amounts reject; concurrent numbering remains unique; missing configured provider cannot report an exempt/successful result; provider success followed by DB failure reconciles without duplicate issuance. Obtain appropriate domain review for commercial/tax policy.

## NP12 — Complete durable command and job foundations

**Sources:** `common/interceptors/idempotency.interceptor.ts`, `packages/db/src/tenant-tx.ts`, `apps/worker/src/main.ts`.

The interceptor commits the claim, business effects and response receipt separately. Unknown outcomes remain unreconciled; handler exceptions can remove a pending claim without proving no effect committed. Several writes lack mandatory idempotency. Worker outbox enqueue is acknowledged before durable execution completion, and exhausted dispatch attempts disappear from the normal query. Redis loss after dispatch is not a recovered execution. Audit coverage still depends on each command explicitly emitting; using a helper does not guarantee event completeness.

**Implement:** a DB command ledger and single unit of work for effects/audit/outbox/outcome. Use canonical actor/resource/request identity and explicit running/succeeded/rejected/unknown states. Add DB-backed logical job executions, leases/fencing tokens, terminal error details, retry/reconcile operator commands and queue regeneration. Inventory events by material command. Preserve existing passing generation/idempotency regressions.

**Acceptance:** process death at every commit/enqueue boundary, Redis reset, duplicate delivery, result persistence failure, poison event and shutdown. Each accepted command eventually has one correct outcome or an actionable visible failure; no silent stuck PROCESSING and no duplicate business effect.

## NP13 — Prove the deployment can operate and recover

**Sources:** `packages/shared/src/env.ts`, API/worker boot files, health controller, artifact processors, Terraform, `scripts/run-restore-drill.sh`.

The environment schema is not consistently called at boot and its S3 variable vocabulary differs from adapters. Health mainly checks DB SELECT 1; it does not establish runtime role safety, migrations, Redis, required scanner/storage versioning/provider/tool availability. Streaming byte ceilings are useful but do not guarantee whole-job transfer deadlines, aggregate disk/memory/decompression/parser budgets. Post-parse PDF object counting does not bound resources already used. Restore checks metadata and audit; independently restored object bytes and downloadable artifact recovery still need proof.

**Implement:** one runtime config schema per process with capability-aware fail-fast validation and secret-safe errors. Separate liveness/readiness; validate nonprivileged DB role and compatible schema, storage versioning/access, Redis, scanner/tool capabilities. Package actual supported tools and isolate untrusted parsers with process memory/time/temp limits and tenant concurrency budgets. Build release/migration/rollback runbooks. Instrument request/command/job IDs, errors, queue age, retries and saturation with owned alerts. Restore DB plus exact object versions into isolation and hash/download them independently.

**Acceptance:** misconfiguration fails startup clearly; dependency failures make readiness truthful; no READY artifact after exhausted resource checks; dependency/process/Redis faults recover; restored files match hashes and can be downloaded by authorized users. Record workload envelope and measured p95/p99, resource saturation, tenant fairness, RPO/RTO against chosen targets.

## NP14 — Make tests prove the release contract

**Sources:** `.github/workflows/deploy.yml`, `apps/web/playwright.config.ts`, `e2e/critical-flows.spec.ts`, journey and worker fixtures.

CI runs the archive verifier browser project, not the full application project. Current application tests cover unauthenticated redirect and a development OTP portfolio login with hardcoded localhost URLs/seeded company facts. They do not cover the complete contractor workflow. The integration journey is useful, but directly invokes services with programmable scanner/storage fixtures. The root run in this review failed once with DB termination and passed when that one test ran alone; green isolated execution does not close intermittent release reliability.

**Implement:** diagnose the test lifecycle: close all pools/service connections, settle asynchronous work, isolate global env and ensure teardown completes before disposable database removal. Retain the failure trace and establish the exact cause rather than increasing retries. Add an application CI job that starts the actual API/web/worker and isolated fixtures. Use configured baseURL and fixture IDs. Add separate acceptance against real supported storage/scanner/tool images. Retain failure screenshots, traces, correlated logs and artifact hashes.

**Acceptance:** repeated targeted regression plus a full clean root run after fixing the root cause; real HTTP upload/multipart/scan/review/transmittal/package/download/recipient-acceptance browser journey; cross-tenant/role negatives; field offline and multi-tab cases; no debug OTP dependency in a production-mode auth acceptance test. Increase tests by risk coverage, not by mirroring internal functions.

## Remaining product delivery areas

These extend existing partial foundations; do not rebuild already working closeout functionality indiscriminately.

| Area | Deliverable for a contractor | Required proof |
|---|---|---|
| Imports and baselines | Persist reviewed spreadsheet mapping/preview, source hash, row provenance, baseline revision and atomic commit | Duplicate/partial/stale/cross-project import and retry; exact reviewed rows committed |
| Procurement | Receipt/lot/serial inspection, accepted/rejected quantities, substitutions and installed-unit allocations connected to supplier obligations | Partial delivery, wrong make/model, rejected lot, split allocation and replacement |
| Quality/TAB | Approved procedure/run revisions, calibrated instruments, witness appointments, deviations/retest and accepted result | Failure/retest replaces only the appropriate result; changed plant invalidates affected qualification |
| Handover | Section/system/asset-scoped acceptance, exception lineage and immutable package/download proof | Partial acceptance does not close unrelated work; withdrawn evidence remains visible historically |
| Aftercare | Effective warranty basis, coverage changes, defect assignment/SLA, remedy and independent closure, seasonal return visits | Registration/extension/claim/dispute and evidence-backed closure are consistent across views |
| Commercial | Evidence-backed retention/RA applications with contract-specific rules and review | Incomplete/deferred/disputed scope is shown honestly; no invented amounts/payment success |
| Daily workspace | Real authorized work desk, search, equipment history and next responsible action; mobile capture | All action links work, permission projection holds, failures are visible and keyboard/mobile flows succeed |

## Implementation sequence for the next agent

1. **Establish a trustworthy baseline.** Preserve all uncommitted work; capture source fingerprints. Reproduce NP01–06 with the retained harness and add regression cases around actual HTTP contracts. Diagnose the intermittent journey failure. Keep FV01–FV08 passing.
2. **Repair false business outcomes.** Deliver NP01/03/04/11: authenticated witness policy, effective warranty events, real subscription DTOs and one truthful billing capability contract. Include existing-row repair/backfill reports before adding constraints.
3. **Deliver usable domain commands.** NP02/05/09/10: typed validated seasonal/review/measurement/action contracts with expected revisions and one authority policy. Build the connected UI in the same slices. Require positive and negative HTTP tests per route.
4. **Make work recoverable.** NP07/08/12 plus notification scheduling: command/execution ledger, provider reconciliation, upload expiry, offline leases and operator recovery. Add crash-injection tests at transaction boundaries, then process-level tests.
5. **Enforce production operations.** NP13/14: config/readiness, supported images and parser budgets, actual application CI, dependency remediation verified against current advisories, restore/load/failure gates. Release first to a limited pilot only after the relevant gates pass.
6. **Deepen contractor capabilities.** Implement the product table above in coherent slices with contractor-reviewed examples, migration/API/UI ownership and acceptance artifacts. Collect task-completion evidence from representative field devices, including intermittent connectivity.

For each slice, the implementation handoff must contain: changed schema/API/UI, backward compatibility and data repair, permission/tenant model, invariant and regression tests, failure/recovery behavior, exact checks executed, and any unverified integration. Do not close a work package because a table/method/comment exists. Do not replace an observed error with sample success.

## Release gates

**Trust gate:** tenant/role/delegation/revision checks, independent review, qualified immutable evidence and truthful financial/capability states.

**Recovery gate:** durable command/job outcomes; upload and offline reconciliation; dependency/process/Redis failure with visible terminal states; tested DB/object recovery.

**Workflow gate:** a contractor and external reviewer can complete the actual browser-to-storage-to-worker-to-package-to-acceptance journey, including rejection, correction, partial delivery, defect remedy and seasonal follow-up.

**Operations gate:** reproducible images, startup/readiness, migration/rollback, real supported integrations, current dependency disposition, monitored workload and practiced runbooks. Set explicit capacity and recovery targets, then record evidence against them.

The production target is achievable through these gates. The current evidence supports further implementation and validation, not a claim that no issues remain.
