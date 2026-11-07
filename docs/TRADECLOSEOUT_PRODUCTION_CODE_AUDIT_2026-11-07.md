# Production code audit and remaining implementation — 2026-11-07

## Decision

The project has useful tenant isolation, evidence storage, review, package/archive and contractor workflow foundations. The next target should be a **production acceptance gate with a complete contractor journey**, followed by deeper HVAC execution. The current passing test suite does not establish that gate: this audit reproduced authorization, protocol and workflow failures outside its existing cases.

This document records the current findings. [The agent implementation plan](TRADECLOSEOUT_PRODUCTION_AGENT_IMPLEMENTATION_PLAN_2026-11-07.md) specifies how to implement and verify them. [The machine-readable backlog](TRADECLOSEOUT_PRODUCTION_BACKLOG_2026-11-07.json) maps findings to work packages. Earlier N/XP/F/G reports remain historical evidence; this audit does not erase their history or reopen repaired defects automatically.

## Scope and evidence limits

- Inventoried **210 source, test, migration, script and infrastructure files / 48,865 lines** across API, web, worker, database, shared rules and PDF engine. Reviewed workflow implementations and boundaries across these areas; this is not a claim that every possible execution path was tested.
- Extracted **144 HTTP handlers**, **78 POST handlers**, **71 handlers with body parameters**. At least **51** use inline/`any` body types; other named types also include erased interfaces. **10** handlers declare mandatory idempotency. These are inventory counts, not proof that every other POST requires the same retry policy.
- Ran the compiled real Nest application on a temporary local port, with the repository guards, pipes, filters and interceptors, against a fresh migrated disposable PostgreSQL database and restricted runtime pool. No authentication guard was mocked. Storage/delivery adapters were not exercised against external providers.
- Additional service probes used the same restricted database role. Redis probes used isolated synthetic identifiers and exact-key cleanup. No customer records, production deployment, real OTP delivery, provider messages or payments were changed.
- Only audit documents/artifacts were added. Tests/builds wrote their normal ignored outputs. Source hashes and runnable probe sources are retained in [the evidence file](TRADECLOSEOUT_PRODUCTION_AUDIT_EVIDENCE_2026-11-07.json).

## Executed checks

| Check | Result and practical limit |
|---|---|
| `pnpm typecheck` | Passed. Typechecking does not validate raw SQL names/status values or erased request interfaces. |
| Root `pnpm test` | Passed. API **24 suites / 178 tests**; shared **4 / 44**; DB **9 behavioral subtests**, 10 including parent; worker **12**, 13 including parent; archive browser **6**; PDF **3** scripted checks. |
| API, worker and web builds individually | All passed. Web production build includes the project detail route at approximately **286 kB first-load JS**; measure field-device behavior rather than infer performance from size alone. |
| Root `pnpm build` | Failed here before compilation: Turbo could not spawn child processes, `Exec format error`. Individual builds passed. Treat this as a local orchestration/environment limitation requiring clean Node 22 CI reproduction, not an established application compiler defect. This environment ran Node 26.4.0; CI specifies Node 22. |
| `pnpm audit --prod --json` | Exit 1: **7 high / 4 moderate advisory entries**, 0 critical, in the resolved production graph. Advisory presence is not proof of seven exploitable application endpoints. |
| Live HTTP probes | Confirmed cross-project guest read, consultant internal-field exposure, timestamp corruption, unversioned route drift, empty owner organisation list, and guest-page payload failure. Logout revocation succeeded as a control. |
| Database/service probes | Confirmed review submission constraint failure, missing pending waiver work item, invalid default guest-grant type, zero-retention miscalculation, and archive signing despite missing observed size. Empty equipment passport now succeeds. |
| Redis/controller probes | Confirmed older delivery-failure cleanup invalidates a newer challenge; in-memory fallback cannot immediately verify a correctly issued debug code. No sessions were created by these probes. |
| PDF artifact probe | With qpdf absent, exported PDF-engine inspection/sanitization reported success but retained a synthetic inert JavaScript OpenAction. No PDF action was executed. Installed-qpdf behavior was reviewed against its documented JSON contract, not executed locally. |

