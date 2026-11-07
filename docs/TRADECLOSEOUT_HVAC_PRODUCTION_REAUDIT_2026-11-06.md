# TradeCloseout: full-project HVAC product and production re-audit

Review date: 2026-11-06, Asia/Kolkata. Scope: the current uncommitted working tree. Target: an exceptionally useful, dependable product for HVAC contractors, from technical submissions through installation, commissioning, handover and aftercare.

## 1. Decision and intended product level

Treat the user's ambition as the product target: make TradeCloseout the contractor's daily system for getting HVAC work documented, verified, accepted and commercially ready. The present code provides a useful foundation: tenant transactions, grants, versioned uploads, review controls, equipment history, PDF compilation, archives and stronger regression tests. It has not yet demonstrated the complete production acceptance gate described below. That is a delivery-stage assessment, not a recommendation to abandon or shrink the ambition.

The immediate objective is to prove a complete contractor–supplier–reviewer–client return cycle under production-like infrastructure. The longer objective is to make that cycle faster and more reliable than the contractor's parallel Excel, WhatsApp, email and folder bookkeeping. A claim to be the best requires observed customer outcomes and comparisons; source code and test counts alone cannot establish it.

This pass creates analysis and implementation instructions. It does not change application code, apply customer migrations, deploy infrastructure or contact customers.

Read the companion [agent implementation plan](TRADECLOSEOUT_HVAC_EXCELLENCE_AGENT_PLAN.md) for executable work packages. The [281-case testing guide](TRADECLOSEOUT_EXTENSIVE_TEST_IMPLEMENTATION_GUIDE.md) remains the test catalogue; it is not a completion claim. The [source manifest](TRADECLOSEOUT_REAUDIT_SOURCE_MANIFEST_2026-11-06.json) records 199 source/configuration fingerprints and the Git HEAD to identify this dirty-tree baseline. Later source changes require rechecking affected findings.

## 2. Evidence and verification

### Current execution results

| Check | Observed result |
|---|---|
| `pnpm typecheck` | Passed. |
| Initial root `pnpm test` | Initially failed: 22 API suites, 149 tests passed / 2 failed. Both affected files changed during the review; targeted rerun then passed 2 suites / 14 tests. Final full-run result is recorded below. |
| Final root `pnpm test` | Passed across all six packages: API 22 suites / 151 tests; shared 4 suites / 44 tests; eight DB and ten worker behavioral subtests; six browser cases; three scripted PDF checks. |
| New contractor journey | Initially failed with `REVIEW_ASSIGNMENT_REQUIRED`; the updated fixture creates persisted assignments and now passes. It still uses direct services and manually applies scan status. |
| Existing phase-0 recipient test | Initially failed with `SUBMISSION_NOT_FOUND`; its updated SQL-shaped mock now passes. Real recipient/authority coverage remains required. |
| DB lane in root run | Eight behavioral subtests passed; Node counts nine including parent. Fresh versus 0005-upgrade convergence, ledger checks and RLS/audit cases were exercised. |
| Shared lane | Four suites, 44 tests passed. |
| Archive browser lane | Six Chromium tests passed using local extracted files while offline. |
| PDF lane | Three existing scripted checks passed. |
| Worker lane | Passed separately: ten behavioral subtests, eleven Node tests including the parent. Uses real PostgreSQL/Redis and programmable storage/delivery protocol fixtures. |
| Clean worker emit into `/tmp/tradecloseout-worker-audit` | Emits `apps/worker/src/main.js` under that directory. The package start command points to `dist/main.js`; a stale file currently masks the clean-build mismatch. |

No live customer deployment, real provider delivery, real ClamAV engine, AWS storage acceptance, process-kill matrix, recovery drill or measured customer adoption was verified. Do not describe these as tested by the new journey: it constructs services directly, uses a programmable S3 endpoint and TCP scanner fixture, and manually applies scan status to database rows. Those are useful integration boundaries, but they omit HTTP guards, browser interaction, actual queue dispatch/persistence and genuine malware engine behavior.

