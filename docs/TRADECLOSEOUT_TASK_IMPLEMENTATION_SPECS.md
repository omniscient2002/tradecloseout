# Individually executable implementation specifications

These tasks are specifications for Luna or Gemini 3.8 Flash, not code changes. Implement only the selected release slice. Read architecture, API contracts in the master blueprint and UX screen specifications first; their shared invariants are part of every task. A task is complete only when its acceptance evidence is attached to the exact changed commit. Existing uncommitted work belongs to the user and must be preserved.

Effort is focused engineer time including meaningful tests/review, not a calendar promise. Risk is High for P0/P1 and migration/operations tasks, Medium for staged UX/domain work, and High for AI/data isolation. Database entity names are logical; inspect existing schema before deciding additive physical names. Do not create a competing parallel data model where existing tables can be adapted.

## Shared contracts inherited by every task

Use authoritative server actor context, composite tenant/project relationships, explicit resource permissions, append-only business decisions, UTC instants/local business dates, integer paise, expected-row-version writes and atomic command/audit/outbox receipts. No mutation succeeds before commit. Missing versions/preconditions are not silently defaulted. New HTTP contracts are described in the master blueprint; legacy aliases delegate with parity tests and removal notices. No mock integration is permitted in production. Implement no AI approvals, certifications, waivers, handover acceptance or monetary changes. Test meaningful invariants rather than asserting SQL substrings or mirroring implementation.

For each task the **State and permission contract** is the corresponding state-machine and permission-matrix row in target architecture, narrowed by the task-specific checks below; no task may widen it. Every API field described below is required unless explicitly optional. Common errors/statuses are owned by the master blueprint. Dependencies are hard prerequisites for enabling customer behaviour, even when code preparation can occur earlier.

## T01 — Reconcile migration history and tenant relationships

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | Baseline inventory; no code work before reading current user modifications |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F022, TC-F023 |