The application browser project is **not** part of root tests. No full real-browser → API → object storage → ClamAV → BullMQ → package download → client acceptance journey, provider acceptance cycle, process-kill/load campaign or object-storage restore was certified here.

## Previous findings: what changed

| Previous gap | Current disposition |
|---|---|
| G01 passport's invalid revalidation column names | Corrected joins/aliases. Actual empty-asset passport now succeeds. Populated history/authorization still needs coverage. |
| G02 readiness/package asset scoping disagreement | The missing asset predicate is now in the package transaction recheck too. Scoped source repair; full end-to-end shared-manual generation remains an acceptance case. |
| G03 missing archive provider version accepted | Missing provider version now rejects. Missing **observed size** still passes: PA12. |
| G04 optional recipient veto | Aggregation now selects/filter required approvers. Define zero-required and decision-correction semantics; do not claim the old optional veto remains unchanged. |
| G05 generic manual/different remedy evidence | Asset-positive checks and submitted-evidence identity comparison added. Retain regression coverage; complete explicit qualification instead of relying on storage-key strings. |
| G06 omitted revalidation expected version | Now rejects with PRECONDITION_REQUIRED. Work-item version propagation remains PA06. |
| G07 premature TAB rounding | Raw ratios are compared before display rounding now. The source procedure/design/tolerance contract is still missing: PA27. |

Earlier atomic OTP issuance/generation checks, hash-only OTP storage, payment safe containment, registry coverage, scan byte-ceiling validation, ACTIVE contract filtering in the organisation dashboard and commissioning composite asset constraints remain useful repairs. The new OTP failure-cleanup race and project-dashboard zero handling below are different paths.

## Findings and remaining implementation register

Evidence labels: **HTTP** = reproduced through the actual HTTP application; **DB** = actual service and migrated PostgreSQL; **Redis** = actual isolated Redis/controller behavior; **Source** = inspected implementation; **Capability** = absent/incomplete intended workflow; **Unverified** = operating acceptance not demonstrated.

### PA01 — P0 — A project-scoped guest can read another project

**HTTP, confirmed.** With a CLIENT_VIEW grant tied to project A0 and `project.read`, `GET /api/v1/projects/A1` returned 200 and A1's project record in the same organisation. Project-list denial worked, so list protection does not establish item protection.

Sources: [permission.guard.ts](../apps/api/src/common/guards/permission.guard.ts), [session-csrf.guard.ts](../apps/api/src/common/guards/session-csrf.guard.ts), `ProjectsService.getProject` in [projects.service.ts](../apps/api/src/modules/projects/projects.service.ts). The guard skips membership checks for guests; the service filters tenant/id but not the guest grant's project. Tenant RLS does not substitute for project/grant authorization.

Implement canonical resource/grant resolution and command/query policy; recheck grant status/expiry/project/capability/resource scope. Audit every project, asset, checklist, review, handover, commissioning and commercial read/write route, including direct IDs and collections. Return indistinguishable denials outside scope. Acceptance must exercise actual member and guest sessions over HTTP, not only mocked permission functions.

### PA02 — P0 — External response projection misses roles and damages dates

**HTTP, confirmed.** An R-CONSULT guest reading its permitted project received synthetic `settings_json.internal_note`. An R-CLIENT response turned PostgreSQL `created_at`/`updated_at` Date values into `{}`.

Source: [visibility-projection.interceptor.ts](../apps/api/src/common/interceptors/visibility-projection.interceptor.ts), [main.ts](../apps/api/src/main.ts). The restricted-role set omits several guest roles; auth context does not carry the guest flag read by the interceptor fallback. Unknown objects use heuristic deny patterns. Dates are traversed as plain objects. Bootstrap manually constructs the interceptor without Reflector, so route allowlists are not resolved there.

Implement explicit audience-specific DTO serializers, an authoritative actor classification, safe scalar/date serialization and DI-managed metadata. Test every guest role and nested envelope, raw/camel/snake fields, commercial/internal metadata, comments, timestamps and streaming responses. Preserve needed external fields while proving sensitive fields never appear.