### Scope of review

Inspected API bootstrap, guards, projections, database wrappers, identity, organisations, projects, checklists, assets, documents, reviews, handover, billing/aftercare, notifications, signatures, workers, storage/PDF/archive code, migrations/schema, web navigation/project/guest/upload flows, offline storage, CI, Terraform and restore scripts. Existing product/architecture/roadmap documents were compared rather than assumed implemented. Some findings below are source-established behavior; risks explicitly need a focused reproduction or deployment evidence.

## 3. Progress that should be preserved

- File verification and business review are separate; ordinary review cannot legitimately create a scanned object.
- External grants carry scope, session/logout safeguards exist, and the assignment requirement prevents deciding an unassigned review.
- File and package jobs carry tenant context; uploads and archive sources increasingly pin provider versions and hashes.
- Archive compilation now rejects missing/corrupt sources, verifies output readback and records artifact identity. Offline verification hashes actual bytes and avoids title markup injection.
- Cleanup retains unresolved command claims; tests prove one receipt-failure/replay boundary. This closes the dangerous time-based deletion regression, although a complete transactional command model remains unfinished.
- Migration ledger serialization/checksums, forward migrations 0014/0015, disposable fixtures and real Redis lock checks are present.
- Readiness now excludes pending/mismatched revalidation. The old claim that it entirely ignores revalidation is out of date. The remaining defect concerns the scope of that exclusion, described below.
- Asset import now reports failed rows; the older silent-error report is out of date. Controlled preview/commit semantics remain incomplete.
- Owner digest no longer unconditionally invents a contract value; precision and zero-value behavior still need repair.
- Projection code now has resource allowlists. It still uses shape detection, fallback field filtering and unrestricted nested metadata, so endpoint contracts are not complete.

## 4. Findings register: what to fix or investigate now

Classification: **Confirmed** means inspected source establishes the behavior; it does not imply a live exploit. **Observed** means a command in this pass demonstrated it. **Risk** means the boundary requires an explicit reproduction or deployment check. Severity is engineering priority for this product, not a formal security score. `N` IDs are new-pass IDs; retain the old TC-F and R identifiers as history.

### N01 — Observed and corrected during review: regression fixture failures; end-to-end evidence remains partial

Evidence: `apps/api/test/contractor-user-journey.spec.ts`, `apps/api/test/phase0-evidence-integrity-remediation.spec.ts`, `ReviewsService.recordVersionReview` and `HandoverService.recordRecipientSubmissionDecision`.

Initial reproduction: root tests failed because reviewer assignment was absent and another mock matched an older SQL shape. While reviewing, those files changed: persisted assignments were inserted in the fixture and the mock lookup was updated; targeted rerun passed both suites. Remaining action: drive assignment/submission through application commands with separate uploader/reviewer principals; convert recipient coverage to disposable real records. Then exercise the same journey through HTTP, queues and browser. Never auto-create an assignment during approval just to satisfy a fixture. Owner: XP00/XP08.

### N02 — Critical, reproduced Lua boundary: OTP aliases permit independent consumption

Evidence: `apps/api/src/modules/identity/identity.controller.ts`, `requestOtp` and `verifyOtp`. Issuance writes identical challenge payloads under opaque challenge ID and recipient identifier. Verification consumes only the selected key and its separate attempt key.

Boundary verification in this pass extracted the **actual verification Lua** from the controller and ran it against isolated Redis records representing the two issued aliases: first consumption returned `OK` and second consumption returned `OK`. The test keys were removed; no user sessions were created. This proves independent Lua consumption, not a completed browser exploit.