1. **What and why:** Inventory real deployed migration names and checksums before any rename. Add serialized ledger validation. Choose SQL migrations as schema authority and reconcile Drizzle declarations to the same effective schema. Add composite tenant/project relationships to every new domain table; do not remove forced RLS.
2. **Existing modules/files to inspect:** [packages/db/src/run-migrations.ts](../packages/db/src/run-migrations.ts); [packages/db/src/schema.ts](../packages/db/src/schema.ts); [packages/db/migrations/0000_complete_v021_schema_and_rls.sql](../packages/db/migrations/0000_complete_v021_schema_and_rls.sql); [packages/db/migrations/0006_discovery_and_lifecycle_foundations.sql](../packages/db/migrations/0006_discovery_and_lifecycle_foundations.sql); [packages/db/migrations/0007_procurement_and_vendor_obligations.sql](../packages/db/migrations/0007_procurement_and_vendor_obligations.sql); [packages/db/src/tenant-tx.ts](../packages/db/src/tenant-tx.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Migration ledger name/checksum/applied_at; compatibility map for legacy names only after human-reviewed inventory. Relationship repair report with offending entity IDs; no automatic tenant reassignment. Canonical tenant setting app.current_org; set old alias equally until all policies migrated.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Clean and upgraded databases have identical schema/constraints; ledger mismatch blocks startup; invalid rows have an explicit disposition; runtime RLS tests pass.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Runtime role NOBYPASSRLS, not owner/superuser; migrator separate. Every tenant table FORCE RLS and composite WITH CHECK constraints.
7. **API request/response expectations:** No public migration API. Application readiness exposes schema compatibility boolean without schema credentials or raw SQL.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Operational schema incompatibility shows service unavailable; never invite user to fix it by retrying a domain command.
10. **Errors, validation and edge cases:** Changed checksum blocks migration. Unknown applied migration or inconsistent relationship stops release for explicit reconciliation. Existing databases and clean installs must converge semantically.
11. **Transaction and concurrency:** One advisory migration lock on dedicated migration connection; ledger insertion and each migration atomic. Backfill resumable and constraint validation separately scheduled.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Backfill jobs emit counts/checkpoints and never reinterpret historical approvals.
14. **Required tests:** Fresh DB; each known prior migration baseline; rerun; checksum mismatch; concurrent runners; direct cross-tenant and cross-project foreign-key violations.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Expand-only migrations first; snapshot and restore rehearsal; do not reverse evidence-bearing tables. Preserve original ledger names rather than editing applied history.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T02 — Repair member and guest authentication and logout

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T01 |
| Effort | 4–7 days |
| Risk | High |
| Findings/context | TC-F001, TC-F004, TC-F005, TC-F031, TC-F032 |

1. **What and why:** Use atomic challenge validation/attempt increment/consume tied to challenge ID, identity and grant. Remove generic PIN exchange for OTP-required grants. Default supplier grants to OTP. Repair token_hash logout, call it from UI and remove mutating GET. Rotate CSRF on org switch and require a fresh active member context.
2. **Existing modules/files to inspect:** [apps/api/src/modules/identity/identity.controller.ts](../apps/api/src/modules/identity/identity.controller.ts); [apps/api/src/modules/identity/identity.module.ts](../apps/api/src/modules/identity/identity.module.ts); [apps/api/src/modules/parties/parties.service.ts](../apps/api/src/modules/parties/parties.service.ts); [apps/api/src/modules/parties/parties.controller.ts](../apps/api/src/modules/parties/parties.controller.ts); [apps/api/src/common/guards/session-csrf.guard.ts](../apps/api/src/common/guards/session-csrf.guard.ts); [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Challenge ID, hashed code, recipient, purpose, grant ID/version, expiry, attempts, consumed_at. GuestPrincipal distinct from creator user. Session records principal kind/id, assurance, revoked/expiry times. Legacy guest sessions require reauthentication.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. No guest can mint session without proof; logout revokes server access; no cross-actor identity attribution; five failed attempts triggers persisted cooldown.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Rate limits per recipient/IP/grant plus provider budget. Cookie Secure in staging/production, HttpOnly, SameSite; unsafe cookie actions need CSRF. Guest sessions cannot switch organisation.
7. **API request/response expectations:** OTP request returns opaque challenge ID and masked recipient; verify requires matching challenge ID/code and yields HttpOnly session plus CSRF. POST logout revokes authoritative current session and returns 204. Session exchange requires grant-bound verification proof, never arbitrary PIN.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Use real sent/pending/failure states; no OTP previews outside explicit local development. Logout completes only after server revocation and draft disposition; unavailable revocation is visible.
10. **Errors, validation and edge cases:** Expired/reused challenges fail uniformly; provider outage leaves retryable delivery state. Wrong-OTP attempt updates must commit even when HTTP response is an error; do not throw inside a transaction that rolls them back.
11. **Transaction and concurrency:** Atomic consume prevents concurrent success; DB guest attempts/cooldown updates persist on invalid response. OTP issuance rates enforced atomically. No read-then-delete consume race.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Delivery outbox through T11; challenge becomes usable only according to documented provider state. Do not log secrets.
14. **Required tests:** Parallel same-code requests yield one success; attempts/cooldown persist; arbitrary PIN fails; logout token replay fails; org switch and revoked membership deny; Redis outage fails closed.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Revoke vulnerable legacy guest sessions at cutover and issue fresh links. Disable guest session exchange if repair cannot be rolled out safely.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T03 — Centralize resource authorization and response projection

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T02 |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F002, TC-F003 |

1. **What and why:** Create one server policy service and resource resolver. Route/project IDs are hints; derive actual ownership from document/version/review/package. Carry grant scope into immutable actor context and revalidate it. Replace role denylist serialization with explicit projection per endpoint. Apply document.download separately from document.read.
2. **Existing modules/files to inspect:** [apps/api/src/common/guards/permission.guard.ts](../apps/api/src/common/guards/permission.guard.ts); [apps/api/src/common/guards/session-csrf.guard.ts](../apps/api/src/common/guards/session-csrf.guard.ts); [apps/api/src/common/interceptors/visibility-projection.interceptor.ts](../apps/api/src/common/interceptors/visibility-projection.interceptor.ts); [packages/shared/src/permissions.ts](../packages/shared/src/permissions.ts); [apps/api/src/database/tenant-db.service.ts](../apps/api/src/database/tenant-db.service.ts); [apps/api/src/modules/documents/documents.controller.ts](../apps/api/src/modules/documents/documents.controller.ts); [apps/api/src/modules/handover/handover.controller.ts](../apps/api/src/modules/handover/handover.controller.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Project membership active state, principal/grant and resource descriptors. Grant allowlist contains project, requirement revision IDs and optional frozen submission items. Empty scope denies. Every array target must pass.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. No unauthorised read/count/download/mutation across boundary matrix; policy table matches architecture; duplicate evaluators no longer govern independent runtime decisions.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Guest cannot inherit creator role; no scoped project role grants tenant-wide privileges. Allowlist fields for every guest role includes no commercial/internal-note/audit secrets.
7. **API request/response expectations:** Unauthorized foreign resource returns 404; visible but forbidden action returns 403; unauthenticated returns 401. Lists, search, counts, exports and signed URLs share identical scope predicates.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Hide unavailable actions but show an understandable permission explanation on reachable forbidden action. Project lists and search never reveal inaccessible item counts.
10. **Errors, validation and edge cases:** Missing membership query fails closed, not swallowed fallback. Revoked grant invalidates active session immediately for new actions; already-issued signed URL lasts at most its short TTL.
11. **Transaction and concurrency:** Check active grant and target scope within mutation transaction; row-version change/revocation serialization policy documented. No HTTP-only guard is sufficient for worker or internal callers.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Worker SYSTEM identities need explicit handler scope; do not grant general owner permissions.
14. **Required tests:** Two tenants and two projects per tenant; each role, grant and route alias; indirect IDs; all array positions; direct service calls; download permission distinct from view; nested DTO leakage tests.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Roll out policy comparison in synthetic/staging only, then enforce deny-first; never enable permissive fallback for compatibility.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T04 — Implement provider-backed upload and immutable revisions

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T03 |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F012, TC-F013 |

1. **What and why:** Replace hand-written multipart and signing with a maintained provider SDK during implementation. Lock parent for revision allocation. Use real multipart upload ID, ordered provider ETags, part listing/resume, complete/abort and immutable provider object-version sealing. Store declared versus observed bytes separately.
2. **Existing modules/files to inspect:** [apps/api/src/modules/documents/documents.service.ts](../apps/api/src/modules/documents/documents.service.ts); [apps/api/src/modules/documents/s3-storage.service.ts](../apps/api/src/modules/documents/s3-storage.service.ts); [apps/api/src/modules/documents/dto/upload-intent.dto.ts](../apps/api/src/modules/documents/dto/upload-intent.dto.ts); [apps/api/src/modules/documents/documents.controller.ts](../apps/api/src/modules/documents/documents.controller.ts); [packages/db/src/schema.ts](../packages/db/src/schema.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** UploadIntent with document/version/object, actor, expected hash/size, expiry and provider upload ID; immutable sealed object identity. Unique normalized revision code and monotonic version number per document. Source links remain proposals until qualified.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Uploaded original bytes match observed hash/size and immutable provider ID; READY impossible here; resume continues same revision; no local synthetic upload IDs.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Use workload credentials and private buckets. Signed PUT cannot replace sealed evidence: pin provider version or copy to immutable final key. Sanitize display names; opaque keys not filenames.
7. **API request/response expectations:** Intent returns IDs, partSizeBytes, parts with partNumber/uploadUrl/expiry, required headers, completion URL. Complete accepts ordered partNumber/etag and intent expected version; returns 202 PROCESSING receipt, never READY. Refresh returns only uncompleted eligible parts.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** One shared upload controller supports existing sheet/modal/mobile adapters; show original filename, exact revision, targets and recoverable progress. No synthetic ETag fallback.
10. **Errors, validation and edge cases:** Reject zero/negative/over-limit size, unsupported content, >1000 targets or configured cap, malformed checksum, duplicate/missing parts, stale/foreign intent. Initial product limits: 500 MiB file, max 100 requirement/asset links per action, enforced equally in UI/API/worker.
11. **Transaction and concurrency:** No provider network call inside long DB locks. Use staged intent state and compensating abort; lock document for allocation and compare-and-set lifecycle. Command receipt commits with completion outbox.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Stale-intent reconciliation aborts multipart but retains tombstones and original history; quota is reservation plus observed usage, not a client-provided size trust claim.
14. **Required tests:** Real provider single/multipart; expired URLs and refresh; two intents; forged ETags; late PUT after sealing; provider complete succeeds then DB crashes; duplicate complete; oversize mismatch.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Keep old uploads read-only while verifying bytes; unresolved legacy versions labelled unverified and blocked from new satisfaction. Disable unsupported file sizes instead of returning fake URLs.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T05 — Make file verification a complete bounded storage workflow

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T04 |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F009, TC-F028 |

1. **What and why:** Resolve object by stable ID, fetch pinned provider version to isolated bounded workspace, verify observed size/hash/type, run AV and format validation, and seal attestation. Remove simulation-path lookup from production streams. Separate sanitized preview from original. Reject production scanner-bypass flags.
2. **Existing modules/files to inspect:** [apps/worker/src/queues/file.processor.ts](../apps/worker/src/queues/file.processor.ts); [apps/worker/src/main.ts](../apps/worker/src/main.ts); [apps/worker/src/queues/format-converter.ts](../apps/worker/src/queues/format-converter.ts); [apps/api/src/modules/documents/documents.service.ts](../apps/api/src/modules/documents/documents.service.ts); [packages/pdf-engine/src/sanitise-pdf.ts](../packages/pdf-engine/src/sanitise-pdf.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** ProcessingAttempt records source provider version, observed bytes/digest/MIME, engine/signature versions, result/failure, lease token. DerivedArtifact references original and transformation version. READY means trustworthy file processing, not technical approval.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Full real upload reaches READY only after observed verification; unsafe/unavailable bytes never reviewed/downloaded; original immutable and derivative provenance explicit.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Bound memory/CPU/walltime/archive entries/uncompressed bytes and egress. No privileged parser, customer paths or document-supplied network fetches. Initial limit 1000 PDF pages, 25000 objects, 500 MiB uncompressed temporary footprint per file; measure and tune before larger claims.
7. **API request/response expectations:** Processing receipt GET exposes state, retryability, failure code and next retry time. Download endpoint authorizes scope and download capability; returns URL only for sealed READY original or approved safe derivative.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Unknown scan state remains verifying; malware says quarantined/contact support without allowing ordinary download. Preserve draft until remote receipt persists; do not auto-remove original or silently compress evidence.
10. **Errors, validation and edge cases:** Missing object/hash mismatch are permanent integrity failures. Scanner/network outage retries with capped exponential delay; parser timeout/limits return meaningful failure. OOXML containers inspected for expected format and prohibited active payloads; raw ZIP not treated as XLSX.
11. **Transaction and concurrency:** Claim attempt and persist result in tenant transactions; only active attempt may set verdict. Atomic version/object/observed quota/audit changes. Interrupted temp download retried without duplicate usage.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** FileProcessingRequested event carries IDs, not local paths; derivative generation follows verified source. Quarantine access only dedicated audited security role.
14. **Required tests:** Real clean/EICAR/mismatched/corrupt/encrypted/macro/bomb samples; unavailable scanner; malicious archive paths; stale attempt; concurrent 500 MiB input resource test; remote stream exact digest.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Disable formats failing validation; retain original source and attestations. Rollback can stop processing but cannot convert unverified to READY.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T06 — Unify transactions, idempotency, outbox and job recovery

| Planning field | Value |
|---|---|
| Priority | P1 |
| Prerequisites | T01, T03 |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F010, TC-F018, TC-F029 |

1. **What and why:** Move durable command receipt into application transaction; middleware validates key format only. Dispatcher discovers work through restricted tenant discovery then tenant-bound queries. Consumers use receipt, lease/fencing and expected aggregate state. Persist daily/weekly schedule buckets and renew long leases.
2. **Existing modules/files to inspect:** [apps/api/src/common/interceptors/idempotency.interceptor.ts](../apps/api/src/common/interceptors/idempotency.interceptor.ts); [apps/api/src/common/decorators/idempotency.decorator.ts](../apps/api/src/common/decorators/idempotency.decorator.ts); [packages/db/src/tenant-tx.ts](../packages/db/src/tenant-tx.ts); [apps/api/src/database/tenant-db.service.ts](../apps/api/src/database/tenant-db.service.ts); [apps/worker/src/main.ts](../apps/worker/src/main.ts); [apps/worker/src/scheduler.ts](../apps/worker/src/scheduler.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** CommandReceipt unique org/principal/operation/key with canonical request hash, committed status/body. Outbox schema-versioned envelope and dispatch state; consumer execution unique event/handler-version. ScheduleRun unique org/job/period.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Exactly one logical effect per command/event, durable response replay, no swallowed claim failure, no unknown event silently marked delivered; weekly digest occurs once per period.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Worker tenant context established on same connection as writes; dispatcher identity cannot mutate arbitrary domain rows. Receipt actor scope prevents cross-user replay leakage.
7. **API request/response expectations:** All mutation routes including aliases require key and expected version when modifying existing aggregate. 409 conflicting key, 428 missing precondition, 412 stale version, 202 long job receipt. Replays preserve response status and resource IDs.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Pending requests show recoverable receipt; Retry uses original key and does not create duplicate tasks or artifacts. Failed scheduled delivery displays actual state.
10. **Errors, validation and edge cases:** Claim database error blocks mutation. Unsupported event preserved/dead-lettered. Retryable failures back off; exhausted jobs visible with operator retry preserving original event identity. Redis loss recovers from DB.
11. **Transaction and concurrency:** Business change, receipt, audit and outbox same transaction; no async RxJS tap persistence. Lock/recheck in canonical order; retry deadlocks bounded only for idempotent commands.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Handler registry includes every emitted event or declares it audit-only. At-least-once queue transport; deduplicated effect, no exactly-once transport claim.
14. **Required tests:** Concurrent duplicate calls; changed payload; expired key; crash after commit before response; queue accepted then dispatcher crash; lost Redis; two schedulers; lease expiry; forced RLS.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Keep receipts/outbox compatible across deployments; pause consumers during incompatible handler rollout and replay after upgrade, never delete pending events to clear backlog.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T07 — Consolidate review, external response and authority

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T03, T05, T06 |
| Effort | 6–10 days |
| Risk | High |
| Findings/context | TC-F006, TC-F007, TC-F008 |

1. **What and why:** Create a single review command service and migrate every alias, external, bulk and stamp-back to it. Persist transmittal and items before issue. Remove caller override booleans; exceptions are separately authorised records. Keep historical review decisions append-only; correct via superseding decision.
2. **Existing modules/files to inspect:** [apps/api/src/modules/reviews/reviews.service.ts](../apps/api/src/modules/reviews/reviews.service.ts); [apps/api/src/modules/reviews/reviews.controller.ts](../apps/api/src/modules/reviews/reviews.controller.ts); [apps/api/src/modules/reviews/review-decision.service.ts](../apps/api/src/modules/reviews/review-decision.service.ts); [apps/api/src/modules/workflows/v021-workflows.service.ts](../apps/api/src/modules/workflows/v021-workflows.service.ts); [apps/api/src/modules/documents/documents.service.ts](../apps/api/src/modules/documents/documents.service.ts); [apps/api/src/modules/reviews/dto/decide-review.dto.ts](../apps/api/src/modules/reviews/dto/decide-review.dto.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Review cycle → sequential stages → parallel assigned reviewers → immutable decisions. Submission/transmittal items pin versions and requirement scope. External proof is verified version with named authority and occurred/recorded date precision. Conditions are typed follow-up actions.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Every authoritative decision passes same guard pipeline and has identity/proof provenance; no route directly approves requirements or files.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. No owner/admin automatic consultant acceptance. Exception may waive configured internal companion rule with explicit authority; never file integrity/tenant protection. Guest cannot record another party response.
7. **API request/response expectations:** Commands identify exact review stage and version, decision enum, comment, expectedRowVersion, optional valid exception ID. External response requires authority, reference, response date and proof version. Bulk returns per-item outcome for independent commands; issue one transaction per review decision, not partially applied item.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S06 review panel and S07 restricted external assignment. External response explicitly labelled recorded by contractor. Show current approved and newer pending version without substituting source.
10. **Errors, validation and edge cases:** Non-READY cannot enter review. Wrong stage/authority/self-approval denied. Meaningful rejection/change comment >=10 characters. Future response date invalid; source date unknown requires precision UNKNOWN. Same date is project-local inclusive. Proof must belong to same authorised scope and be READY.
11. **Transaction and concurrency:** Lock document then version then cycle/stage, re-read review state under lock, check expected version. Resolve all evidence rules before conclusion. New draft does not automatically invalidate historical approval; a review cycle targets submitted revision.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** ReviewDecisionRecorded triggers qualification reassessment and work-item update through transactional outbox.
14. **Required tests:** All route aliases parity; wrong reviewer; revoked grant; forged override; non-ready stamp-back; unrelated transmittal version; missing proof; concurrent decisions; rejection of R2 preserves R1; internal comment privacy.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Block legacy direct stamp-back path until migrated; preserve old reviews as legacy recorded assertions; never fabricate missing external authority.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T08 — Introduce version-pinned evidence qualification and readiness

| Planning field | Value |
|---|---|
| Priority | P1 |
| Prerequisites | T07 |
| Effort | 6–10 days |
| Risk | High |
| Findings/context | TC-F014, TC-F015 |

1. **What and why:** Add requirement revisions, evidence rules, exact-version links and immutable satisfaction assessments. Stop document-wide requirement status updates. Deterministically evaluate required slots, scope, stages, companion evidence, validity and asset identity. Store reason codes and inputs.
2. **Existing modules/files to inspect:** [apps/api/src/modules/checklists/checklists.service.ts](../apps/api/src/modules/checklists/checklists.service.ts); [apps/api/src/modules/reviews/reviews.service.ts](../apps/api/src/modules/reviews/reviews.service.ts); [apps/api/src/modules/handover/handover.service.ts](../apps/api/src/modules/handover/handover.service.ts); [packages/db/src/schema.ts](../packages/db/src/schema.ts); [packages/db/src/catalogue-rules.ts](../packages/db/src/catalogue-rules.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** RequirementEvidence references exact requirement revision, document version, asset identity revision, evidence role and decision. Assessment pins rule revision/date and member edges. Applicability and waiver are signed decisions with validity. Current status is a projection.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Readiness explains every result and reproduces from pinned inputs; package cannot gain satisfaction through mutable document pointer; no ambiguous legacy approval auto-backfilled as qualified.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Only assigned authority can qualify evidence scope; no ability to attach foreign-version IDs. Waiver needs required countersignature; changing applicability requires reason and authority.
7. **API request/response expectations:** Attach exact version as PROPOSED; qualify only after scoped review/rules. Readiness returns baseline/evaluatedAt/date plus one result per requirement, blockers, warnings and source IDs. No empty default on query failure.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S03 slot checklist and readiness explanation; accepted R1/pending R2; amendment impact preview with affected milestones and reassessment tasks. Waived/not-applicable distinct from satisfied.
10. **Errors, validation and edge cases:** No approval string alone can satisfy. ALL slots required unless explicit alternative group. Missing proof, expired required slot, mismatched serial/asset revision and unresolved mandatory condition block. Expiry date valid through local date; re-evaluation at proposed submission date.
11. **Transaction and concurrency:** Reassessment locks requirement revision or uses expected assessment epoch. Package snapshot evaluates in same repeatable-read transaction with locked baseline so concurrent changes cannot produce false snapshot. Deterministic order independent of SQL joins.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Review, expiry, scope amendment and asset replacement events produce new assessments; idempotent by cause/rule revision/evaluation date. Never rewrite past accepted package.
14. **Required tests:** Multi-doc ALL and explicit alternatives; one doc many scopes; expired companion; R2 rejected; query-order permutation; old asset serial; amendment; waived mandatory; race against package generation.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Dual-read and report differences before enforcing new gate; backfill ambiguous items as NEEDS_REASSESSMENT; preserve old state read-only for comparison.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T09 — Build real immutable dossiers, submissions and archives

| Planning field | Value |
|---|---|
| Priority | P1 |
| Prerequisites | T06, T08 |
| Effort | 7–12 days |
| Risk | High |
| Findings/context | TC-F011, TC-F024, TC-F025 |

1. **What and why:** Use one frozen manifest and compiler pipeline for handover, RA annexure and archive. Remove READY fallback and placeholder substitutions. Build from exact qualified versions; verify each object digest; store artifact and digest before READY. Distinguish index-only preview, incomplete draft and final package.
2. **Existing modules/files to inspect:** [apps/api/src/modules/handover/handover.service.ts](../apps/api/src/modules/handover/handover.service.ts); [apps/api/src/modules/handover/handover.controller.ts](../apps/api/src/modules/handover/handover.controller.ts); [apps/worker/src/main.ts](../apps/worker/src/main.ts); [apps/worker/src/queues/pdf-stream-compiler.ts](../apps/worker/src/queues/pdf-stream-compiler.ts); [apps/worker/src/queues/pdf.processor.ts](../apps/worker/src/queues/pdf.processor.ts); [packages/pdf-engine/src/package-builder.ts](../packages/pdf-engine/src/package-builder.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Manifest purpose HANDOVER/RA_ANNEXURE/ARCHIVE; scope, baseline, evaluation date, rule/compiler versions, exact members, assessment IDs, exclusions and output artifacts. Submission recipients and decisions separate from delivery state. Archive includes originals and deterministic UTF-8 manifest bytes plus digests.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. READY always has retrievable checksum-verified artifact and frozen manifest; issued contents reproducible; no fabricated page/source; RA and archive use same provenance controls.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Grant recipient access only to frozen submission items; no live project browsing. Proof and original downloads individually authorised. Acceptance authority explicitly named; internal PM can record proof but not impersonate client.
7. **API request/response expectations:** POST package returns 202 packageId/state/receipt; GET manifest and build state; GET download requires READY artifact. Issue submission requires frozen READY package and named required recipients. Recipient response command carries scope, decision, exceptions, proof and expected version.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S08 builder, manifest preview, blocking conditions, artifact progress and recipient response. Index-only output visibly labelled. Package override may produce incomplete draft only, never final-ready acceptance assurance.
10. **Errors, validation and edge cases:** Missing or mismatched member fails build. Non-PDF remains an original archive attachment with explicit index entry; optional safe PDF rendition labelled derived. ToC page counts calculated after actual front-matter pagination; no fixed two-page assumption. Zero required recipients cannot autoaccept.
11. **Transaction and concurrency:** Lock project sequence/baseline to allocate package numbers. Snapshot and outbox atomic. Worker uses fenced build attempt; publish output only after storage verification. Recipient aggregation locks submission and recomputes all required decisions.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Compile and archive jobs with bounded resources; output attempt-specific key then atomic artifact reference. Submission deliveries T11; resend does not create acceptance or new package.
14. **Required tests:** Crash during build/upload/commit; missing original; very long ToC; duplicate docs and multi-slot evidence; invalid non-PDF; two final recipient decisions; exceptions then rejection; independent offline archive digest verification.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Keep issued legacy packages immutable and label legacy-unverified where needed; allow new version build only. Pause compiler on integrity failure; never rebuild over issued object.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T10 — Remove false signature assurance

| Planning field | Value |
|---|---|
| Priority | P0 |
| Prerequisites | T03 |
| Effort | 2–4 days |
| Risk | High |
| Findings/context | TC-F016 |

1. **What and why:** Disable cryptographically verified/sealed claims based on supplied metadata. MVP stores external signature document as evidence only. Public verification, if retained, explicitly distinguishes record exists, digest compared and cryptographic/trust validation not performed.
2. **Existing modules/files to inspect:** [apps/api/src/modules/signatures/digital-signature.service.ts](../apps/api/src/modules/signatures/digital-signature.service.ts); [apps/api/src/modules/signatures/digital-signature.controller.ts](../apps/api/src/modules/signatures/digital-signature.controller.ts); [apps/web/src/components/views/packages-view.tsx](../apps/web/src/components/views/packages-view.tsx). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** SignatureRecord has asserted metadata separate from verification report. Verification report includes checked_at, bytes/object version, verifier version, certificate-chain result, revocation and timestamp results when actual future verifier exists.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Product makes only supported trust claims and all existing sealed events are relabelled as recorded assertions for display.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Public enumeration throttled; opaque verification code, no unrestricted RLS bypass. Certificate processing later needs dedicated constrained verifier and authority review.
7. **API request/response expectations:** No candidate bytes/hash returns verificationStatus NOT_CHECKED; matching candidate hash returns DIGEST_MATCH only. Never verified true from existence. Restrict metadata registration to authorised evidence recorder and target scope.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Remove certification badges and say External signature recorded; source proof inspectable. Public view discloses minimal metadata and no private originals.
10. **Errors, validation and edge cases:** Unknown record gives generic 404; fabricated PKCS7, absent hash and self-asserted issuer cannot become cryptographic trust. No claim of legal validity from digest equality.
11. **Transaction and concurrency:** Append verification result; never overwrite historical supplied metadata to make it appear validated.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** No signing service or new signature generation in MVP.
14. **Required tests:** No hash, wrong hash, matching hash, malformed signature, foreign target and public metadata disclosure.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Feature may remain disabled. Keep original signed bytes and prior asserted metadata for audit; no destructive purge.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T11 — Implement real delivery and notification lifecycle

| Planning field | Value |
|---|---|
| Priority | P2 |
| Prerequisites | T02, T06 |
| Effort | 4–7 days |
| Risk | High |
| Findings/context | TC-F017 |

1. **What and why:** Implement selected real SMS/email adapters; provider configuration is not proof of send. Share delivery service for member/guest OTP and submissions/follow-up. Preserve outbound intent, provider acceptance and delivery feedback separately. No automatic WhatsApp sending in MVP.
2. **Existing modules/files to inspect:** [apps/api/src/modules/identity/identity.module.ts](../apps/api/src/modules/identity/identity.module.ts); [apps/api/src/modules/parties/parties.service.ts](../apps/api/src/modules/parties/parties.service.ts); [apps/api/src/modules/notifications/notifications.service.ts](../apps/api/src/modules/notifications/notifications.service.ts); [apps/worker/src/main.ts](../apps/worker/src/main.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** MessageIntent and DeliveryAttempt with recipient, purpose, template revision, provider ID, status/retry; callback receipt idempotent. Store minimal redacted message/audit data; OTP payload secret short-lived.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Actual recipient receives valid challenge and submitted package link in sandbox; product never reports delivered from config presence alone.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Validate webhook signature/replay window, recipient rates and template constraints. Production startup rejects dummy adapters; least-privilege provider secrets.
7. **API request/response expectations:** Request endpoint returns delivery pending/accepted truthfully. Signed provider callbacks update attempt status; callback duplicate is harmless. Resend bounded and deliberate.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Visible delivery failed or waiting state; copy/share link is user-initiated, distinctly labelled from sent. Notification read does not complete business work.
10. **Errors, validation and edge cases:** Provider timeout may be unknown delivery; lookup/idempotency before resend to avoid pumping. Bounce/invalid target creates action. Fallback email must be verified/authorised for intended identity.
11. **Transaction and concurrency:** Outbox on business message creation; callback receipt and status update atomic; OTP-specific expiry evaluated before dispatch.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Bounded retry for transient send, dead-letter operator queue, no retry beyond OTP validity.
14. **Required tests:** Provider sandbox delivery; timeout-after-accept; bounce; duplicate/forged callback; expired OTP queue; quota enforcement; wrong fallback recipient.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Disable optional channel on outage while retaining durable requests; identity fails clearly if no verified channel exists.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T12 — Consolidate uploads and secure offline work

| Planning field | Value |
|---|---|
| Priority | P1 |
| Prerequisites | T04, T05, T06 |
| Effort | 5–8 days |
| Risk | High |
| Findings/context | TC-F019, TC-F020, TC-F021 |

1. **What and why:** One upload state controller for online/offline flows; remove synthetic-success/dead demo branches after import inventory. Persist actor/org/grant partition and upload receipt, use real provider ETags and refresh URLs. Separate uploaded/transmitted from verified/ready.
2. **Existing modules/files to inspect:** [apps/web/src/lib/offline-upload-queue.ts](../apps/web/src/lib/offline-upload-queue.ts); [apps/web/src/lib/draft-storage.ts](../apps/web/src/lib/draft-storage.ts); [apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts); [apps/web/src/components/upload-sheet.tsx](../apps/web/src/components/upload-sheet.tsx); [apps/web/src/components/modals/upload-modal.tsx](../apps/web/src/components/modals/upload-modal.tsx); [apps/web/src/components/modals/upload-evidence-modal.tsx](../apps/web/src/components/modals/upload-evidence-modal.tsx); [apps/web/public/sw.js](../apps/web/public/sw.js); [apps/web/src/components/pwa-register.tsx](../apps/web/src/components/pwa-register.tsx). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Offline item partition org+principal+grant, stable command IDs, original blob/hash, intent/version, provider parts, state and last server result. Migration quarantines old unscoped drafts until user explicitly claims or exports them under correct identity.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. No local item deleted merely because ten seconds elapsed; no previous actor data displayed or uploaded; upload success maps to server state only.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. No authenticated API or presigned URL caching; draft visibility filtered before enumeration. Local shared-device threat explicitly communicated. Retain original and derivative separately if compression enabled later.
7. **API request/response expectations:** Use T04 upload and T05 receipt contracts. Retry uses same command IDs; polling timeout remains PROCESSING and survives reload. Never auto-resubmit under a different actor.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S04 mobile capture, storage quota/error/retry UI, queue list with per-item status, resume and safe discard. Logout/switch requires keep-for-current-actor, export or discard draft decision; no claim of encrypted local storage by browser alone.
10. **Errors, validation and edge cases:** IndexedDB quota denied, expired session/URL, no window for background sync and tab closure preserve recoverable state. No automatic byte-altering photo compression for original evidence.
11. **Transaction and concurrency:** IndexedDB transaction per durable state update; cross-tab lease prevents duplicate drain; server command receipt final authority. Clear actor queries and caches on switch.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Background sync is best-effort wake-up, not guaranteed OS transfer; foreground reconciliation on login/visibility/network return.
14. **Required tests:** Offline/reload/tab race; delayed scan >60sec; repeated poll errors; malware result; actor/tenant switch; logout failure; quota denied; expired part URLs; no fake success after 4xx/5xx.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Old controller can be removed only after all imports replaced; incompatible local drafts retained for explicit recovery, never silently dropped.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T13 — Establish representative automated release tests

| Planning field | Value |
|---|---|
| Priority | P2 |
| Prerequisites | T07, T09, T12 |
| Effort | 4–7 days |
| Risk | High |
| Findings/context | TC-F026 |

1. **What and why:** Keep useful tests but replace assertions that approve all document-linked requirements. Add disposable PG runtime/migrator roles, storage and scanner integration plus complete browser workflow. Align supported package manager/version and frozen lockfile. No seeded privileged path substitutes for HTTP lifecycle.
2. **Existing modules/files to inspect:** [apps/api/jest.config.ts](../apps/api/jest.config.ts); [apps/api/test/rls-isolation.spec.ts](../apps/api/test/rls-isolation.spec.ts); [apps/api/test/concurrency.spec.ts](../apps/api/test/concurrency.spec.ts); [apps/api/test/phase0-evidence-integrity-remediation.spec.ts](../apps/api/test/phase0-evidence-integrity-remediation.spec.ts); [apps/web/e2e/critical-flows.spec.ts](../apps/web/e2e/critical-flows.spec.ts); [.github/workflows/deploy.yml](../.github/workflows/deploy.yml); [package.json](../package.json). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Test fixtures explicitly name tenant, project, principal and immutable bytes. Coverage matrix ties each trust invariant to a real integration test and each user journey to browser evidence.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Release workflow fails on any mandatory gate; exact commit, package/tool versions and artifacts retained; no perfect-score claims from mock suite.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Run runtime role with forced RLS, cross-tenant/project attempts, public guest and signature abuse. Current dependency advisory check with explicit exception owner/expiry.
7. **API request/response expectations:** Assert status/body/precondition/error contracts for all legacy aliases until removal. Ensure no production seed is needed to boot a fresh installation.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Automate role journeys S01–S08, keyboard review, error states, mobile uploads and server-truth labels. Add manual assistive-technology check where automation insufficient.
10. **Errors, validation and edge cases:** Unavailable service fails test suite visibly, not skipped-as-pass. Document scanner corpus and flaky-resource policy. No mutable customer DB in test setup.
11. **Transaction and concurrency:** Concurrency tests use separate real DB connections and controlled barriers; mock SQL substring checks cannot prove row locking.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** CI starts isolated services and bounded test workers; caches pinned tools, collects logs with secrets redacted.
14. **Required tests:** Compile API/web/worker/shared/db; unit/policy; migration fresh/upgrade; real integration; browser; security; recovery rehearsal evidence gate.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Split lanes for fast feedback but no bypass of release gates. Pin known reproducible environment, never relax lockfile to make CI pass.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T14 — Complete production operations and recovery

| Planning field | Value |
|---|---|
| Priority | P2 |
| Prerequisites | T01, T06, T09 |
| Effort | 5–9 days |
| Risk | High |
| Findings/context | TC-F027, TC-F030 |

1. **What and why:** Inventory actual deployment; define staged production topology, workload IAM, private DB/storage, TLS, environment/secret separation, image/tool pins, telemetry, alerts and incident runbooks. Replace row-count-only restore with whole evidence-chain recovery. Inspect materializer scripts to prevent reintroducing old paths.
2. **Existing modules/files to inspect:** [infra/terraform/main.tf](../infra/terraform/main.tf); [infra/docker/docker-compose.yml](../infra/docker/docker-compose.yml); [scripts/run-restore-drill.sh](../scripts/run-restore-drill.sh); [scripts/execute-runbooks.ts](../scripts/execute-runbooks.ts); [apps/api/src/modules/health/health.controller.ts](../apps/api/src/modules/health/health.controller.ts); [apps/api/src/main.ts](../apps/api/src/main.ts); [.github/workflows/deploy.yml](../.github/workflows/deploy.yml). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** Operational backup checkpoint ties DB recovery time and immutable object versions; restore report lists sample evidence chain, all manifest objects, digests, permissions, measured RPO/RTO and operator.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Measured recovery within agreed targets and documented operational owner; no open High/Critical trust defect; evidence proves environment not merely Terraform intent.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Runtime IAM minimal; deploy/migrator identities isolated. Audit durable restricted-write storage, legal holds, secret rotation, logs minimised and retained under reviewed policy.
7. **API request/response expectations:** Health separates liveness/readiness and worker capabilities. Operational diagnostics require operator auth and reveal no tenant records or secrets.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** User sees processing degraded, last evaluated readiness time and recovery-safe retry, never false success during outage. Publish clear export and post-subscription access terms.
10. **Errors, validation and edge cases:** Test DB/storage/Redis/provider/scanner outage, full disk, worker crash and expired credentials. Operator containment disables unsafe capability and preserves evidence; no destructive cleanup as recovery.
11. **Transaction and concurrency:** Release uses backward-compatible schemas and worker versions; backups include object references and encryption key recovery plan. No rollback by deleting decisions.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Alerts from production readiness report; periodic restore and integrity reconciler, backup freshness and chain checkpoints.
14. **Required tests:** Isolated restore complete dossier; random original hashes; tenant policy after recovery; incident tabletop; TLS/IAM review; object version recovery; load/resource budgets.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Rollback traffic to compatible image; maintain originals, backups and receipts. Production stop if integrity reconciliation fails.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T15 — Deliver unified workspace, inbox and controlled baseline import

| Planning field | Value |
|---|---|
| Priority | P3 |
| Prerequisites | T08, T12 |
| Effort | 6–10 days |
| Risk | Medium; business authority and migration still require careful review |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Implement UX navigation and S01–S03/S10 in vertical slices. Split project page by domain routes/view composition. Add actionable inbox read model from pending obligations/reviews, bounded search and bulk preview. Controlled import creates revisioned baseline and impact report; no silent overwrite of approved scope.
2. **Existing modules/files to inspect:** [apps/web/src/app/(contractor)/layout.tsx](<../apps/web/src/app/(contractor)/layout.tsx>); [apps/web/src/app/(contractor)/dashboard/page.tsx](<../apps/web/src/app/(contractor)/dashboard/page.tsx>); [apps/web/src/app/(contractor)/projects/[projectId]/page.tsx](<../apps/web/src/app/(contractor)/projects/[projectId]/page.tsx>); [apps/web/src/components/layout/sidebar.tsx](../apps/web/src/components/layout/sidebar.tsx); [apps/web/src/components/layout/header.tsx](../apps/web/src/components/layout/header.tsx); [apps/api/src/modules/checklists/checklists.service.ts](../apps/api/src/modules/checklists/checklists.service.ts); [apps/api/src/modules/organisations/organisations.service.ts](../apps/api/src/modules/organisations/organisations.service.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** WorkItem projection derived from source state, not independent completion checkbox. SavedView scoped org/principal. ImportDraft/RowError/CommitReceipt with source row numbers; baseline revision and source file version. Ownership transfer records old/new owner and reason.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. One primary upload/review/navigation path; real user can import register, assign work and resolve next action without code-facing taxonomy; no phantom completion controls.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Search/results/counts projected after permission filtering; saved views cannot widen policy. Offboarding revokes access immediately even if some reassignment needs admin action.
7. **API request/response expectations:** Cursor pagination default 50/max100; stable sort by due date then ID; permission-filtered counts/search. Bulk up to100 rows returns each outcome and command receipt. Import preview no domain writes; commit once with expected baseline version.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Apply specified tokens, states, role home and screens; preserve filters in URL within actor scope. Accessible tables/dialogs, keyboard path and responsive layouts. Hide incomplete optional modules.
10. **Errors, validation and edge cases:** No work versus failed query distinguished. Unknown import types remain errors; duplicates require explicit merge/skip decision. Offboarding preview assigns open work before or concurrently with access removal.
11. **Transaction and concurrency:** Projection idempotent per source event/version and rebuildable; baseline commit locks project baseline; import duplicates cannot bypass revision uniqueness.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Outbox updates inbox; reconciliation rebuilds missing projections; large import async with row receipt.
14. **Required tests:** Import realistic fixture mapping/duplicates; two concurrent commits; inbox reassign/completion; foreign search; keyboard/mobile; five-of-six uncoached task usability target.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Feature-flag new routes; preserve deep-link redirects and imports; keep old views read-only until parity, then remove duplicate implementations.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T16 — Complete equipment identity and supplier documentary workflow

| Planning field | Value |
|---|---|
| Priority | P3 |
| Prerequisites | T08, T15 |
| Effort | 7–12 days |
| Risk | Medium; business authority and migration still require careful review |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Expose system/location hierarchy, asset identity revision, revalidation and S05 passport. Complete PO documentary lines and supplier request intake; model PO line quantity independently of individual assets and allow many installed units per line. Persist returned comment closure and portal submission references.
2. **Existing modules/files to inspect:** [apps/api/src/modules/assets/assets.service.ts](../apps/api/src/modules/assets/assets.service.ts); [apps/api/src/modules/assets/assets.controller.ts](../apps/api/src/modules/assets/assets.controller.ts); [apps/api/src/modules/parties/parties.service.ts](../apps/api/src/modules/parties/parties.service.ts); [apps/api/src/modules/parties/supplier-guest.service.ts](../apps/api/src/modules/parties/supplier-guest.service.ts); [packages/db/migrations/0006_discovery_and_lifecycle_foundations.sql](../packages/db/migrations/0006_discovery_and_lifecycle_foundations.sql); [packages/db/migrations/0007_procurement_and_vendor_obligations.sql](../packages/db/migrations/0007_procurement_and_vendor_obligations.sql); [apps/web/src/app/(guest)/guest/[token]/page.tsx](<../apps/web/src/app/(guest)/guest/[token]/page.tsx>). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** AssetIdentityRevision effective-dated; replacement links prior/new physical unit and tag alias. PO line → AssetSupplyAllocation many assets; SupplierObligation links requirement revision and stage. Documentary request received/verified/intake accepted separately from technical approval. CommentResponse pins old/new page/version.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Passport never treats old unit evidence as approved for replacement without requalification; supplier upload receipt cannot approve requirement.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Composite tenant/project constraints on all links; QR opaque and authenticated; external supplier sees assigned documentary schedule only, no PO prices by default.
7. **API request/response expectations:** Passport returns identity and qualified exact evidence; revision command change type/reason/effective date/expected version; supplier request pins obligation IDs and grant. Portal receipt records destination/reference/issued version/proof, not automated upstream approval.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S05 identity impact wizard and S07 request list; serial collision warning; generic versus serial-specific document indicator; bulk label preview; supplier cannot choose arbitrary target.
10. **Errors, validation and edge cases:** Relocation need not invalidate every document; policy determines impacted slots. Replacement/substitution triggers revalidation; serial uniqueness allows known manufacturer cases only via explained exception. Revoked supplier link cannot finish or fetch new URLs.
11. **Transaction and concurrency:** Lock asset revision counter, affected links in deterministic order; new identity and revalidation tasks atomic. PO cancellation preserves obligations and history with cancelled state.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** IdentityChanged triggers revalidation; supplier due follow-up draft not auto-sent; portal status import is proposed until human confirms source.
14. **Required tests:** Reused tag/new unit; wrong serial generic manual; PO quantity>1; duplicate imported serial; partial delivery; supplier scope; conditional response closure and QR revocation.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Preserve old identity rows and evidence; new identity features optional until migrated; no destructive tag reassignment.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T17 — Add inspections and commissioning with instrument traceability

| Planning field | Value |
|---|---|
| Priority | P3 |
| Prerequisites | T16 |
| Effort | 10–16 days |
| Risk | Medium; business authority and migration still require careful review |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Create quality and commissioning modules after inspecting existing asset/checklist/defect boundaries. Freeze template revision per inspection/test run; model prerequisites, hold/witness points, instrument certificate validity at actual test time, structured measurements and retests. No universal HVAC pass thresholds.
2. **Existing modules/files to inspect:** [apps/api/src/modules/assets/assets.service.ts](../apps/api/src/modules/assets/assets.service.ts); [apps/api/src/modules/checklists/checklists.service.ts](../apps/api/src/modules/checklists/checklists.service.ts); [apps/api/src/modules/billing/warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts); [packages/db/src/schema.ts](../packages/db/src/schema.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** TemplateRevision with fields/units/tolerance/source; InspectionRun scope and witness state; TestRun asset/system, procedure, actual time, conditions and performer; TestReading decimal-string/unit/target/lower/upper/pass; Instrument and CalibrationVersion; RunInstrument and RetestLink. Generated report becomes a document version.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Every accepted run traces procedure, actual readings, instrument versions, performer and witness; requirements satisfy only through qualified report/review.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Only assigned performer edits draft; assigned witness/verifier records result; instrument metadata source protected. AI cannot certify readings or pass.
7. **API request/response expectations:** Create draft run, save readings, request witness, submit result, verify/return, create retest. Submission requires required values, units, procedure revision, instruments and proof. Result cannot be edited after submission; new revision/retest required.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** New Quality screens: assigned runs, mobile capture, prerequisite checklist, readings with units, witness status, failed values and retest history; publish report to ordinary evidence review.
10. **Errors, validation and edge cases:** Invalid/missing calibration at test time blocks certification unless explicit contractual exception with authority, never retroactive silent validity. Missing reading is unknown not zero. Seasonal deferred tests carry due date and acceptance condition.
11. **Transaction and concurrency:** Run revision and reading set atomically validated on submit; concurrent draft edits expected version. Retests do not overwrite failed results.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Generate verified report as derivative with provenance; reassess associated requirement through normal workflow. Witness reminders T11.
14. **Required tests:** Unit mismatch, tolerance boundaries, expired-at-test calibration, future calibration, missing reading, offline capture conflict, failed test/retest, hold release and seasonal deferral.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Pilot uploaded test reports remain valid legacy evidence; structured forms introduced per template; no auto-conversion of PDF readings into certified data.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T18 — Add sectional acceptance, defects, warranty and DLP

| Planning field | Value |
|---|---|
| Priority | P3 |
| Prerequisites | T09, T16 |
| Effort | 7–12 days |
| Risk | Medium; business authority and migration still require careful review |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Extract aftercare from SaaS billing. Track acceptance by scope, conditional exceptions, training and spares transfer. Separate OEM asset warranty from contractor DLP; anchor dates to recorded contractual events and never default to upload date. Defect closure requires remedy proof plus verifier.
2. **Existing modules/files to inspect:** [apps/api/src/modules/handover/handover.service.ts](../apps/api/src/modules/handover/handover.service.ts); [apps/api/src/modules/billing/warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts); [apps/web/src/components/views/warranties-view.tsx](../apps/web/src/components/views/warranties-view.tsx); [packages/db/src/schema.ts](../packages/db/src/schema.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** AcceptanceScope and RecipientDecision; AcceptanceException owner/due/condition; TrainingSession attendance/proof; SparesTransfer quantity/unit/receipt; WarrantyTerm asset and start basis/duration/source; DLPTerm project/scope and anchor event; Defect with location/asset, remedy and closure verification.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Every period traces source terms and anchor; every closed defect has authorised verified remedy; conditional acceptance retains actionable exceptions.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. External client can raise/verify only granted scope; contractor records external proof without impersonating. No site self-verification of own remedy if policy forbids.
7. **API request/response expectations:** Anchor confirmation requires event/proof/version; changing it records superseding event and impact summary. Defect states OPEN→ASSIGNED→REMEDIED→VERIFICATION→CLOSED or REOPENED, with reason/proof on every terminal decision.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S09 aftercare timelines show anchor pending, disputed, active, ending, expired separately; exception deadlines and service inbox. Defects show remedy-versus-verified closure distinctly.
10. **Errors, validation and edge cases:** Partial handover starts only applicable scope periods. OEM commissioning warranty may differ from DLP; replacement warranty does not rewrite original. Reopened defect does not automatically extend all periods; contract rule decides.
11. **Transaction and concurrency:** Lock defect for remedy/verify; append period anchor changes and recalculate projections atomically. Concurrent recipient decisions recompute under submission lock.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Expiry and exception jobs period-bucketed; create actions, no automatic certification or commercial release.
14. **Required tests:** Partial acceptance, exception rejection, anchor pending, replacement during warranty, defect reopening, closure missing proof, overlapping periods and revoked verifier.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Keep prior entered dates labelled asserted until confirmed; preserve all service history and do not auto-expire disputed obligations.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T19 — Deliver commercial milestone and retention readiness

| Planning field | Value |
|---|---|
| Priority | P3 |
| Prerequisites | T08, T09, T18 |
| Effort | 7–12 days |
| Risk | Medium; business authority and migration still require careful review |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Create project commercial-readiness boundary distinct from TradeCloseout subscription invoicing. Record milestone prerequisites, RA bill references, JMR/MB evidence and retention tranches. Track eligible/applied/certified/received and disputed independently. Do not build accounts, GST engine or money movement.
2. **Existing modules/files to inspect:** [apps/api/src/modules/billing/warranty-and-billing.service.ts](../apps/api/src/modules/billing/warranty-and-billing.service.ts); [apps/api/src/modules/billing/billing.controller.ts](../apps/api/src/modules/billing/billing.controller.ts); [apps/api/src/modules/projects/projects.service.ts](../apps/api/src/modules/projects/projects.service.ts); [apps/api/src/modules/handover/handover.service.ts](../apps/api/src/modules/handover/handover.service.ts); [apps/web/src/app/(contractor)/billing/page.tsx](<../apps/web/src/app/(contractor)/billing/page.tsx>); [packages/db/src/schema.ts](../packages/db/src/schema.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** ContractMilestone source clause/scope/evidence-rule; BillReference number/period/claimed amount/currency, external accounting reference; BillEvidenceManifest exact qualified versions; RetentionTranche amount basis/cap/release condition/source; ReleaseApplication, CertificationResponse and PaymentReceipt with amount/proof. Amount strings integer paise; signed adjustments append-only.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. Readiness is explainable prerequisite status, certification/receipt separate; every amount traces entered source/adjustment and no payment guaranteed.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. Commercial values require distinct role grant and field projection; supplier/client portal cannot browse rates. AI cannot change amount/date/receipt state.
7. **API request/response expectations:** Readiness returns documentary prerequisite results plus separately recorded certification/payment state. Commands require commercial grant and expected version. Amount input validates nonnegative integer paise and currency INR for MVP; no binary floating-point calculations.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** S09 stage board and bill annexure builder; labels Ready to apply, Applied, Certification pending, Partially received, Disputed. No automatic entitlement statement or paid mark from handover acceptance.
10. **Errors, validation and edge cases:** Contract-specific rates/caps/anchors; no default retention percentage or DLP. Partial payments and offsets require explicit sourced records. Tax/TDS entries remain external informational references, not inferred statutory liabilities.
11. **Transaction and concurrency:** Lock tranche for adjustment/application allocation; aggregate receipts from immutable events, prevent duplicate external receipt references, exact paise arithmetic and over-allocation checks with explicit permitted adjustments.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Milestone assessment follows satisfaction events; reminders draft via T11; export to accounting tool by explicit mapping, not ledger write.
14. **Required tests:** Partial retention release, capped basis, varied contract terms, duplicate receipts, zero/large amounts, unapplied evidence, disputed acceptance, amount privacy and immutable annexure.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Launch read-only readiness first; retain asserted historic figures with provenance; no destructive recalculation of certified/received values.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.

## T20 — Evaluate gated differentiation and assistive AI

| Planning field | Value |
|---|---|
| Priority | P4 |
| Prerequisites | T13, T14, T15 |
| Effort | 5–8 days for evaluation; 3–6 days per accepted AI slice |
| Risk | High |
| Findings/context | Product/domain gap; see domain research and UX specification |

1. **What and why:** Implement proposal-only AI architecture after customer processing permission and offline evaluation. Start AI01 classification and AI02 metadata; defer other capabilities until their measured value and isolation pass. Non-AI P4 opportunities O13/O16/O18/O23/O26/O29 require separate discovery gates; do not code whole catalogue as one feature.
2. **Existing modules/files to inspect:** [apps/api/src/modules/documents/documents.service.ts](../apps/api/src/modules/documents/documents.service.ts); [apps/api/src/modules/assets/assets.service.ts](../apps/api/src/modules/assets/assets.service.ts); [apps/api/src/modules/checklists/checklists.service.ts](../apps/api/src/modules/checklists/checklists.service.ts); [apps/api/src/modules/notifications/notifications.service.ts](../apps/api/src/modules/notifications/notifications.service.ts); [apps/worker/src/main.ts](../apps/worker/src/main.ts). Read actual controller wiring, callers and migrations before moving logic.
3. **Likely changes/new components/removals:** Adapt the listed modules; create focused application services, DTOs, relationship/receipt records and screen components needed for the specified behaviour. Physical new-file placement follows the listed owning module. Remove superseded implementations only after call-site inventory, route parity tests and preserved history. No unrelated refactors.
4. **Domain entities, fields and relationships:** AiRun source versions/digests/parser/model/prompt/provider/cost/tenant; AiProposal field or mapping/value/citations/confidence/status; UserDisposition accepted/edited/rejected and actor. Retrieval index ACL metadata and source digest; no authority command access.
5. **Business rules and invariants:** The shared contracts above plus every stated guard are mandatory. No authority-bearing state or monetary value changes autonomously; critical fields manually verified; accepted-proposal accuracy/cost and operator time justify rollout.
6. **State transitions and permissions:** Follow target-architecture state tables and authority matrix; this task adds no implicit approval authority. ACL filter before retrieval and on each result; processor region/retention terms approved; redact sensitive information; no cross-tenant training/reuse; no autonomous external send.
7. **API request/response expectations:** POST assistance returns 202 run receipt; GET proposals includes source page coordinates and uncertainty. Accept proposal changes draft metadata only through normal authorised versioned command; no approve/waive/accept/amount endpoint available to model.
8. **Database changes:** Add or adapt the entities/fields in item 4 using additive migration, composite keys, validated enums/check constraints, indexes for scoped reads and immutable historical references. If no new entity is required, preserve schema and prove existing constraints. Reconcile Drizzle and SQL. Do not rewrite applied migrations.
9. **Frontend/UX:** Draft suggestions visibly separate from verified fields, source preview and Accept/Edit/Reject; explicit unknown states; per-project opt-in and spend display. No silent extraction writes.
10. **Errors, validation and edge cases:** Malformed/prompt-injected document, no citations, low confidence or provider outage gives abstain/failed advisory, never changes domain state. Per-tenant budget and retry cap enforced.
11. **Transaction and concurrency:** Idempotent run key source digest+model/prompt revision+operation; proposal acceptance expected version prevents stale overwrite. Index deletion/legal hold honours original retention policy.
12. **Security/data protection:** Apply item 6 at service boundary as well as HTTP; redact secrets and keep guest projections explicit. New fields cannot silently enter external DTOs.
13. **Background jobs/integrations:** Bounded OCR/classification/extraction queue; all outputs untrusted until human verification. Cost ledger authoritative per provider attempt.
14. **Required tests:** Labelled holdout with OCR/date/serial ambiguity; malicious instructions; no cross-tenant citations; revoked access; spend cap; human correction time; provider failure.
15. **Acceptance evidence:** Demonstrate item 5 using the real boundary involved. A source comment or mocked success is insufficient. Attach API/browser/artifact/DB evidence appropriate to the task.
16. **Implementation sequence:** Inspect current wiring → document schema/route impact → additive persistence and policy → application command → read contract → jobs/provider → UX → negative/concurrency tests → migration/release evidence. Dependencies in planning table must be satisfied before enabling the feature.
17. **Rollout:** Enable in disposable integration environment, verify against representative contractor fixtures, compare legacy/new projections where applicable, then pilot by explicit project feature flag. No fake fallback to maintain demo appearance.
18. **Risks and rollback:** Feature flag stops new runs, retains reviewed provenance, deletes transient indexes per policy; product core works entirely without AI.
19. **Completion handoff:** Record files actually changed, migrations and environment prerequisites, route aliases retired, invariant tests/results and any unresolved release blocker. If an unknown would alter contractual authority, isolate and document it; do not silently invent a default.