### PA03 — P1 — New API surfaces do not use the application's versioned route namespace

**HTTP, confirmed.** `/api/v1/work-items` and `/api/v1/projects/:id/commissioning/tab-worksheets` returned 404; `/work-items` and `/projects/:id/commissioning/tab-worksheets` returned 200. Sources: their controller decorators and the web rewrite, which forwards `/api/*` only.

Implement one route-prefix policy and generated route/client contracts. Test routes through the Next proxy as well as directly against Nest. Either deliberately support/document compatibility aliases or remove them through a versioned transition; do not accidentally expose a second namespace. Add the missing product screens under the intended prefix.

### PA04 — P1 — Organisation switcher cannot discover a valid membership

**HTTP, confirmed.** An owner with an active seeded membership received `[]` from `/api/v1/auth/orgs`; `/auth/me` returned the active organisation correctly and logout persisted revocation. `IdentityController.getOrgs` queries memberships without user-local RLS context, while the guard's transaction has already committed.

Implement this query in a user-scoped transaction. Test multiple memberships, revoked membership, guest denial, organisation switch and fresh CSRF state on separate pooled connections. Keep each transaction's context local; never fix this by making connection-global tenant/user state persist.

### PA05 — P1 — Review submission fails against the current database constraint

**DB, confirmed.** `ReviewsService.submitReview` failed with SQLSTATE 23514 on `requirements_status_v021_chk`; the transaction rolled back and the version remained NOT_SUBMITTED. It writes UNDER_REVIEW, but migration 0003's effective requirement constraint permits IN_REVIEW. Shared enum comments disagree with that effective constraint.

Sources: [reviews.service.ts](../apps/api/src/modules/reviews/reviews.service.ts), [status-enums.ts](../packages/shared/src/status-enums.ts), migration 0003. Consolidate state definitions and transition commands; inventory all consumers of IN_REVIEW/UNDER_REVIEW, status counts and UI badges. Add a real submitted → assigned → reviewed workflow with both success and rollback assertions. Do not only edit the enum to make a mocked assertion pass.

### PA06 — P1 — The work queue hides pending waivers and carries stale action metadata

**DB, confirmed for waiver omission; Source for other action metadata.** `requestWaiver` created PENDING_SECOND_APPROVAL, but `listWorkItems` reported zero waivers because it filters `w.status = 'PENDING'`. Revalidation entity version is hardcoded to 1 despite real row-version increments. Review links identify a document version where the advertised review route expects a review ID; execute the returned command contracts in tests before declaring them usable.

Source: [work-items.service.ts](../apps/api/src/modules/work-items/work-items.service.ts). Build query projections from canonical states, actual resource IDs/versions and authorized next commands. Include IN_PROGRESS defect behavior and pagination/filter contracts. Test that every returned next action is executable by its audience and disappears/changes correctly after completion.

### PA07 — P1 — Generic guest-link creation defaults violate schema and permission vocabulary

**DB, confirmed.** `PartiesService.createGuestGrant` with party/email and omitted optional grant type failed 23514 on `guest_grants_grant_type_check`: the default SUPPLIER is not a persisted type such as SUPPLIER_UPLOAD. Default capabilities REQUIREMENT_UPLOAD/DOCUMENT_VIEW also differ from the guard's `document.upload`/`document.read` vocabulary. The optional party ID conflicts with the database's mandatory party binding.

Implement typed, server-owned grant profiles mapping business purpose to persisted type, role and least-privilege capabilities. Validate party/project/target/scope and expiry before insertion, and reject arbitrary privilege expansion. Unify generic and supplier-specific grant creation without regressing working supplier scope checks. Test default and explicit profiles through HTTP, issuance/delivery/expiry/revocation and actual granted actions.

### PA08 — P1 — The real guest page sends a decision the API does not accept