Reproduce in isolated Redis: request once, verify the correct code using challengeId, then verify the same code through identifier-only compatibility lookup. Both keys are independently consumable; failed-attempt limits are also split. Action: retain one authoritative challenge record and one atomic consume/attempt budget; compatibility references must resolve to that same record, not duplicate it. Bind challenge purpose, recipient and generation; revoke prior active generation on reissue. Test parallel mixed-alias verification and reissue/replay. Owner: XP01.

### N03 — High, confirmed: production can enable fake OTP delivery

Evidence: `apps/api/src/modules/identity/identity.module.ts`: `ENABLE_OUTBOX_DELIVERY === 'true'` enables no-op success without a staging/production exclusion. HTTP adapters also accept generic HTTP success without a provider-specific acceptance contract or explicit request deadline.

Reproduce: production-like environment, no actual provider, enable loopback and request OTP. Action: forbid loopback/debug adapters in production-like startup; implement explicit delivery contracts, timeouts, provider IDs, safe failure cleanup and callback validation. Test service boot plus actual issued challenge lifecycle. Owner: XP01/XP06.

### N04 — High, confirmed: archive download signs the wrong object

Evidence: `HandoverService.getArchiveExport` constructs `archives/{org}/{project}/{export}.zip`; `portable-archive.processor.ts` stores `archives/{org}/{project}/{export}/{unique-id}.zip` and records its provider version in `verification_receipt_json.artifact`.

Reproduce: compile a valid archive, request its export record, use returned URL. It signs a different key and omits the immutable version. Action: resolve the recorded artifact object inside the tenant transaction, validate READY/hash/size/receipt consistency and sign the exact bucket/key/version. Add a dedicated authorized download command/projection instead of exposing broad receipt metadata. Fix authorization before making downloads work for more roles. Owner: XP09/XP02.

### N05 — High, confirmed: payment webhook claims processing it never performs

Evidence: public `POST webhooks/razorpay` in billing controller delegates to `BillingService.handleRazorpayWebhook`, which does not verify the provided signature or persist/deduplicate provider events and returns `PROCESSED_IDEMPOTENTLY`.

Reproduce: send unsigned arbitrary JSON locally; response claims processed. No payment credit mutation was established in this review, so do not claim a proven monetary-credit exploit. Action: contain unused endpoint with explicit unavailable status, or implement raw-body HMAC verification, account/amount/currency checks and durable event inbox before acknowledging processing. Owner: XP03/XP22.

### N06 — Medium, confirmed: OTP rate-limit transport status is wrong

Evidence: `HttpExceptionWithRetry extends UnauthorizedException`; body includes status 429 but the actual exception status remains 401. Action: use an actual 429 exception/HTTP status plus Retry-After; do not rely on body.status. Test the wire response after exhausting a real rate budget. Owner: XP01/XP03.

### N07 — High, confirmed configuration inconsistency: API and worker resolve different DB settings

Evidence: `TenantDbService` builds the API pool from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD and does not read APP_DATABASE_URL. Worker and test helpers use APP_DATABASE_URL. API has production-capable local defaults without the same startup validation.

Reproduce: configure only APP_DATABASE_URL to a disposable remote database and inspect which database each process connects to. Action: one validated environment contract, separate migrator/runtime identities, required production connection configuration and safe readiness compatibility checks. Owner: XP03/XP10.

### N08 — High, confirmed policy split: actual guard omits richer state gates

Evidence: `PermissionGuard` uses `hasPermission`; shared `evaluateEffectivePermission` additionally considers project state and other invariants. Membership/resource inference is path-string based. Direct version/review routes also do not load projectRole as early as project-qualified routes.

Action: resolve resource/project first, load authority once, then evaluate the canonical action policy. Prove ACTIVE/SUSPENDED/CLOSED behavior through every mutation and direct service command. A unit test for an evaluator the HTTP route does not use is insufficient. Verify indirect-role false denials as well as over-broad grants. Owner: XP02.

### N09 — High, confirmed predicate: in-app notification listing includes other recipients

