# Consolidated finding register

Audit date: 2026-11-05. Scope: current working tree, including pre-existing uncommitted remediation. This register owns finding IDs; other reports reference these IDs without creating duplicate defects. Confirmed means source establishes the behaviour; it does not mean a live exploit was attempted. Risk means a deployment or load condition remains unverified. Critical denotes a direct trust boundary or false contractual assurance; High denotes a release blocker or material workflow failure. Confidence describes evidence, not likelihood.

| ID | Severity | Confidence | Class | Finding | Task |
|---|---|---|---|---|---|
| TC-F001 | Critical | High | Confirmed | OTP-required guest session bypass | T02 |
| TC-F002 | Critical | High | Confirmed | Guest grant context is dropped | T03 |
| TC-F003 | High | High | Confirmed | Resource-ID routes lack project membership enforcement | T03 |
| TC-F004 | High | High | Confirmed | Server logout does not revoke sessions | T02 |
| TC-F005 | High | High | Confirmed | Browser logout never reaches server | T02 |
| TC-F006 | Critical | High | Confirmed | Stamp-back bypasses review invariants | T07 |
| TC-F007 | High | High | Confirmed | Canonical route omits required reviewer-role validation | T07 |
| TC-F008 | High | High | Confirmed | Client override bypasses separation of duties | T07 |
| TC-F009 | Critical | High | Confirmed | Upload jobs cannot resolve object storage | T05 |
| TC-F010 | High | High | Confirmed | Worker persistence is neither tenant-bound nor atomic | T06 |
| TC-F011 | Critical | High | Confirmed | Package READY can be set without artifact | T09 |
| TC-F012 | High | High | Confirmed | Multipart protocol is synthetic | T04 |
| TC-F013 | High | High | Confirmed | Revision allocation races | T04 |
| TC-F014 | High | High | Confirmed | Satisfaction is document-wide, not version-and-obligation specific | T08 |
| TC-F015 | High | High | Confirmed | Readiness trusts revision text and unstable deduplication | T08 |
| TC-F016 | High | High | Confirmed | Signature verification overclaims trust | T10 |
| TC-F017 | High | High | Confirmed | Identity delivery adapters do not send | T11 |
| TC-F018 | High | High | Confirmed | Idempotency fails open and completion is detached | T06 |
| TC-F019 | High | High | Confirmed | Polling timeout discards upload queue entry | T12 |
| TC-F020 | High | High | Confirmed | Offline records omit actor and tenant partition | T12 |
| TC-F021 | High | High | Confirmed | Legacy upload component reports fabricated success | T12 |
| TC-F022 | High | High | Confirmed | Migration ledger does not validate checksums or serialize runners | T01 |
| TC-F023 | High | High | Confirmed | New domain relationships lack composite tenant/project constraints | T01 |
| TC-F024 | Medium | High | Confirmed | Archive completion describes a manifest, not a portable archive | T09 |
| TC-F025 | High | High | Confirmed | RA evidence package is marked READY without package items | T09 |
| TC-F026 | High | High | Confirmed | CI is narrower than claimed production gates | T13 |
| TC-F027 | High | High | Confirmed | Restore drill claims checks it does not perform | T14 |
| TC-F028 | Medium | Medium | Risk | Production scanner bypass and resource bounds need hardening | T05 |
| TC-F029 | Medium | High | Confirmed | Schedules run far more often than names imply | T06 |
| TC-F030 | Medium | Medium | Risk | Deployment and dependency security remain unverified | T14 |

| TC-F031 | High | High | Confirmed | Failed guest OTP attempts are rolled back | T02 |
| TC-F032 | High | High | Confirmed | Member OTP success is not consumed atomically | T02 |

## TC-F001 — OTP-required guest session bypass