**HTTP payload reproduction and Source, confirmed.** The page posts ACCEPTED/REJECTED plus `remarks`; the recipient controller expects ACCEPT/ACCEPT_WITH_EXCEPTIONS/REJECT and reads `comment`. Its exact current payload returned 422 REMARKS_REQUIRED. The page also collapses acceptance with exceptions into ACCEPTED.

Sources: [guest page](../apps/web/src/app/(guest)/guest/[token]/page.tsx), [handover.controller.ts](../apps/api/src/modules/handover/handover.controller.ts). Define a single runtime-validated command DTO and generated client type, preserve all three decision meanings and exception items, and reject unknown values before domain logic. Test real browser submissions and durable recipient/aggregate/package/audit results for each choice.

### PA09 — P1 — Project retention calculations still disagree with zero-retention contracts

**DB, confirmed.** A contract with value 1,000,000 paise and retention 0 produced project-dashboard retention 50,000 paise (₹500), rather than zero. This query uses `retention_rate || 500`; the previously fixed organisation dashboard is a different projection. This dashboard also selects the latest one ACTIVE contract rather than a defined effective multi-contract/variation basis.

Source: `getProjectDashboard` in [projects.service.ts](../apps/api/src/modules/projects/projects.service.ts). Use exact paise/basis-point arithmetic and explicit null handling in one commercial projection. Define contract/variation effective dates and multiple-scope rules; distinguish total retention exposure from a specific blocker-attributable amount. Test zero, null, multiple ACTIVE scopes, superseded revisions and large integers across every UI/API/digest.

### PA10 — P1 — OTP failure cleanup can invalidate a newer successful request; fallback behavior differs

**Redis, confirmed.** Request A waited in a controlled email adapter; request B issued successfully; A then failed. A's catch block unconditionally deleted the current recipient alias, so B's valid code immediately returned OTP_EXPIRED. The normal issuance/consume generation checks remain intact; failure cleanup is the separate race.

**Fallback control, confirmed:** with the module's in-memory Redis provider, a newly issued debug code immediately returned OTP_EXPIRED. Its generic `eval` script detection sees INCR/EXPIRE inside the verification script and treats it as the rate-limit script.

Sources: identity controller/module. Make every failure/supersession/consume cleanup generation-conditional and atomic. Use one tested challenge-store abstraction with behavioral contract tests, or require Redis in all integration/development modes. Add barrier-controlled provider rejection/reissue cases, DB session assertions, request/IP budgets, purpose/identity binding and provider receipt lifecycles. Never print real codes in logs.

### PA11 — P1 — Production dependencies have unresolved advisory matches

**Registry audit, confirmed dependency matches; application exploitability requires reachability review.** Seven high entries include xlsx 0.18.5 (two), drizzle-orm 0.40.1, zod 3.25.76, multer 2.4.0 and two PostCSS entries through Next's postcss 8.4.31. Four moderate entries are also recorded in evidence. The project imports arbitrary consultant spreadsheets through `XLSX.read`, so parser exposure deserves immediate attention.

Implement a controlled upgrade/replacement PR with lockfile integrity, compatibility tests and advisory-path review. SheetJS documents its authoritative distribution outside the stale npm package: [maintainer installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). The Drizzle maintainer describes the identifier/alias precondition; static parameterized application queries do not by themselves establish that exploit: [maintainer advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9). Re-evaluate exact versions when implementing. Do not hide high findings with blanket exclusions or assume a direct PostCSS bump replaces Next's nested copy.

### PA12 — P1 — Archive download still accepts missing observed size

**DB, confirmed.** After the provider-version fix, a READY row with a real provider version but NULL observed size still reached the signer. The API substitutes declared `size_bytes`. Source: `getArchiveExport` in [handover.service.ts](../apps/api/src/modules/handover/handover.service.ts).

Require authoritative observed size, declared size, artifact size and digest/version/key/bucket consistency; missing or invalid facts must reject. Preserve producer readback verification and pinned versions. Test corrupt/legacy rows, missing facts independently and actual API download bytes. Plan a preflight/backfill-or-quarantine migration for existing incomplete READY records rather than silently asserting they were verified.

### PA13 — P1 — Runtime request contracts are incomplete