Evidence: `NotificationsService.listNotifications`: `(recipient_user_id = $2 OR channel = 'IN_APP')` exposes all in-app rows in the tenant irrespective of intended user, and lacks a project-membership predicate.

Reproduce: seed an A1 user's private IN_APP notification and read as a different A2-only member in the same tenant. Action: explicit recipient/audience and project visibility; tenant-wide announcements require a separate audience type. Test nested payloads and counts. Owner: XP02/XP06.

### N10 — High, confirmed authority mismatch: document readers may create notifications

Evidence: notification POST requires `document.read` and accepts caller-supplied channel, eventKey, payload and dedupKey. This is insufficient authority for external-channel messaging and could increase delivery cost or misleading event content.

Action: make domain events create normal notifications; use an explicit narrowly authorized announcement/reminder command with validated templates and recipients. Enforce per-tenant budgets and no arbitrary delivery payloads. Owner: XP02/XP06.

### N11 — High, confirmed missing service binding: recipient decisions trust caller target

Evidence: `recordRecipientSubmissionDecision` locks by org/submission, derives `targetProjectId = projectId || submission.project_id`, and updates recipient by body-supplied party/recipient ID. It does not establish actor-to-recipient/grant authority or reject contradictory supplied project IDs at that service boundary.

Reproduce: two submissions/recipients under the same tenant; invoke command with another recipient or wrong parent project using a principal who can accept something. Test all aliases and direct service calls. Action: derive actual project and frozen recipient from persisted submission plus principal/grant; record delegated external responses as a distinct command; append decisions with If-Match. Owner: XP02/XP08/XP09.

### N12 — High, confirmed incomplete projection: heuristic resource detection and nested metadata

Evidence: `visibility-projection.interceptor.ts` recognizes selected object shapes, allows project.site_json wholesale and falls back to field-name patterns for unknown shapes. Date instances are treated as generic objects and can serialize into empty objects for restricted roles. Bootstrap constructs the interceptor directly without Reflector, so route metadata allowlists are unavailable there.

Action: explicit endpoint-specific typed DTO serializers with nested field contracts; safe timestamp serialization; deny unknown external fields. Inject the serializer properly. Seed canary commercial data inside site_json and unknown nested objects, and test actual HTTP JSON for each external role. Owner: XP02/XP03.

### N13 — High, confirmed: revalidation ignores the asset URL and lacks review concurrency

Evidence: assets controller exposes `:id/revalidations/:revalidationId` but passes no assetId to service. Service updates by org/project/revalidation ID without expected version or current-identity constraint; capability is asset.manage rather than a distinct evidence-verification authority.

Action: bind revalidation to actual asset, identity revision and version; require a qualified reviewer and proof/reason; append a disposition against expected rowVersion. Reject wrong parent and stale decisions. Owner: XP07/XP13.

### N14 — High, confirmed: revalidation blocks shared evidence too broadly

Evidence: readiness/package SQL excludes a document version if any pending/mismatched revalidation exists for that version in the project. It does not correlate to the requirement's covered asset identity. A mismatch can also clear the document-wide approved pointer.

Reproduce: approved generic manual shared by two units; replace unit A; revalidation pending for A should not invalidate properly qualified coverage for unchanged B. Conversely B's qualification must not satisfy A. Action: qualification per requirement revision/slot/covered identity, rather than global pointer clearing. Owner: XP07/XP13.

### N15 — High, confirmed model limitation: one document decision approves all linked requirements

Evidence: review service updates requirements through document_requirements by document ID; readiness follows document current_approved_version_id. New links can inherit document-wide business status without proving coverage of a new obligation, stage or serial.

Action: preserve document review, add explicit evidence qualification/coverage decisions and derive satisfaction from them. Pin requirement revision and evidence version in submissions/packages; retain historical approvals. Owner: XP07/XP08.

### N16 — High, confirmed: receipts and business mutation still have separate commits