- Severity / confidence / class: Critical / High / Confirmed.
- Source: [apps/api/src/modules/parties/parties.service.ts:467](../apps/api/src/modules/parties/parties.service.ts#L467).
- Actual behaviour: Session exchange checks presence of a PIN and only compares it if scope contains projectPin; it does not prove an OTP challenge was consumed.
- Failure scenario and impact: For an OTP-required grant without projectPin, any nonempty PIN satisfies this branch. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Remove PIN-as-OTP exchange; require an atomic, grant-bound, consumed challenge proof before session issuance.
- Tests and acceptance: Direct session exchange with arbitrary PIN must fail; valid consumed challenge succeeds exactly once.
- Implementation: T02 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F002 — Guest grant context is dropped

- Severity / confidence / class: Critical / High / Confirmed.
- Source: [apps/api/src/common/guards/session-csrf.guard.ts:241](../apps/api/src/common/guards/session-csrf.guard.ts#L241).
- Actual behaviour: userContext contains orgId, userId, actorType and requestId, but no grant ID or scope. DocumentsController passes that context to a service whose scope checks depend on grantId.
- Failure scenario and impact: Supplier uploads another requirement in the same tenant; resource IDs also bypass project-path checks. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Carry immutable actor/grant context; re-read active grant and authorize every target at the resource boundary.
- Tests and acceptance: Same-tenant other-project and other-supplier IDs return 404 across every route alias, including multi-target arrays.
- Implementation: T03 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F003 — Resource-ID routes lack project membership enforcement

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/common/guards/permission.guard.ts:53](../apps/api/src/common/guards/permission.guard.ts#L53).
- Actual behaviour: Membership narrowing runs only when a project ID is found in route parameters; document and version services generally filter tenant only.
- Failure scenario and impact: Site member knows a document ID from an unassigned project in their own organisation. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Resolve project from resource before permission evaluation and require active assignment for scoped roles.
- Tests and acceptance: Table-driven matrix across ID routes, lists, downloads, exports, review and guest access.
- Implementation: T03 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F004 — Server logout does not revoke sessions

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/identity/identity.controller.ts:437](../apps/api/src/modules/identity/identity.controller.ts#L437).
- Actual behaviour: Logout updates session_token_hash; session creation and lookup use token_hash. The query error is swallowed.
- Failure scenario and impact: A copied bearer token remains usable after logout. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Revoke by authoritative session ID/token_hash; require CSRF for cookie POST; remove mutating GET logout.
- Tests and acceptance: Previously valid cookie and bearer fail immediately after logout; DB errors never report success.
- Implementation: T02 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F005 — Browser logout never reaches server

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/web/src/lib/api-client.ts:145](../apps/web/src/lib/api-client.ts#L145).
- Actual behaviour: Client clears browser storage and attempts to clear HttpOnly cookie using JavaScript without calling the API.
- Failure scenario and impact: User logs out on shared computer; server session and cookie remain active. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Await server revocation, clear UI actor caches, and show failure if revocation cannot be confirmed.
- Tests and acceptance: Reload after logout requires login; server failure is visible and pending work is handled explicitly.
- Implementation: T02 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F006 — Stamp-back bypasses review invariants

- Severity / confidence / class: Critical / High / Confirmed.
- Source: [apps/api/src/modules/documents/documents.service.ts:1119](../apps/api/src/modules/documents/documents.service.ts#L1119).
- Actual behaviour: Batch path sets versions, document pointers and every document-linked requirement approved without READY, reviewer, evidence-proof or submission membership checks.
- Failure scenario and impact: A known processing version is included in stamp-back versionIds. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Persist transmittal items and execute the canonical review command for each frozen submission item.
- Tests and acceptance: Non-ready, unrelated, stale, revoked-authority and missing-proof decisions all fail without partial approval.
- Implementation: T07 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F007 — Canonical route omits required reviewer-role validation

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/reviews/reviews.service.ts:528](../apps/api/src/modules/reviews/reviews.service.ts#L528).
- Actual behaviour: The active service decision path checks self-approval and latest pointer but does not evaluate linked requirement reviewer_role. A separate helper has stronger checks.
- Failure scenario and impact: QC role decides a requirement reserved for another authority. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: One review application service must validate explicit review assignment, stage and authority on every route.
- Tests and acceptance: Wrong reviewer role, wrong stage and unassigned reviewer fail; authorised delegated reviewer succeeds with provenance.
- Implementation: T07 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F008 — Client override bypasses separation of duties

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/reviews/reviews.service.ts:581](../apps/api/src/modules/reviews/reviews.service.ts#L581).
- Actual behaviour: Self-approval and companion gates use caller-supplied isOverride; DecisionDto is an interface on several endpoints.
- Failure scenario and impact: Reviewer submits isOverride true through a legacy endpoint. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Remove general-purpose override booleans; require separately authorised, reasoned exception records with gate-specific scope.
- Tests and acceptance: Forged flags cannot change authorisation; exception never waives file integrity.
- Implementation: T07 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F009 — Upload jobs cannot resolve object storage

- Severity / confidence / class: Critical / High / Confirmed.
- Source: [apps/worker/src/main.ts:89](../apps/worker/src/main.ts#L89).
- Actual behaviour: Outbox completion emits objectKey; file worker destructures localFilePath and originalFilename and directly invokes local-file verification. No retrieval bridge is present in the active path.
- Failure scenario and impact: Real browser completes upload; dispatched job has no local file to read. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Resolve storage record by ID in tenant context, fetch immutable object version to bounded temporary workspace and verify bytes.
- Tests and acceptance: Browser-to-object-store-to-worker integration reaches READY only with real matching bytes.
- Implementation: T05 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F010 — Worker persistence is neither tenant-bound nor atomic

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/worker/src/main.ts:98](../apps/worker/src/main.ts#L98).
- Actual behaviour: File worker obtains a client and issues updates without BEGIN or tenant settings; outbox poller similarly queries forced-RLS tenant table without tenant context.
- Failure scenario and impact: Least-privilege role sees no outbox work or cannot update file state; elevated role hides the defect and partial writes remain possible. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Introduce per-tenant worker transactions and a restricted dispatch discovery mechanism; atomically persist result, quota and audit.
- Tests and acceptance: Real tc_app processing succeeds under FORCE RLS and injected mid-write failure rolls everything back.
- Implementation: T06 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F011 — Package READY can be set without artifact

- Severity / confidence / class: Critical / High / Confirmed.
- Source: [apps/worker/src/main.ts:197](../apps/worker/src/main.ts#L197).
- Actual behaviour: When job has packageId/orgId but lacks explicit input/outputPath, worker sets READY without compilation, storage upload or checksum.
- Failure scenario and impact: Normal queued handover event follows fallback and yields a ready package without dossier. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Compile from stored manifest, publish verified output and only then compare-and-set BUILDING to READY.
- Tests and acceptance: No artifact, failed member fetch or missing checksum means FAILED; READY always downloads verified bytes.
- Implementation: T09 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F012 — Multipart protocol is synthetic

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/documents/s3-storage.service.ts:106](../apps/api/src/modules/documents/s3-storage.service.ts#L106).
- Actual behaviour: Upload ID is locally generated in DocumentsService; signer adds partNumber without storage-provider uploadId; completion does not invoke provider CompleteMultipartUpload.
- Failure scenario and impact: File larger than 10 MiB uploads parts that cannot form a genuine multipart object. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Use maintained provider SDK, real create/list/complete/abort multipart operations and ordered ETags.
- Tests and acceptance: Real S3-compatible multipart upload, resume, expiry, abort and duplicate completion tests.
- Implementation: T04 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F013 — Revision allocation races

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/documents/documents.service.ts:309](../apps/api/src/modules/documents/documents.service.ts#L309).
- Actual behaviour: Upload version allocation reads MAX(version_no)+1 without locking parent document.
- Failure scenario and impact: Two distinct revision intents allocate same version number, failing or corrupting ordering depending on constraints. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Lock document before allocating monotonic version number; keep unique revision and version constraints.
- Tests and acceptance: Parallel intents return distinct numbers; duplicate business revision returns deterministic conflict.
- Implementation: T04 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F014 — Satisfaction is document-wide, not version-and-obligation specific

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/reviews/reviews.service.ts:658](../apps/api/src/modules/reviews/reviews.service.ts#L658).
- Actual behaviour: Approval updates all requirements linked to a document; handover follows current_approved_version_id rather than explicit satisfaction decisions.
- Failure scenario and impact: One generic manual linked to multiple obligations implicitly satisfies tests or asset-specific conditions. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Introduce version-pinned evidence links and requirement satisfaction assessments against revisioned evidence rules.
- Tests and acceptance: Approval alone cannot satisfy unrelated or incomplete obligations; manifest pins exact assessed versions.
- Implementation: T08 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F015 — Readiness trusts revision text and unstable deduplication

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/handover/handover.service.ts:53](../apps/api/src/modules/handover/handover.service.ts#L53).
- Actual behaviour: Readiness infers approved evidence from revision_code, does not select file/review status, and keeps expiry from the first joined row.
- Failure scenario and impact: Multiple linked documents have conflicting expiry; stale approved pointer references unavailable evidence. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Use deterministic rule evaluation per requirement and qualified satisfaction edges; evaluate inside package snapshot transaction.
- Tests and acceptance: Reordered query rows give identical result; missing objects, expired required evidence and pending revalidation block.
- Implementation: T08 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F016 — Signature verification overclaims trust

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/signatures/digital-signature.service.ts:126](../apps/api/src/modules/signatures/digital-signature.service.ts#L126).
- Actual behaviour: Registration stores supplied signature metadata without validating certificate/signature; public lookup reports verified true when no candidate hash is supplied.
- Failure scenario and impact: Arbitrary signature hex and claimed certificate are presented as verified. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Disable certification claims for MVP; separate recorded, digest-matched, cryptographically-valid and trust-valid states.
- Tests and acceptance: Missing hash returns NOT_CHECKED; fabricated signature never cryptographically valid.
- Implementation: T10 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F017 — Identity delivery adapters do not send

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/identity/identity.module.ts:56](../apps/api/src/modules/identity/identity.module.ts#L56).
- Actual behaviour: SMS reports delivered true when configuration exists; mail method returns without contacting a provider. Guest OTP creation also has no delivery call.
- Failure scenario and impact: Production environment has credentials, user is told OTP sent, no message arrives. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Implement one delivery abstraction with sandbox/live separation, provider receipts and retry states.
- Tests and acceptance: Provider sandbox delivers real challenge; simulated provider cannot start production.
- Implementation: T11 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F018 — Idempotency fails open and completion is detached

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/common/interceptors/idempotency.interceptor.ts:86](../apps/api/src/common/interceptors/idempotency.interceptor.ts#L86).
- Actual behaviour: Non-unique insert errors fall through to mutation; expired unique rows can also fall through; async tap callbacks are not awaited with business commit.
- Failure scenario and impact: Database claim failure still performs operation, or crash after business commit leaves request in progress indefinitely. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Store command receipt in same tenant transaction as mutation; define replay, lease recovery and expiry semantics.
- Tests and acceptance: Crash after commit replays same response; claim storage failure prevents mutation; concurrent duplicates execute once.
- Implementation: T06 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F019 — Polling timeout discards upload queue entry

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/web/src/lib/offline-upload-queue.ts:297](../apps/web/src/lib/offline-upload-queue.ts#L297).
- Actual behaviour: After a ten-second polling loop, item is marked completed and deleted even if READY was never observed.
- Failure scenario and impact: Slow scanner or repeated poll errors causes false completion and removes local recovery context. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Distinguish upload transmitted from server verified; persist PROCESSING and reconcile after reload.
- Tests and acceptance: Scan taking one minute remains processing; failed/quarantined files remain actionable.
- Implementation: T12 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F020 — Offline records omit actor and tenant partition

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/web/src/lib/offline-upload-queue.ts:3](../apps/web/src/lib/offline-upload-queue.ts#L3).
- Actual behaviour: Persisted queue items have project/requirement but no orgId, userId or grant identity and drain under current session.
- Failure scenario and impact: User switches organisation/account on shared device; previous actor files are retried in new context. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Partition queues by tenant and actor; block drain on mismatch and require explicit draft disposition on logout.
- Tests and acceptance: Account switching cannot enumerate or submit previous actor draft; quota failure preserves data visibly.
- Implementation: T12 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F021 — Legacy upload component reports fabricated success

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/web/src/components/upload-sheet.tsx:168](../apps/web/src/components/upload-sheet.tsx#L168).
- Actual behaviour: On failed upload-intent response, component shows success, deletes draft and returns demo_ver_123. Repository import search found the component definition but no active caller; this is confirmed legacy/demo code, not a proven reachable production upload route.
- Failure scenario and impact: If component is rendered, a server rejection is shown as uploaded evidence. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Remove fabricated success everywhere; consolidate upload UI after checking imports.
- Tests and acceptance: Any non-2xx leaves a recoverable draft and shows actual error; no synthetic version ID.
- Implementation: T12 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F022 — Migration ledger does not validate checksums or serialize runners

- Severity / confidence / class: High / High / Confirmed.
- Source: [packages/db/src/run-migrations.ts:35](../packages/db/src/run-migrations.ts#L35).
- Actual behaviour: Ledger records checksum but skips existing filenames without comparing contents; no global migration lock. Working tree also renames previously numbered migrations.
- Failure scenario and impact: Existing database and clean install diverge; two runners race. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Immutable migration ledger, advisory lock, checksum validation and explicit legacy name mapping after environment inventory.
- Tests and acceptance: Fresh install, prior-baseline upgrade, rerun, modified checksum and concurrent runner scenarios.
- Implementation: T01 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F023 — New domain relationships lack composite tenant/project constraints

- Severity / confidence / class: High / High / Confirmed.
- Source: [packages/db/migrations/0007_procurement_and_vendor_obligations.sql:15](../packages/db/migrations/0007_procurement_and_vendor_obligations.sql#L15).
- Actual behaviour: Procurement and identity revision tables have tenant RLS but several foreign keys reference global entity ID alone.
- Failure scenario and impact: Tenant-owned row can reference another tenant/project ID when FK existence is checked, compromising relationship integrity. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Use composite org/project keys, backfill consistency report and reject inconsistent rows rather than guessing ownership.
- Tests and acceptance: Direct SQL cross-tenant and same-tenant cross-project reference inserts fail under both privileged validation and runtime role.
- Implementation: T01 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F024 — Archive completion describes a manifest, not a portable archive

- Severity / confidence / class: Medium / High / Confirmed.
- Source: [apps/api/src/modules/handover/handover.service.ts:642](../apps/api/src/modules/handover/handover.service.ts#L642).
- Actual behaviour: Export records COMPLETED with metadata and receipt; does not fetch, verify or bundle original files.
- Failure scenario and impact: Customer expects downloadable offline evidence but receives metadata only. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Rename current action manifest export until durable archive builder exists; bundle originals and verification specification.
- Tests and acceptance: Archive reconstructs offline and every listed object digest verifies; missing file fails build.
- Implementation: T09 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F025 — RA evidence package is marked READY without package items

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/handover/handover.service.ts:378](../apps/api/src/modules/handover/handover.service.ts#L378).
- Actual behaviour: RA helper inserts READY package and returns selected rows but does not persist frozen items or enqueue compilation.
- Failure scenario and impact: Bill annexure appears ready but has no reliable dossier or contents. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Route RA annexures through canonical package builder with purpose and milestone scope.
- Tests and acceptance: Annexure has nonempty immutable manifest, artifact and digest before ready.
- Implementation: T09 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F026 — CI is narrower than claimed production gates

- Severity / confidence / class: High / High / Confirmed.
- Source: [.github/workflows/deploy.yml:48](../.github/workflows/deploy.yml#L48).
- Actual behaviour: Workflow uses pnpm 9 versus root 12, allows lock updates and runs one security script; no frontend, worker, Jest, browser or storage/scanner suite gate.
- Failure scenario and impact: A mocked remediation suite passes while cross-process upload is broken. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Pin supported toolchain/lockfile; separate deterministic checks and disposable integration environments.
- Tests and acceptance: Release blocked on all mandatory gates and artifacts record exact commit and toolchain.
- Implementation: T13 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F027 — Restore drill claims checks it does not perform

- Severity / confidence / class: High / High / Confirmed.
- Source: [scripts/run-restore-drill.sh:22](../scripts/run-restore-drill.sh#L22).
- Actual behaviour: Verification step selects row counts only, despite announcing audit-chain and storage checks; no object restore.
- Failure scenario and impact: Database restore succeeds while contractual originals are absent. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Restore isolated DB plus versioned objects, recompute chain/digests, exercise permissions and record RPO/RTO.
- Tests and acceptance: Restore randomly selected approved evidence and a full dossier independently; verify bytes and access policy.
- Implementation: T14 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F028 — Production scanner bypass and resource bounds need hardening

- Severity / confidence / class: Medium / Medium / Risk.
- Source: [apps/worker/src/queues/file.processor.ts:119](../apps/worker/src/queues/file.processor.ts#L119).
- Actual behaviour: Scanner bypass is governed by an environment flag without environment restriction; parser fallback loads whole PDF and ClamAV stream ignores backpressure.
- Failure scenario and impact: Misconfigured deployment bypasses scanning or concurrent large files exhaust memory. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Reject bypass in production/staging; enforce process memory, CPU, input/archive limits and bounded streaming.
- Tests and acceptance: Production refuses unsafe flag; adversarial corpus stays within resource budget.
- Implementation: T05 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F029 — Schedules run far more often than names imply

- Severity / confidence / class: Medium / High / Confirmed.
- Source: [apps/worker/src/scheduler.ts:16](../apps/worker/src/scheduler.ts#L16).
- Actual behaviour: Worker invokes daily-expiry and weekly-owner-digest every minute; leader lock is released on completion and does not record schedule bucket.
- Failure scenario and impact: Repeated reminders and expensive daily/weekly work run each minute. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Persist due-time buckets and unique job execution keys; renew leases and fence completion.
- Tests and acceptance: Two workers across restarts create at most one logical weekly digest per organisation and interval.
- Implementation: T06 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F030 — Deployment and dependency security remain unverified

- Severity / confidence / class: Medium / Medium / Risk.
- Source: [infra/terraform/main.tf:97](../infra/terraform/main.tf#L97).
- Actual behaviour: Terraform contains partial infrastructure; no deployed topology, live IAM/TLS, complete recovery evidence or current advisory scan was examined.
- Failure scenario and impact: Real environment may differ from repository descriptions; stale dependencies may contain vulnerabilities. This undermines isolation, evidence trust, recovery or operational correctness as applicable; block affected production capability until resolved.
- Required solution: Inventory deployed resources and lockfile advisories, validate topology and operations before production claims.
- Tests and acceptance: Evidence pack includes actual IAM policies, dependency review, TLS and backup/restore results.
- Implementation: T14 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F031 — Failed guest OTP attempts are rolled back

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/parties/parties.service.ts:395](../apps/api/src/modules/parties/parties.service.ts#L395).
- Actual behaviour: Invalid-code branch updates failed_otp_count/cooldown_until and then throws inside withTokenContext. That wrapper rolls back on exceptions.
- Failure scenario and impact: Repeated invalid guest codes need not retain the failure count or cooldown; source establishes rollback semantics without attempting a live brute-force attack.
- Required solution: Persist failed-attempt outcome before returning the HTTP authentication error, with row lock/atomic attempt accounting.
- Tests and acceptance: Real DB tests submit five invalid codes in separate requests, inspect persisted attempts and cooldown, then assert denial until cooldown elapses.
- Implementation: T02 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).

## TC-F032 — Member OTP success is not consumed atomically

- Severity / confidence / class: High / High / Confirmed.
- Source: [apps/api/src/modules/identity/identity.controller.ts:161](../apps/api/src/modules/identity/identity.controller.ts#L161).
- Actual behaviour: Member verification reads challenge, compares hash and later deletes challenge/attempt keys as separate Redis operations.
- Failure scenario and impact: Two concurrent requests can read and match the same valid challenge before deletion and both attempt session creation; INCR attempt limit does not serialize success consumption.
- Required solution: Perform verify/attempt/consume atomically against challenge identity and expiry; never use read-then-delete for a single-use challenge.
- Tests and acceptance: Concurrent valid-code verification produces exactly one successful consume/session; replay and replaced challenge fail, and failure attempts persist.
- Implementation: T02 in [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md).