**Source/inventory.** At least 51 of 71 body-taking handlers use inline/`any` types. Named commissioning and review inputs are interfaces too. Global ValidationPipe cannot validate their erased property schemas. Missing enum/UUID/array/size/finite-number checks surface as domain mistakes, SQL 500s or partial semantics. PA05/07/08 illustrate protocol drift; those failures are not fixed just by adding a global pipe.

Implement a per-route schema registry, UUID/parent validation, bounded nested DTOs, exact money/date types, unknown-field policy and consistent error/precondition semantics. Generate clients/OpenAPI from executable contracts. Validate each command before mutation, and distinguish declared values from authoritative persisted values.

### PA14 — P1 — Command effects and idempotency receipts commit separately

**Source/architectural gap.** [idempotency.interceptor.ts](../apps/api/src/common/interceptors/idempotency.interceptor.ts) claims a receipt, runs a handler in its own business transaction, then writes the response in another transaction. Receipt-write crashes can leave unknown outcomes; error handling can delete a claim without proving no business effect committed. Cleanup correctly retains unresolved claims, but retention is not reconciliation. Mandatory declarations cover only selected POSTs; PATCH/DELETE behavior must be deliberately classified.

Implement a durable command ledger and shared unit of work for local effects/audit/outbox/outcome. External effects need stable operation IDs and reconciliation. Explicitly represent accepted/running/succeeded/rejected/unknown outcomes and provide safe status/recovery commands. Test commit-before-receipt failure, unknown-outcome retries and process death; never solve this by age-based claim deletion.

### PA15 — P1 — Evidence qualification and review transitions still have multiple authorities

**Source/architectural gap.** Readiness, package generation, RA packs, commercial readiness, passports and review services contain separate qualification SQL/status projections. Document-wide current approval and requirement links do not fully encode qualification for asset identity + requirement revision + procedure/test scope. Multiple review/workflow implementations retain independent rules and transaction ownership.

Implement immutable evidence qualification and review/exception records with composite tenant/project/asset/revision/slot scope. Use one domain policy/query definition in every projection; a document may be technically valid for one obligation and not another. Make one layer own each transaction and pass its client/unit of work explicitly. Test shared manuals, replacement plant, baseline changes, stale approvals, independent verifier and concurrent edits across all read models.

### PA16 — P1 — Not every material command emits transactional audit/outbox evidence

**Source.** Helpers only flush staged emitted events. Commands including waiver request/countersign and several requirement/contract changes call transaction helpers without emitting a corresponding domain event. Other services use a separate transaction wrapper with no automatic event behavior. A hash chain proves integrity of recorded events, not completeness of missing events. Authenticated `userContext` also omits IP/userAgent supplied by some other context shapes.

Define a command/event/audit contract inventory; atomically persist business state, actor/delegation/recorded-and-occurred time, reason, before/after or immutable references and outcome. Test presence and scope per material command, rollback absence and secret redaction. Do not log business payloads indiscriminately.

### PA17 — P1 — Outbox dispatch is not durable execution completion

**Source/Unverified.** Registry coverage improved. The poller marks dispatched after BullMQ enqueue, while Redis loss can remove accepted jobs; informational events are acknowledged with logs and no downstream effects. There is no complete DB execution ledger/reconciliation/dead-letter operator workflow. Five failed dispatch attempts leave events outside the normal query. Overlapping timer cycles and multi-instance recovery need acceptance tests.

Implement versioned payload validators, durable logical executions, retryable/terminal classifications and reconciliation from DB state to queues/results. Keep event IDs and queue job IDs stable. Distinguish intentional audit-only events from events requiring delivery/workflow actions. Kill processes before/after enqueue/commit and simulate Redis loss; prove eventual correct outcome or visible actionable failure.

### PA18 — P1 — File verification needs complete format and parser containment

**Artifact probe, confirmed; Source/Unverified for the broader pipeline.** The exported PDF-engine `inspectAndSanitisePdf` fallback returned success but retained a synthetic JavaScript OpenAction after rewriting. This proves its sanitization contract is incomplete; it does not prove execution in a user's browser or that every worker path uses that helper. The worker has another sanitizer, so implementations need consolidation and separate verification.