Evidence: idempotency interceptor claims and saves responses in separate transactions around service work. Error cleanup can remove a claim when a handler errors after its own commit. Retaining aged unresolved claims fixes one branch but does not make all command outcomes atomic.

Action: a durable command ledger/handler unit of work; receipt, domain mutation, audit and outbox result commit together for synchronous work. External effects use persisted intents and reconciliation. Fault-inject every commit/response boundary. Owner: XP03.

### N17 — Medium/high under load, confirmed architecture: nested transaction ownership

Evidence: `recordVersionReview` opens `withTenantContext`, then calls `decideReview`, which opens another transaction/client. Two transaction helpers coexist with different audit/outbox behavior.

Action: one owning transaction per command, pass its scoped client to collaborating application functions. Avoid holding a database transaction across remote delivery/large artifact work. Test pool size one, concurrency, rollback and deadlock behavior. Owner: XP03/XP08.

### N18 — High, confirmed dispatch semantics: unknown outbox events are acknowledged

Evidence: worker outbox fallback logs an event as dispatched, then sets dispatched_at without a handler. This may be deliberate for audit-only events, but executable and informational event types are not explicitly distinguished.

Action: versioned event registry with explicit executable/informational classifications, schema validation, handlers, retries, dead-letter and reconciliation. Unknown executable event must remain actionable. Owner: XP05.

### N19 — High, confirmed resource gap: scanner download has no byte ceiling

Evidence: file worker pipelines object body to disk before scan without a streamed byte cap or observed-size comparison during transfer. Post-download parser limits cannot protect temporary disk during transfer.

Action: trusted expected-byte receipt, bounded streaming transform, cancellation/deadlines, temp budget, parser isolation and tenant scheduling. Test dishonest/oversized stream, partial body, repeated crash and disk exhaustion with bounded fixtures. Owner: XP04/XP27.

### N20 — High, confirmed assurance gap: defect close can report success without a row

Evidence: `WarrantyAndBillingService.closeDefect` accepts any nonempty evidence object ID, does not verify file/project/review qualification, ignores UPDATE rowCount and emits DEFECT_CLOSED regardless.

Reproduce: nonexistent defect or unrelated/quarantined proof; ensure foreign proof cannot be accepted through a simple FK. Action: load/lock actual defect, qualify remedy evidence, distinguish remedy submitted from verifier closure, check affected row and append closure event only on success. Owner: XP21.

### N21 — Medium, confirmed arithmetic/read-model defects

Evidence: owner digest converts integer paise to whole rupees before retention, then uses Number arithmetic; retention zero in site_json is treated as absent. Dashboard joins all contracts with requirements and groups by contract values, creating duplicate project rows or multiplied counts with multiple contracts; city fallback invents Hyderabad for unknown location.

Action: one versioned contract/milestone read model, integer paise strings end to end and explicit unknowns; aggregate each relation before joining. Test multi-contract projects, same-valued contracts, one-paise/zero/large numbers. Owner: XP12/XP22/XP23.

### N22 — Medium, confirmed runtime-contract gaps

Evidence: many controllers still accept inline TypeScript types; global ValidationPipe whitelists but cannot validate erased interfaces and does not reject unknown fields by default. Some update paths default expectedRowVersion to 1 or omit preconditions. Body data may fail late in SQL or be interpreted inconsistently.

Action: concrete validated request DTOs/shared schemas, bounds and enum checks, If-Match parsing and consistent problem statuses. Inventory all routes/aliases; do not assume compile-time types validate network input. Owner: XP03/XP02.

### N23 — High operational risk, observed build mismatch

Evidence: worker clean emit produces `dist/apps/worker/src/main.js`, while its start script uses `dist/main.js`. Existing dist/main.js can conceal a stale entrypoint. Docker/AMI architecture and production executable paths need clean smoke tests.

Action: deterministic clean build layout, correct entrypoint, start only freshly built artifacts and validate on target architecture. Never remove the user's existing files to prove this; build into an isolated temporary directory/container. Owner: XP10.