The qpdf branch also tests the whole `parsed.encrypt` object for truthiness and requests an old `objects` JSON key. The maintainer documents populated `encrypt` values even for unencrypted files and the JSON v2 replacement of `objects` with `qpdf`: [qpdf JSON contract](https://qpdf.readthedocs.io/en/stable/json.html). The installed-qpdf branch therefore needs a corrected versioned parser and real CI/tool-image tests. qpdf was absent locally, so the passing local PDF checks used the fallback.

Fail-closed ClamAV and bounded scan download are useful. A generic ZIP signature also covers OOXML without a complete declared-format/container relationship. Extension/magic/MIME consistency and normalized detected metadata are not established comprehensively. PDF fallback parsing occurs before some object limits and in the worker process. Approved formats need real fixtures; unavailable conversion tools cannot be treated as successful conversion.

Implement bounded format-specific inspection in isolated processes, decompression/entry/pixel/object/time/memory limits, antivirus signature freshness, persisted scan receipts and positive MIME/container mapping. Bind expected bytes/checksum/version to the storage record. Test benign/invalid/polyglot/archive-bomb samples and actual ClamAV unavailability/retry; retain original bytes and derived-artifact lineage.

### PA19 — P1 — Artifact workers need transfer deadlines, leases and aggregate resource budgets

**Source/Unverified.** Portable archive source/output byte caps, pinned readback and advisory exclusion exist. Several storage streams lack a total deadline; a stalled body can hold a worker/database connection/advisory lock indefinitely. PDF/archive concurrency and temp-space aggregate limits need enforcement beyond per-object caps. Format conversion has local-path parameters and incomplete external tool lifecycle acceptance.

Implement request and body deadlines, cancellation propagation, per-job/per-host byte/disk/CPU/process budgets, safe temp cleanup and recoverable ownership/heartbeats. Crash mid-download/render/upload/commit and reconcile orphaned artifacts. Prove that a slow client/job cannot starve unrelated tenants. Do not remove the existing integrity and size checks.

### PA20 — P2 — Messaging has an acceptance seam, not a complete delivery lifecycle

**Source/Capability.** The gateway deduplicates by notification ID contract and requires matching acknowledgement before SENT. There is no full provider delivery/bounce/failure callback model, bounded attempt scheduling or operator workflow. Null-recipient IN_APP broadcasts lack an explicit project audience contract; project membership must constrain who sees project content. Calls can hold notification row locks/transactions across multiple network deadlines.

Implement domain reminder commands, resolved audiences/preferences, provider message IDs and inbox receipts, idempotent callbacks, accepted/delivered/failed states, backoff and terminal handling. Preserve quiet hours and the existing acknowledgement check. Separate claim/delivery/reconcile steps using leases rather than long network transactions.

### PA21 — P1 — Production configuration and readiness are not consistently enforced

**Source/Unverified.** `loadAndValidateEnv` is only referenced by tests; API/worker bootstrap do not call it. The schema and adapters use different DB/S3/DLT variable names. Some production connections still have local defaults. Runtime DB role privilege validation is in test helpers, not complete startup readiness. Health checks only SELECT 1 and return raw caught messages.

Implement one validated configuration contract with intentional optional feature flags. Check runtime role and required dependency capabilities at startup. Separate live/readiness/diagnostic endpoints; readiness must reflect migration, Redis, storage/versioning, scanner/worker and configured delivery readiness appropriately. Keep sensitive details in protected logs and use bounded health checks.

### PA22 — P1 — CI does not run the actual contractor application journey

**Source/Unverified.** Root tests and CI execute the archive browser project. The application project has two persona/seed-specific scenarios and is not run by the workflow. No real lifecycle validates the browser payload in PA08. The root build has a local process-spawn failure while individual builds pass; the clean supported-runtime pipeline is the deciding evidence.

Implement isolated fixtures and real app/API/worker/storage/scanner orchestration, deterministic provider capture, artifacts/traces and API/route/role matrices. Run full HTTP boundary tests and a meaningful application browser suite in CI; keep unit/DB/worker tests as separate layers. Do not call a direct-service fixture a browser end-to-end test.

### PA23 — P1 — Restore drill verifies database metadata rather than restored object bytes

**Source/Unverified.** The script restores PostgreSQL, checks audit digests and storage verification metadata, and enforces an RTO. It does not restore/retrieve S3 versions or independently hash restored bytes. It compares a snapshot against later live source counts, which can legitimately diverge. RPO and successful application use after recovery are not established.

Implement a snapshot-consistent backup manifest, object/version recovery and independent hashes, audit anchor validation and recovery through the actual runtime role/application. Exercise lost Redis/job reconstruction and lost object/version cases. Add cleanup traps and preserve evidence securely. Measure RPO/RTO from documented incident/recovery points; do not relabel metadata checks as object recovery.

### PA24 — P1 — Reachable billing UI can display another company's sample facts

**Source, confirmed active page.** The billing page hardcodes a sample legal name/GSTIN/PAN, price and project limit; failed API calls become null/empty values and fabricated default plan information. Backend plan definitions, subscription values and UI limits can disagree. A separate dormant client-guest component simulates signed acceptance with a timer; no active caller was found, so this is dormant misleading code, not proof that the live guest route records a fake signature.

Implement truthful profile/subscription/invoice view models, explicit unavailable/error states and exact money formatting. Remove dormant simulated certification/acceptance claims or confine them to clearly labelled isolated demos. Trace every visible badge/button to a persisted authoritative state or functioning command.

### PA25 — P1 — Offline uploads have no complete stale-URL and multi-tab recovery contract

**Source/Unverified.** Actor partitioning, retained original blobs and stable queue-based command keys are good. Drain reuses persisted signed URLs without a refresh branch after expiration, despite a server refresh endpoint. There is no cross-tab drain lease; the actor is checked once before long asynchronous work. Reload/reconnect/logout/switch-org/revoked-grant scenarios are not browser-tested. Legacy draft keys lack actor partitioning.

Implement queue ownership/lease, versioned intent/URL refresh, retries/backoff and actor rechecks at command boundaries. Query authoritative uploaded parts; preserve immutable original blobs/checksums and expose local storage quota/purge controls. Make background behavior honest when no client window is open. Test physical-style offline/reconnect/session changes across tabs with actual IndexedDB and storage contracts.

### PA26 — P1 — Database models and migrations have drifted

**Source/DB evidence.** Schema declarations omit new commissioning tables and new revalidation/remedy columns. State strings disagree across effective SQL constraints, shared enums and services. Fresh/0005-upgrade tests are useful but do not cover every populated upgrade constraint or old READY record preflight.

Reconcile declared schema with catalog introspection; generate/check enum, key, default, RLS and FK contracts. Use forward migrations with population preflight, backfill/quarantine and rollback/roll-forward strategy. Preserve applied checksums. Test representative populated prior baselines and nonprivileged access after upgrade, including newly added domain tables and shared/global exceptions.

### PA27 — P2 — Native HVAC quality and commissioning are incomplete workflows

**Capability.** Three tables and several record/list/sign commands exist. Missing: approved versioned procedures, prerequisite/hold/release/review/retest states, required reading completeness, conditions, instrument/calibration-at-test, sourced design/tolerances and immutable correction lineage. Witness signing accepts arbitrary role/name strings with document.upload permission. Functional controls/BMS sequences and seasonal perform/defer/waive/return-visit commands are absent. No web callers for the commissioning routes were found.

Implement engineer-approved procedures and scoped test runs with explicit measurement versus acceptance outcomes. Treat default tolerance arithmetic as a calculation foundation, not certification. Link accepted results to ordinary immutable evidence/qualification and revalidate impacted tests when plant/control logic changes. See A12/A13 in the implementation plan.

### PA28 — P2 — Baseline/import work needs a persisted preview-to-commit contract

**Capability/Source.** Checklist/asset import and collision handling foundations exist. Customer-scale ingestion still needs bounded parser isolation, mappings/units/provenance, a persisted reviewed preview tied to source and target revision, atomic commit receipts and actionable row errors. Browser parsing and recomputed preview alone do not establish a stable approved baseline.

Implement import sessions, source hash/object identity, mapping/procedure revision, row disposition and expected baseline. Commit the reviewed preview or reject stale changes; never silently merge duplicates. Preserve consultants' original row IDs and revision history and connect changed obligations to existing evidence impact.

### PA29 — P2 — Procurement stops short of material-to-installed-unit trace

**Capability.** PO lines, supplier obligations and guest intake exist. Complete lot/receipt/inspection/quarantine/short-delivery/allocation/replacement trace and staged supplier return/review are not implemented as an end-to-end workflow. A PO line with quantity is not a substitute for actual installed serial-unit evidence.

Implement accepted quantities and batch/serial allocations, delivery records, approved substitution and proof links under composite scope; resolve obligations per stage and responsibility. Derive next work items and installed-unit passports from those records. Include partial delivery, wrong make/model, rejected lot, split allocation, return and alternate supplier cases.

### PA30 — P2 — Aftercare and commercial closure need sectional acceptance and exception lineage

**Capability/Source.** Defect/warranty/retention foundations are present. Remaining product behavior includes sectional handover, effective acceptance dates, warranty basis conflicts, service/OEM claims, responsibility/SLA/remedy revisions, controlled waiver and retention application evidence. Separate project-contractor commercial support from SaaS subscription invoicing. Payment processing and cryptographic signing remain explicitly unavailable.

Implement scoped acceptance/aftercare events and derived dates with source references; preserve disputed basis and timezone/date precision. Create evidence-backed commercial applications and reconciliation states without claiming payment or legal certification automatically. Real signing/provider ingestion should be optional integrations with independent verification and failure recovery.

### PA31 — P2 — Daily product UX is not connected across all new backend capabilities

**Capability/Source.** Work items, equipment passport and commissioning lack complete integrated web journeys. Search/navigation, next responsible person, rejected-return handling and mobile/offline state need one coherent flow. The large project page imports spreadsheet/UI concerns together; split by domain and lazy-load heavy features after measuring. Several dormant view components contain sample assertions/actions.

Build an authorized next-action desk, project/equipment/procurement/quality/handover/aftercare navigation and explicit empty/error/pending states. Add global search with permission-aware indexing, responsive field capture and accessible labels/focus/keyboard/error behavior. Test assisted and independent completion on representative contractor devices; measure actual task success/time rather than count screens.

### PA32 — P1 — Deployability, observability and capacity need operating proof

**Source/Unverified.** CI verifies/builds but does not define a complete release/deploy/rollback procedure. Terraform provisions selected resources; production network/TLS/app packaging/secrets/process supervision/Redis recovery and failover need a runnable environment and acceptance evidence. There is no complete structured tracing/metrics/SLO/alert loop. Single-host resources and fallback configuration cannot establish HA or capacity claims.

Implement reproducible images, supported runtime/architecture/tooling, migration-before-traffic gates, readiness-aware rollout/rollback, secret rotation and least-privilege runtime access. Define workload envelopes with customer data, then measure p95/p99 latency, queue age, failure rate, memory/disk/DB saturation and tenant fairness. Wire alerts to owned runbooks and rehearse dependency failure/recovery before expanding rollout.

## What production-level means for this project

Production acceptance should demonstrate correct scope, truthful evidence, recoverable commands/jobs, complete contractor task paths and an operated environment. Feature depth follows that trust foundation. The ambition to be an excellent HVAC product is retained: native inspections/TAB, installed-unit trace, supplier collaboration, return/retest handling, seasonal aftercare and commercial evidence are substantive remaining capabilities, not optional marketing text.

The accompanying plan defines delivery gates and implementation packages. Do not close a finding because its identifier appears in a comment, a table exists or a mock test passes. Close it with the concrete negative and positive behavior, matching migration/API/UI contracts and retained evidence.