### N24 — High release evidence gap: liveness is reported as readiness

Evidence: health checks only SELECT 1 and exposes raw caught message. It does not establish migration compatibility, runtime role, queue/scanner/storage dependencies or worker freshness.

Action: separate liveness/readiness, safe dependency diagnostics and real availability metrics; fail readiness for incompatible schema without exposing credentials. Owner: XP10.

### N25 — High operational gap: restore drill does not restore evidence objects

Evidence: script now recomputes audit digests and compares selected table counts, which is progress. It still checks object metadata rather than restored bytes; compares source counts after the dump against a changing live database; filters catalog checks to tables where RLS is already enabled; excludes null hash rows; prints RTO target without enforcing it. URL construction assumes a specific source DB name.

Action: snapshot-consistent inventory, database plus versioned object restore, independent hashes, complete tenant/partition catalog policy checks, robust URL handling, bounded cleanup and enforced measured RPO/RTO. Owner: XP10/XP27.

### N26 — Medium/high under load: long-running job/recovery acceptance remains unproved

Evidence: worker scans/compilation and scheduler use locks/timeouts, but current tests do not kill actual workers at DB/queue/storage boundaries or prove renewal during CPU-heavy parsing. Redis loss after dispatched_at can strand jobs without a durable recovery receipt.

Action: persisted execution receipts and reconciliation; bounded retries, tenant fairness, process isolation and fault tests. Job IDs are necessary but do not create exactly-once external effects. BullMQ documents idempotent effects and lock/stalled behavior explicitly. [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs).

### N27 — Medium, confirmed incomplete import contract

Evidence: asset import dry-run checks a subset of fields; commit executes independent per-item create commands. Failures are now returned, but preview is not a pinned decision/impact artifact and concurrent edits/retries can change results.

Action: staged import draft, row errors, duplicate resolution, target baseline version and one explicit atomic/per-row resumable commit contract. Test real consultant workbooks and preserve approved scope. Owner: XP11/XP13.

### N28 — Medium, confirmed maintenance and UX concentration

Evidence: project page is approximately 1,947 lines; core API services range around 800–1,250 lines. Navigation composes many operations into one page, filters are largely local, API contracts use broad any and collection limits vary. Definitions for simulated supplier/user-switch components remain, but no active caller was found in this pass: classify as dormant, not a proven production route.

Action: extract domain commands/read models with parity tests, then route-based workspaces, typed clients and URL filters. Isolate/delete dormant demonstrations only after import/call-site verification. Owner: XP12/XP26.

### N29 — Risk, not established as active leak: legacy offline drafts are unpartitioned

Evidence: upload queue is actor-partitioned, but `draft-storage.ts` keys legacy drafts only by project/requirement. No active caller of that helper was found. Shared localStorage actor partition and cross-tab draining still need adversarial browser tests.

Action: retire dormant helper or migrate to principal/tenant/grant-partitioned storage; coordinate tabs with a scoped lock and bind each queued item to immutable actor scope. Test logout, org switch, tab A/B, quota-full and IndexedDB upgrade. Owner: XP26.

### N30 — High policy risk: mixed tenant-setting aliases can widen visible scope

Evidence: some policies use `org_id = current_org OR org_id = current_org_id`. Normal wrappers set both equally; mismatched values are not rejected by the policy. This is a defense-in-depth gap, not a demonstrated HTTP exploit. PostgreSQL combines permissive policies with OR, so adding another permissive policy does not narrow an existing one. [PostgreSQL 16 row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

Action: inventory effective policies and replace with a canonical tenant function that rejects mismatches; forward migrate, preserve intended user/token bootstrap policies and global read-only catalogue behavior; test both aliases unset/equal/different. Owner: XP02/XP10.

### N31 — High authority risk: archive read uses ordinary document.read

Evidence: export GET uses document.read and service checks tenant/project IDs but not an explicit export/download principal scope. Its full manifest includes project metadata and review information; fixing N04 makes the archive artifact accessible through this path unless authority is corrected first.

Action: export capability distinct from ordinary document view, explicit allowed scope, external projection and signed URL revocation/TTL policy. Test all guests, assigned internal users, disabled downloads and unrelated recipients. Owner: XP02/XP09.

### N32 — Risk: infrastructure declarations are not an operating service

Evidence: Terraform includes private/versioned/encrypted storage and RDS backup settings, which are useful. It also has a concrete AMI, fixed DB engine patch and a shared host model; complete TLS/network/security groups, managed Redis durability, supervision, upgrade policy, deployment rollout, alerts and running recovery evidence have not been demonstrated by this repo inspection.

Action: validate the actual architecture and deployment artifacts against measured pilot load; separate heavy worker/scanner capacity as needed, pin images and test upgrades. Do not claim HA, compliance certification or successful restore from the presence of resource blocks. Owner: XP10/XP27.

## 5. HVAC workflow completeness: what remains to become outstanding

The following are product delivery needs, not all bugs. Some database tables and helpers exist; an implemented table is not a usable workflow.

| Contractor job | Existing foundation | Required product completion |
|---|---|---|
| Start a project from consultant registers | Checklist and asset imports | Mapped preview, duplicates/impact, baseline revision, owner/due assignment and clean supplier requests. |
| Know what to do today | Dashboard counts and project views | Role-specific actionable inbox with source-linked next actions, waiting age, workload, ownership transfer and meaningful reminders. |
| Identify exact installed equipment | Assets, identity revisions, passport query | System/location hierarchy, type versus installed instance, replacements, labels, serial verification and coverage-aware passport. |
| Obtain supplier documents | Scoped guests and upload | Request line/stage, received versus verified versus approved, WhatsApp/email return cycle, delegated sender, duplicate supplier/vendor matching. |
| Follow material-to-installation evidence | Procurement/obligation tables | MAR/technical approval → PO/model → delivery/MIR → installed serial → inspection → commissioned unit trace. |
| Capture inspections and tests | Uploaded reports/companion rules | Native revisioned templates, measurements/units, hold/witness points, calibrated instruments at actual test time, deficiency and retest. |
| Deliver TAB and functional performance | General document workflow | Air/water system hierarchy, design/measured comparisons, instrument/version trace, balancing iterations, BMS interlocks and seasonal deferral. |
| Resolve decisions and changes | Reviews/comments/transmittals | Exact-version comment closure, formal response register, variation/instruction links, waiting ledger and factual delay evidence. |
| Hand over to client/FM | Frozen packages, compilation, archives | Negotiated index/volumes, sections and recipients, exceptions, O&M/training/spares, QR passport, practical offline export and FM data mapping. |
| Handle warranty and DLP | Warranty events and defects | Source-anchored separate clocks, scope acceptance, remedy-versus-verified closure, response deadlines, revisit/replacement and service desk. |
| Prepare RA/final/retention evidence | RA pack and summary | Clause-based milestone prerequisites, bill/JMR/MB references, application/certification/receipt tranches, explicit unknown/disputed states. |
| Operate reliably on sites | PWA shell and durable upload queue | Assigned-data offline workflow, clear sync/conflict state, low-bandwidth resumability, cross-tab isolation, supported languages and usable mobile review. |

## 6. External research and implications for product design

These sources support workflow scope, not claims that TradeCloseout is certified or that every contract requires every field. The implementation recommendations are this review's synthesis. Paywalled standards were not read in full; do not fabricate clause requirements or copy licensed templates. The CPWD PDF viewer fetch failed, but indexed official-domain sections were available; verify the actual contracted edition/clauses with the project engineer before shipping rule packs.

1. ASHRAE's public commissioning catalogue describes commissioning process, systems manuals, O&M documentation and training. Implication: model lifecycle obligations and their evidence, rather than treating one approved PDF as proof of an operationally ready system. [ASHRAE commissioning resources](https://www.ashrae.org/technical-resources/bookstore/commissioning).
2. Official CPWD HVAC 2024 indexed scope covers installation through TAB and handover; §17.5.10 lists final documentation and the scope says project tender provisions can override general specifications. Implication: contract-versioned deliverable packs covering O&M, controls information, warranties, test reports and spares, with project-specific overrides. Do not hardcode a universal binder count, deadline or acceptance tolerance. [CPWD HVAC 2024](https://www.cpwd.gov.in/Publication/HVAC_Specification_2024.pdf).
3. CIBSE Commissioning Code M's public overview stresses operational readiness and ongoing performance. Implication: commissioning planning, source-defined success criteria, witnessed evidence and handover readiness need a native workflow. [CIBSE Code M](https://www.cibse.org/knowledge-research/knowledge-portal/commissioning-code-m-ccm-commissioning-management-2022).
4. NEBB's public TAB report guidance identifies instrument type/manufacturer/model/serial/calibration information. Implication: store the actual instrument/certificate used on each run, rather than checking whether any calibration PDF exists in the project. This does not authorize generating a NEBB-certified report. [NEBB TAB report guidance](https://www.nebb.org/blog/nebb-tab-reports-are-they-compliant/).
5. Autodesk documents mobile submittals, packages, workflow history, attachments and search/filter/export. These are competitive baseline capabilities to evaluate in usability trials, not evidence that one product performs better. [Autodesk submittal documentation](https://help.autodesk.com/cloudhelp/ENU/Build-Submittals/files/Work_Submittals.html).
6. Bluerithm presents equipment, checks, testing, issues, reporting and turnover together. Implication: competing for HVAC specialists needs system-level field verification and commissioning trace, alongside documents. Product claims require independent customer validation. [Bluerithm commercial commissioning](https://bluerithm.com/industry/commercial-construction-commissioning-software/).
7. Fieldwire describes offline site tasks and verification-oriented handoffs. PlanRadar documents handover protocols tied to outstanding defects. Implication: low-connectivity capture and visible exceptions must be primary workflows. [Fieldwire field tasks](https://www.fieldwire.com/blog/jobsite-task-management/), [PlanRadar handover workflow](https://help.planradar.com/en/handovers-workflows-in-planradar/).
8. NIBS describes COBie as organized maintainable-asset handover data. Implication: design a mapping/export adapter and validation report; do not label a generic spreadsheet COBie-compliant. [NIBS COBie](https://nbims.nibs-wbdg.org/nbims/v3/cobie/).
9. OWASP ASVS supplies a verifiable web-control framework. Implication: map applicable controls to evidence and commission an independent security assessment before broad production, without claiming OWASP certification. [OWASP ASVS](https://asvs.owasp.org/).

## 7. Production-level acceptance decision

Use four separate gates:

1. **Engineering regression gate:** a green current regression baseline without removing assignment/authority checks; all active-route contracts inventoried; source/build/migration parity; no unresolved critical/high trust-boundary defect for enabled features.
2. **Operational pilot gate:** a real versioned storage/scanner/provider deployment, complete HTTP/browser journey, worker crash recovery, scoped support tools, alerts, backup plus object restore and measured capacity/cost. Current work has not supplied all that evidence.
3. **Contractor usability gate:** observed onboarding, supplier return, commissioning/acceptance and evidence export on representative real projects. Project engineers confirm scope, forms and outputs; site staff can complete tasks with intermittent connectivity and minimal support.
4. **Best-in-segment gate:** repeated weekly use and retention, substantial measured reduction in chasing/rework/package time, strong supplier/client completion, and comparative task studies. Revenue/retention-release benefits remain hypotheses until observed.

Do not equate passing gate 1 with passing gates 2–4. Build and demonstrate each gate. The next document defines how the agent should do that, starting with the new bugs rather than reimplementing already repaired safeguards.
