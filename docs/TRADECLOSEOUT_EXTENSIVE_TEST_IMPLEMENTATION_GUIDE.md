# TradeCloseout — extensive test implementation guide

Date: 2026-11-06. Audience: the engineer or coding agent implementing automated tests and the reviewer accepting them.

## 1. Purpose and current baseline

Implement this guide as a testing programme for the current repository. It specifies observable outcomes, not tests that merely repeat SQL or implementation details. Read the [implementation status review](TRADECLOSEOUT_IMPLEMENTATION_STATUS_REVIEW_2026-11-06.md), [task specifications](TRADECLOSEOUT_TASK_IMPLEMENTATION_SPECS.md), [target architecture](TRADECLOSEOUT_TARGET_ARCHITECTURE.md) and [master blueprint](TRADECLOSEOUT_IMPLEMENTATION_MASTER_BLUEPRINT.md) for business contracts.

At the reviewed working tree, `pnpm typecheck` and 20 API suites containing 149 tests passed with local PostgreSQL access. This is a baseline, not a coverage or release-readiness claim. Many tests mock database responses. A filename containing `e2e` does not establish a real end-to-end test: inspect whether it actually boots HTTP, traverses guards/interceptors, commits through runtime database roles and checks persisted outcomes.

The small current suite has concrete structural limitations:

- Only `apps/api` defines a package `test` command; worker, shared, database, PDF engine and web do not. Root Turbo tests therefore do not discover a comprehensive suite in every package.
- `apps/web/e2e/critical-flows.spec.ts` contains two browser scenarios: redirect and development OTP login. No Playwright configuration or direct Playwright dependency was found in the inspected web package.
- CI provisions PostgreSQL and Redis, but does not run browser, S3/ClamAV workflow or storage recovery tests.
- Numerous API tests assert query text or supply database rows that would never be accepted by a real schema. Such tests cannot prove foreign keys, RLS, rollback, row locking, migrations or crash recovery.
- No measured coverage report or complete route-to-test inventory was supplied. Do not infer coverage percentages from the number 149.

Preserve useful existing tests. Add missing boundaries and replace implementation-shaped assertions when a real behavioral assertion can cover the same risk. Do not inflate test counts with trivial variations or snapshots of entire payloads.

## 2. Instructions for the implementing engineer

1. Inventory the current tree and local instructions first; preserve other uncommitted work. Recheck files because this guide is based on a changing working tree.
2. Create the harness and shared fixtures below before duplicating setup in many files. Each proposed test path is a destination to create, not a claim that it already exists.
3. Every test title must include its stable case ID from this guide. Parameterized rows append a meaningful suffix, for example `AUTHZ-01/R-SITE/A2/document.download`.
4. Current-feature cases are executable regressions and must pass. If a case reveals a defect, record the failing reproduction and owning roadmap task; do not weaken the assertion to preserve a green build.
5. Future-feature cases are acceptance specifications. Track them as **blocked: feature absent**, with issue/task and activation gate. They must not be presented as passing implemented tests. Put them in an explicit future manifest until the feature is introduced. At feature enablement, these become required tests.
6. A disabled/retired operation has a containment test now: defined 410/503 response, no data mutation, no provider call and a truthful UI. Its replacement workflow is a separate acceptance case.
7. Reuse helpers for setup and authenticated requests; keep expected results independent of production algorithms. Never import production permission maps to compute all expected permissions, or use the production checksum function as the only oracle for itself.
8. For each negative test, verify both the response and absence of unauthorized state, audit/outbox business events, quota changes and provider effects. A security-event record may be expected and should be distinguished from a business event.
9. For each accepted command, verify durable state, row version, audit, relevant outbox/receipt and externally visible result from a fresh connection or request. Verify isolation using another principal.
10. Finish each slice with commands run, counts by test layer, covered IDs, failures/blockers, artifact locations and the exact commit or dirty-tree manifest tested. Never label the whole project tested because one slice passed.

## 3. Test layers and proposed locations

| Layer | Purpose and permitted doubles | Proposed location |
|---|---|---|
| Unit | Pure date, validator, configuration, permission and state functions; deterministic clocks/randomness as needed | `packages/shared/test/`, `apps/api/test/unit/`, `packages/pdf-engine/test/` |
| Service integration | Real PostgreSQL/Redis/object store for persistence/locking; explicit provider boundary doubles only | `apps/api/test/integration/`, `packages/db/test/` |
| HTTP contract | Boot real Nest application with its validation, cookies, guards, filters/interceptors; real DB and session state | `apps/api/test/http/` |
| Worker integration | Actual BullMQ/Redis, tenant runtime DB role, real object storage and fixture scanner; start/kill child workers | `apps/worker/test/integration/` |
| Browser | Running built Next/API/worker, actual browser cookies/IndexedDB/service worker and downloads | `apps/web/e2e/` |
| Provider contract | Real adapter request/signature parsing against local programmable HTTP server; limited real sandbox-provider smoke | `apps/api/test/providers/` |
| Artifact | Independently parse/open PDFs/archives and recompute bytes/digests | `packages/pdf-engine/test/`, `apps/worker/test/artifacts/` |
| Operations/security/load | Disposable deployments, recovery, resource and abuse checks | `tests/operations/`, `tests/security/`, `tests/load/` |

Configure explicit Jest projects or equivalent discovery so package roots collect their own tests. Do not accidentally treat generated `dist` files as tests. Keep the established Jest/TypeScript approach unless a documented need requires a second runner. Browser tests require adding and configuring Playwright; list any component-testing dependencies explicitly before introducing them. Tests must run headlessly in CI.

## 4. Harness, fixtures and isolation

### 4.1 Disposable services

- PostgreSQL 16 with migrations applied by a migrator role. HTTP and workers use production-like NOBYPASSRLS, non-owner, non-superuser roles. Assert `rolsuper`, `rolbypassrls`, table ownership and grants at setup; fail if the integration suite is unknowingly privileged.
- Real Redis for Lua, TTL, rate limits, BullMQ and scheduler locks. An in-memory substitute cannot establish atomicity or Redis failure behavior.
- Versioned S3-compatible bucket for local integration; separate AWS sandbox contract checks for provider-specific behavior the emulator cannot prove. Set short-lived signed URLs, CORS and multipart behavior explicitly.
- ClamAV for clean/EICAR integration and qpdf for PDF verification/compilation. Add bounded small fixtures that exercise parser limits. An unavailable dependency is a failed required gate, not a silent skip.
- Local delivery capture server with programmable success, timeout, 429, malformed and duplicated callback responses. Never send tests to real customer addresses or numbers. A provider stub proves adapter contracts only; real provider sandbox delivery is a distinct check.
- API and worker must be separately startable/stoppable, so tests can crash one process while keeping database/Redis alive. Capture structured logs without secrets.

### 4.2 Mandatory fixture set

| Fixture group | Required data |
|---|---|
| Tenants/projects | Tenant A with projects A1/A2; tenant B with B1/B2. A1/B1 deliberately share human-readable tags/codes. A2 contains data the A1-only user must not discover. |
| Members | Owner/admin; each current org/project role; user assigned only A1; user assigned only A2; unassigned member; revoked member; suspended user; multi-org user. Separate uploader/reviewer/countersigner/recipient identities. |
| Guests | OTP-required supplier scoped to two requirements of A1; different supplier in A1; client recipient scoped to a frozen submission; expired/revoked grants; empty scope; view-without-download capability. |
| Requirements | Mandatory/optional; no due date; overdue; expired/expiring; waived/pending second waiver; superseded revision; multiple evidence slots/stages when implemented. |
| Equipment | Two assets sharing model but distinct serials; duplicate candidate serial; reused tag after replacement; asset with pending revalidation and an older approved document. |
| Documents | Multiple versions, newer draft, approved old version, processing/quarantined/failed version, tombstoned document, unrelated proof, shared generic manual, serial-specific report. |
| Storage | Versioned objects, changed latest object under same key, wrong stored size/digest, missing object, multipart partial upload; actual known fixture bytes. |
| Artifacts | One/two-page PDFs with unique visible markers, rotated pages, image, unicode filename, encrypted/malformed PDF, bounded compressed fixture, macro/active content fixtures. Maintain SHA-256 and provenance in a fixture manifest. |
| Commercial | Zero/missing/large integer paise; multiple contracts and many requirements; partial retention receipts and disputed acceptance when those features exist. |
| Time | UTC instants straddling India midnight, leap day/month/year, ISO-week year boundary, exact expiry/TTL boundaries, warranty/DLP anchor pending. |

Use unique run namespaces and fresh database/bucket prefixes. A migrator may seed fixtures, but all behavioral operations run as the applicable member/guest/runtime role. Do not use production seed scripts as a substitute for an isolated test fixture. Tests with background workers cannot rely on an outer transaction rollback for cleanup: workers use separate connections. Never clear shared Redis or a shared bucket globally.

### 4.3 Deterministic assertions

Use barriers/latches to make concurrent requests overlap at the boundary being tested; launch from independent connections/processes. `Promise.all` alone does not prove contention. Avoid arbitrary sleeps: poll a durable condition with a deadline and print the final observed state on timeout. Fake time for pure rules; use controlled timestamps/short configured TTLs for live dependencies. Do not change the host clock. Record random seeds for property tests.

## 5. Universal HTTP, authorization and mutation matrix

For **every controller action and route alias** create an inventory row: method/path, permission, owning resource, body/query DTO, guest support, preconditions, idempotency, success/error statuses, response projection and case IDs. Expand decorator arrays and relative controller prefixes. Route inventory must include all modules and be checked for newly added uncovered routes in CI.

For every resource route exercise: same project; same tenant other project; other tenant; nonexistent ID; malformed ID; indirect child ID with contradictory parent; deleted resource; revoked principal. Repeat for collections, totals, exports, streams, signed URLs, nested resources and all array elements. An authorized empty collection is different from a forbidden foreign project.

| ID | Exact test and expected outcome |
|---|---|
| HTTP-01 | No session, expired/revoked session and malformed bearer/cookie → 401; no resource or commercial detail disclosed. |
| HTTP-02 | Cookie mutation without/wrong/cross-session CSRF → denied; correct CSRF succeeds. Document bearer behavior and verify it cannot silently bypass cookie CSRF. |
| HTTP-03 | Malformed JSON, invalid UUID/enum/date, wrong scalar type, unknown DTO field → contract validation error and zero business effects. Exercise endpoints still using inline body types. |
| HTTP-04 | Missing If-Match → 428, stale version → 412 under blueprint contract; valid expected version commits once. Record current deviations, including legacy 409 behavior. |
| HTTP-05 | Missing required Idempotency-Key → documented failure; malformed/reused key and oversized headers fail safely. |
| HTTP-06 | Inject orgId, actorId, role, rowVersion, fileStatus, approval or monetary computed fields → reject/ignore only as explicitly contracted; authoritative actor/tenant cannot change. |
| HTTP-07 | DB/provider/internal error → stable problem response with requestId; no SQL, credential, stack, bucket secret or token in body/log. |
| HTTP-08 | Cursor pagination with tied sort values and concurrent insertion → no duplicate/omitted stable items within defined snapshot semantics; max page size enforced; cursor scope binding. |
| HTTP-09 | Oversized body/file/list/pageSize and deep JSON → bounded 400/413 response, no process crash; limits enforced before expensive work. |
| HTTP-10 | Every alias → same authority, state, audit, receipt and error behavior as canonical route; retired alias → 410 without mutation. |
| AUTHZ-01 | Hand-authored expected role/action/scope matrix for all roles in shared permissions → evaluate both permission helper and actual HTTP operation. No permission expectation calculated by calling that same helper. |
| AUTHZ-02 | A1-only user supplies A2/B1 IDs through path/body/query/indirect version → deny without state or identifier/count leakage; owner access remains tenant-bound. |
| AUTHZ-03 | Mixed-target batch with forbidden first/middle/last item, duplicates and empty list → deny entire atomic command or return documented per-item outcome; never apply a silent authorized subset. |
| AUTHZ-04 | Guest empty/missing scope or omitted capability → deny; grant creator privileges never become guest privileges; view does not imply download. |
| AUTHZ-05 | Nested response contains financial fields in camelCase/snake_case, internal comments, audit payloads and unknown secret canaries → guest DTO excludes them by allowlist. |
| AUTHZ-06 | Counts/dashboard/search/export under A1-only scope → same authorized set as list, with no A2 totals or titles. |
| AUTHZ-07 | Revoke membership/grant between scope check and mutation → serializable documented result, no unauthorized post-revocation commit. Test direct application-service invocation as well. |
| AUTHZ-08 | Resource lookup throws DB error → fail closed; never continue because membership lookup was unavailable. |

Expected foreign-resource behavior is 404 where the blueprint requires hiding existence; visible forbidden actions use 403. Verify these explicitly rather than accepting any non-200 status. Centralize deliberate legacy deviations in a tracked contract file until fixed.

## 6. Database, migrations and tenant transactions

Owner: DB package. Proposed files: `packages/db/test/migrations.integration.spec.ts`, `rls.integration.spec.ts`, `relationships.integration.spec.ts`, `tenant-tx.integration.spec.ts`. Maps to T01/T06 and TC-F010/F022/F023.

| ID | Exact scenario and oracle |
|---|---|
| DB-01 | Apply all migrations to empty DB → expected tables/enums/indexes/policies/triggers; rerun → no extra rows/DDL or checksum changes. |
| DB-02 | Upgrade from each actually supported ledger baseline, including reviewed legacy names → schema equivalent to clean install after normalization; retain data and ledger provenance. |
| DB-03 | Change applied SQL checksum, add unknown ledger name, conflict old/new aliases or omit ledger on populated schema → abort with defined error, unchanged schema/data. |
| DB-04 | Two migrator processes start together → one holds advisory lock; migrations applied exactly once; crash lock holder → lock released and safe atomic rerun. |
| DB-05 | Migration fails midway → rollback its DDL/data/ledger entry; prior committed migrations remain. Test actual SQL error, not mocked query rejection. |
| DB-06 | Runtime role without tenant settings → zero tenant rows and rejected writes; unset/empty/invalid setting values fail closed per defined contract. |
| DB-07 | Runtime role under A → cannot SELECT/INSERT/UPDATE/DELETE B for every tenant table. Test WITH CHECK via updating org_id and inserting a foreign-tenant child. |
| DB-08 | Correct org but wrong project/parent ID → composite FK rejects; cover identity revisions, revalidation, procurement lines/obligations, document links, packages and transmittals. |
| DB-09 | Pool connection reused after success, exception, timeout or rollback → no prior tenant/user context survives. Verify on actual same pooled connection. |
| DB-10 | Inventory tenant tables in pg_catalog → RLS enabled/forced and scoped policies; explicit allowlist for global tables; roles cannot bypass by ownership. |
| DB-11 | Both tenant-setting aliases agree, disagree or one is unset → apply approved policy contract; mismatched aliases must not reveal two tenants. Flag permissive OR policies as a defect if they allow this. |
| DB-12 | Business mutation and audit/outbox flush fail at each boundary → all rollback; success visible with matching org/project/entity/actor/request IDs. |
| DB-13 | Drizzle declarations and effective migrated schema compared for types, nullability, defaults, FK targets, unique keys and indexes → no unexplained divergence. |
| DB-14 | Invalid state enums, negative quota/currency values, duplicate active identities and dangling required references → database constraints reject even without DTO validation. |

## 7. Identity, sessions and OTP

Owner: identity module and session guard. Proposed files: `apps/api/test/http/identity.http.spec.ts`, `apps/api/test/integration/otp-redis.integration.spec.ts`. Maps to T02/T11 and TC-F001/F004/F005/F031/F032.

| ID | Exact scenario and oracle |
|---|---|
| IAM-01 | Valid new/existing member OTP delivery+verify → one session, correct identity/org, hashed tokens at rest; no raw OTP/session in DB logs. |
| IAM-02 | Two overlapping verifications of same correct OTP → exactly one consumes challenge and creates session; other rejected. Use real Lua/Redis. |
| IAM-03 | Wrong code repeated to configured limit → attempts/cooldown persist across requests and process restart; correct code during lockout rejected. Check exact boundary. |
| IAM-04 | Expired/reused/replaced challenge and wrong identifier/challenge binding → uniform failure; no session. New challenge cannot reset attack budget without policy permission. |
| IAM-05 | Request flood for identifier/IP/grant → configured limits including concurrent first increment; rate key always has TTL; Retry-After and actual HTTP 429 agree. |
| IAM-06 | Redis unavailable/timeout/malformed stored challenge → fail closed; no fallback production session. |
| IAM-07 | Delivery rejected/times out → challenge unusable according to delivery state; no fabricated sent response or production OTP preview. |
| IAM-08 | Production and staging cookie issuance → Secure/HttpOnly/SameSite/path/max-age correct; debug OTP flag cannot expose code there. |
| IAM-09 | POST logout then replay same cookie/bearer → 401; server revocation durable; browser clears local state only with truthful failure handling. Mutating GET logout absent. |
| IAM-10 | Switch to active membership → session org and CSRF rotate; previous CSRF fails; denied switch leaves both unchanged; guest switching denied. |
| IAM-11 | Membership/user/org suspended after login → subsequent protected request denied, including persistent tabs and worker commands initiated by stale session. |
| IAM-12 | Simultaneous signup same identity → one identity/consistent membership; no duplicate org creation from race, or explicit documented reconciliation. |

## 8. Parties, guest grants, procurement and supplier intake

Owner: parties/supplier-guest modules. Proposed files: `apps/api/test/http/guest-grants.http.spec.ts`, `supplier-intake.http.spec.ts`, `apps/api/test/integration/procurement.integration.spec.ts`. Maps to T03/T16.

| ID | Exact scenario and oracle |
|---|---|
| GUEST-01 | OTP-required grant with arbitrary PIN or direct session exchange → no session; verified proof bound to grant permits intended exchange once. |
| GUEST-02 | Wrong OTP → persisted DB attempt increment even though HTTP responds error; threshold cooldown persists after rollback paths/process restart. |
| GUEST-03 | Proof from another grant/tenant/recipient or old grant version → rejected; forged client assurance/creator userId has no effect. |
| GUEST-04 | Expired/revoked/replaced grant → metadata/context/upload/download/review denied; existing session invalid immediately for new actions. |
| GUEST-05 | Supplier upload to allowlisted A1 requirements succeeds; another supplier, A2, B1 and empty scope fail through intent/refresh/complete/stream aliases. |
| GUEST-06 | Public grant lookup reveals only minimum pre-verification metadata; token hashes stored; token not logged/reflected into analytics/referrer; invalid-token response does not expose recipient. |
| GUEST-07 | Grant scope altered/revoked while completing upload → no unauthorized link or evidence approval; immutable file may remain quarantined/orphan-managed according to policy. |
| GUEST-08 | Procurement line points to other tenant/project/order or supplier obligation points to foreign line → FK and service deny. |
| GUEST-09 | PO quantity >1 allocated to several units with partial delivery → correct outstanding quantities; duplicate allocations cannot exceed defined quantity. **Future acceptance if allocation workflow absent.** |
| GUEST-10 | Supplier received/verified/intake-accepted states → never imply technical review approval or requirement satisfaction; receipt lists exact uploaded versions. |
| GUEST-11 | Reminder retry and partial supplier response → only outstanding scoped items requested; no internal notes/prices in reminder. **Delivery acceptance.** |
| GUEST-12 | Returned comment response pins old/new file/page and required verifier closes it; uploading any unrelated file cannot close comment. **Future acceptance.** |

## 9. Organisations, members, projects and contracts

Proposed files: `apps/api/test/http/organisations.http.spec.ts`, `projects.http.spec.ts`, `apps/api/test/integration/project-lifecycle.integration.spec.ts`.

| ID | Exact scenario and oracle |
|---|---|
| ORG-01 | Invite active/new user, replay invitation, expired/cancelled invitation → one intended membership and no duplicate invitations or role escalation. |
| ORG-02 | Change member role/revoke membership → effect on next request; unauthorized user cannot promote self, add foreign principal or delete last owner. |
| ORG-03 | Ownership transfer between two active authorized members, stale version and concurrent transfers → exactly one owner per contract and complete audit. |
| ORG-04 | Offboarding with assigned reviews/requirements → gap report complete, reassignment scoped and auditable; no lost or silently completed work. |
| ORG-05 | Org settings update includes forbidden billing/security fields → DTO/authority deny; stale expected version leaves settings unchanged. |
| PROJ-01 | Create/read/update with duplicate project code across same/different tenants → declared uniqueness behavior, no foreign tenant lookup leakage. |
| PROJ-02 | Activate/suspend/handover/close/reopen → each legal transition once; illegal state and stale version denied, audit/outbox match transition. |
| PROJ-03 | Closed/suspended project mutation across upload/review/requirement/member endpoints → consistent allowed/denied policy; read access remains explicitly scoped. |
| PROJ-04 | Close with mandatory blockers, disputed acceptance or defects → documented blockers and no close unless explicit authority policy satisfied. |
| PROJ-05 | Contract/variation creation uses integer paise and project source references; negative/oversized/duplicate submissions → defined errors with no phantom variation. |
| PROJ-06 | Delete/revoke project member while action in flight → defined serialization, no lingering scoped access; cross-project role never grants tenant-wide member/billing rights. |

## 10. Configuration, catalogue, checklist and controlled import

Proposed files: `apps/api/test/unit/configuration.spec.ts`, `apps/api/test/integration/checklists.integration.spec.ts`, `apps/web/e2e/baseline-import.spec.ts`. Maps to T15.

| ID | Exact scenario and oracle |
|---|---|
| CFG-01 | Platform → trade → org → client/contract → project precedence with LOCKED/INHERIT_ONLY/REPLACE/APPEND/MERGE_MAP → independently specified final values and conflict list. |
| CFG-02 | Unknown config key/type, invalid layer, malicious object prototype keys and duplicate appended values → validation without prototype pollution or silent locked override. |
| CFG-03 | Two configuration evaluators given same supported inputs → parity or explicit retirement; pinned historical snapshot unchanged after source config edit. |
| CHK-01 | Instantiate checklist twice → no duplicate active requirement keys; correct scope/category/milestone/reviewer defaults from pinned catalogue. |
| CHK-02 | Requirement with no due_at → not derived overdue/MISSING; exact India due-date boundary uses documented semantics. |
| CHK-03 | Change request approved/rejected/stale/concurrent → new baseline revision/impact where required, no overwrite of historic approved scope. |
| CHK-04 | Mandatory waiver by first approver → pending only; same actor cannot countersign; distinct authorized second actor activates. Optional waiver follows its explicit policy. |
| CHK-05 | Expired/revoked/incomplete waiver → readiness not satisfied; nonapplicability cannot be forged by status string alone. |
| IMP-01 | Realistic Excel/CSV fixture with 200+ mapped rows, Unicode, blank cells and repeated headers → exact preview counts, row numbers and field-level errors; no DB write during preview. |
| IMP-02 | Duplicate tags/keys/serials inside upload and against current baseline → explicit conflict plan; no silent merge/skip. |
| IMP-03 | Invalid workbook, formula/external link, very large sheet/ZIP and CSV formula export payload → bounded safe parsing/export, no evaluation or network fetch. |
| IMP-04 | Two commits of same import receipt and concurrent baseline edit → one commit or explicit stale conflict, consistent row counts/audit; no partial silent success. |
| IMP-05 | Import includes foreign project/asset/owner IDs and mixed valid/invalid rows → scoped rejection with documented atomicity and accurate per-row outcome. |
| IMP-06 | Currently retired bulk import routes → 410 and zero changes; replacement import acceptance cases remain blocked until real implementation enabled. |

## 11. Assets, identity revisions and equipment passports

Proposed files: `apps/api/test/integration/asset-identity.integration.spec.ts`, `apps/api/test/http/passport.http.spec.ts`, `apps/web/e2e/equipment-passport.spec.ts`. Maps to T08/T16.

| ID | Exact scenario and oracle |
|---|---|
| ASSET-01 | Create asset → normalized identity/tag, baseline requirements and initial history as contracted; duplicate tag/serial collision gives explicit result. |
| ASSET-02 | Model/serial replacement → immutable old identity revision plus new revision and revalidation records for affected exact evidence versions only. |
| ASSET-03 | Concurrent identity edits with same If-Match → one wins, other stale; monotonically ordered revisions, no duplicate active identity. |
| ASSET-04 | Same tag reused for new physical unit → passport/history distinguish units; old serial-specific approval cannot satisfy new unit automatically. |
| ASSET-05 | Generic manual versus serial-specific test/certificate → correct requalification policy; model match alone does not transfer serial evidence. |
| ASSET-06 | Pending/rejected revalidation → readiness and package selection blocked where required; authorized revalidation pins decision/proof/version and restores only covered scope. |
| ASSET-07 | Revalidate foreign asset/version or wrong asset revalidation ID → 404/no change; unqualified role cannot verify own replacement evidence. |
| ASSET-08 | Retire/delete asset with historical approved evidence → preserve historical references; hard-delete policy enforced; package snapshots still readable. |
| ASSET-09 | Passport returns only scoped verified evidence and current identity; supplier/client projection excludes cost/internal records. |
| ASSET-10 | Candidate matching on ambiguous tag/make/model/serial → ranked candidates with uncertainty, no automatic identity merge or approval. |
| ASSET-11 | Asset import failure mid-list → explicit failed rows and accurate imported count; retry cannot duplicate earlier successes. |
| ASSET-12 | QR issue/revoke/replace → old link denied; client-FM projection scoped and no token-based escalation. **Future acceptance if QR absent.** |

## 12. Upload intents, multipart completion and downloads

Proposed files: `apps/api/test/integration/s3-upload.integration.spec.ts`, `apps/api/test/http/documents.http.spec.ts`. Real versioned storage is mandatory. Maps to T04/T05, TC-F009/F012/F013.

| ID | Exact scenario and oracle |
|---|---|
| DOC-01 | Small single-part and large multipart uploads → actual object bytes, expected part sizing/order, content metadata and immutable version receipt match declared intent. |
| DOC-02 | Missing/duplicate/out-of-range/unordered parts, wrong ETag and wrong uploadId → provider/service rejects; no PROCESSING job before verified completion. |
| DOC-03 | Declared size/digest differs from actual upload → fail processing or completion as contracted; never READY/approved; quota consistent. |
| DOC-04 | Two overlapping revision intents for same document → distinct monotonically allocated versions without unique violation or lost latest pointer. |
| DOC-05 | New document intent fails after provider session creation/DB failure → rollback or explicit recoverable orphan; retry reconciles instead of accumulating uploads. |
| DOC-06 | Complete same upload twice and concurrently → one state transition, one effective job/event/quota charge; equivalent receipt returned or explicit in-progress outcome. |
| DOC-07 | Completion provider succeeds then DB commit fails → durable/reconcilable provider receipt; retry does not corrupt object or invent missing parts. |
| DOC-08 | Refresh expired signed URLs → same authorized intent/parts; cannot change object key/version/size/tenant. Expired/aborted intent refuses refresh. |
| DOC-09 | Abort before completion, abort replay and abort versus complete race → one legal terminal result, no readable unverified object and no quota leak. |
| DOC-10 | Overwrite same S3 key with different latest bytes → processing and download use pinned provider version, not latest object. |
| DOC-11 | Signed download/preview for pending/processing/quarantined/failed/deleted/foreign version → deny; READY and capability check required separately from read. |
| DOC-12 | Download URL TTL expiry and grant revocation → new URLs denied immediately; existing URL lifetime bounded by documented TTL. |
| DOC-13 | Stream exact known bytes → correct digest/content type/disposition/length; Unicode and CRLF filenames cannot inject headers or path segments. |
| DOC-14 | Missing object/provider timeout/partial stream → truthful failure and no generated substitute evidence; client does not report successful download. |
| DOC-15 | Document delete/restore/new version and approved older version → pointers/history remain valid; no deleted version can newly satisfy requirement. |
| DOC-16 | Inject EICAR flag/samplePayload/client fileStatus into completion → cannot force quarantine or bypass verification; only actual stored bytes determine result. |

## 13. File scan, conversion and worker persistence

Proposed files: `apps/worker/test/integration/file-pipeline.spec.ts`, `format-conversion.spec.ts`, `file-recovery.spec.ts`.

| ID | Exact scenario and oracle |
|---|---|
| SCAN-01 | Each supported clean format fixture → expected detected MIME, digest/page count and legal final status; actual ClamAV verdict observed. |
| SCAN-02 | EICAR bytes from stored object → QUARANTINED; unrelated versions/tenants unchanged and download denied. Never use a malware flag instead. |
| SCAN-03 | Executable/macro/SVG/HTML disguised by extension or MIME → rejected from bytes, including uppercase/double-extension names. |
| SCAN-04 | Scanner timeout/disconnect/invalid response → fail closed and retry/terminal failure receipt; production env cannot enable test-only scanner bypass. |
| SCAN-05 | PDF invalid/encrypted/truncated/excessive pages/active content → defined failure or sanitization; original preserved and derivatives linked, never replaced as original. |
| SCAN-06 | Bounded compression-bomb fixture, huge dimensions and streamed body exceeding declared size → stop at configured byte/CPU/time/disk limits; worker remains healthy. |
| SCAN-07 | Job payload missing org/object/providerVersion or points across tenant → rejected before file/DB mutation; SYSTEM identity does not bypass scope. |
| SCAN-08 | Duplicate/stale job after new object receipt/status change → ignored safely; no second quota increment or rollback of newer state. |
| SCAN-09 | DB fails between version/object/quota updates → all rollback; subsequent retry produces one consistent result. |
| SCAN-10 | Kill worker after download, scan, DB commit and before job acknowledgment → safe retry, no lost processing status, temp cleanup/reconciliation. |
| SCAN-11 | Retry exhaustion → persisted FAILED code/attempts visible to UI; explicit authorized retry can recover without duplicate events. |
| SCAN-12 | Conversion fixture for image/DOCX/XLSX/DWG as supported → real readable PDF with source provenance; unavailable converter → explicit unsupported/unavailable, never fabricated content. |
| SCAN-13 | Temp path traversal/symlink/command metacharacter filenames → no arbitrary read/write/command execution; temp files private and cleaned on failure. |
| SCAN-14 | Four concurrent scans plus package work at configured max → resource envelope maintained, healthy job not starved; capture peak RSS/disk/latency. |

## 14. Reviews, external proof and transmittals

Proposed files: `apps/api/test/http/reviews.http.spec.ts`, `apps/api/test/integration/review-authority.integration.spec.ts`, `transmittals.integration.spec.ts`. Maps to T07 and TC-F006/F007/F008.

| ID | Exact scenario and oracle |
|---|---|
| REV-01 | Submit verified version with assigned reviewer → IN_REVIEW, exact reviewed version pinned; PROCESSING/FAILED version cannot be submitted/approved. |
| REV-02 | Uploader tries internal/external/override/bulk/alias approval → denied consistently; owner/admin cannot bypass separation unless explicit approved policy says so. |
| REV-03 | Actor lacks required reviewer role on one of multiple linked requirements → denied; authority is checked for every relevant link. |
| REV-04 | New revision uploaded between review creation and decision → stale-version decision rejected without moving approved pointer. |
| REV-05 | Approve versus reject concurrently using same version → one outcome, one coherent decision/audit; no contradictory approved/rejected row. |
| REV-06 | Reject/request changes without required comment, wrong expected version or invalid transition → validation/conflict and no partial state. |
| REV-07 | Missing/expired/wrong-asset companion evidence → approval blocked; unrelated project or calibration valid only today cannot qualify a historical test incorrectly. |
| REV-08 | External proof points to processing/quarantined/foreign/unrelated object → denied; valid evidence pins immutable proof version and source metadata. |
| REV-09 | External decision future date/invalid source/forged approver-role/empty reference → contract validation; recording external response does not invent recipient authority. |
| REV-10 | Decision creates append-only history; later correction/supersession → preserves prior actor/date/version rather than rewriting historical approval. |
| REV-11 | Bulk decision with one forbidden/stale item → documented all-or-nothing or explicit per-item receipt, never silent partial approval. |
| REV-12 | Legacy stamp-back currently → 410 and no approvals; future replacement response binds exact persisted transmittal item and version. |
| REV-13 | Transmittal snapshots N known versions then later uploads/relinks → original item list/hash unchanged; wrong recipient cannot respond. |
| REV-14 | Public/internal comment visibility through list/detail/export/guest view → internal text never exposed; malicious markup rendered safely. |
| REV-15 | Normal controllers and retained internal helper entry points → same invariants or explicit unavailable status; simulations do not exercise weaker authority in production paths. |

## 15. Evidence qualification and readiness

Proposed files: `apps/api/test/integration/evidence-qualification.spec.ts`, `readiness.spec.ts`. Some cases require T08 implementation; do not mark them complete with mocked approved rows.

| ID | Exact scenario and oracle |
|---|---|
| READY-01 | Only revision_code or requirement status says approved, file/review/storage is not qualified → blocker remains. |
| READY-02 | Exact approved version with READY immutable object/digest/size → satisfies only the linked requirement revision/slot/stage/identity it qualifies. |
| READY-03 | Link a new obligation to an already-approved document → cannot automatically inherit an approval for a different obligation. |
| READY-04 | Superseded/deleted/revoked evidence or changed current asset identity → invalidates relevant qualification; historical snapshots remain unchanged. |
| READY-05 | Several candidate documents: expired first/valid second and reversed insertion order → deterministic same result, no arbitrary LIMIT 1 dependency. |
| READY-06 | One mandatory slot missing while other slots filled → requirement blocked; optional slot missing gives warning only if specified. |
| READY-07 | Expiry yesterday/today/tomorrow at India midnight and warning threshold → exact business-date boundary with stable result across host timezones. |
| READY-08 | Valid active waiver versus pending/same-person countersign/revoked waiver → only qualifying waiver can remove blocker. |
| READY-09 | Empty project, all optional requirements, and no project found → explicitly distinct documented outputs; nonexistent project cannot appear ready. |
| READY-10 | Qualification revoked while package snapshot created → snapshot transaction rechecks and fails or consistently pins permitted pre-revocation state under explicit locking policy. |
| READY-11 | Readiness explanations name exact blocked slot/evidence/version/reason and source policy without leaking internal/commercial data to guests. |

## 16. Handover packages, PDF engine, submission and archive

Proposed files: `apps/worker/test/artifacts/handover.spec.ts`, `packages/pdf-engine/test/package-builder.spec.ts`, `apps/api/test/integration/submissions.spec.ts`, `tests/operations/archive-verifier.spec.ts`. Maps to T09.

| ID | Exact scenario and oracle |
|---|---|
| PKG-01 | Generate with unresolved mandatory blocker → no queued package; valid prerequisites → QUEUED receipt plus frozen items and requirements. |
| PKG-02 | Edit document/title/requirement after snapshot → artifact still represents frozen versions/metadata; no live-pointer substitution. |
| PKG-03 | Compile two uniquely marked PDFs/images → independent PDF parser sees expected page order/markers/count, index, headings and links; no blank placeholder accepted. |
| PKG-04 | Worker compilation succeeds → actual stored downloadable artifact, correct SHA-256/size/provider version, then READY committed; missing object cannot yield READY. |
| PKG-05 | Missing/corrupt source, converter failure, output upload failure, DB failure after upload → recoverable/FAILED receipt, never false READY; orphan artifact reconciled. |
| PKG-06 | Repeat compile/retry/crash after artifact persistence → one effective package output/receipt, no quota double-charge or mutation of frozen source list. |
| PKG-07 | qpdf enabled/fallback path → semantically equivalent contents; bounded resource limits; no requirement of identical bytes if timestamps/IDs differ by contract. |
| PKG-08 | Unicode/RTL/long titles, mixed orientation, TOC across page boundaries and many bookmarks → readable correct output without cropped labels or broken page refs. |
| PKG-09 | RA evidence pack → nonempty exact bill/milestone-qualified item list and independent artifact verification; wrong stage or merely approved unrelated file excluded. |
| PKG-10 | Large package exceeds source/output/page limit → early explicit failure and healthy worker; no partial downloadable artifact exposed. |
| SUB-01 | Submit not-READY/nonexistent/foreign package → denied; valid READY snapshot creates exact recipients/submission/items, audit/outbox. |
| SUB-02 | Required recipients accept/partially accept/reject in different orders → aggregate per policy; optional recipient cannot prematurely accept entire submission. |
| SUB-03 | Foreign recipient or stale/revoked grant response → denied; response cannot refer to version outside submitted snapshot. |
| SUB-04 | Replay and concurrent contradictory recipient decisions → one defined outcome/history, no overwritten prior decision; notes/proof retained. |
| SUB-05 | Acceptance of section/package → does not auto-mark unrelated project sections, monetary receipts or retention paid. |
| ARC-01 | Current manifest-only export → clearly marked manifest-only, no portable archive or original-file availability claim. |
| ARC-02 | Future portable export → extract in isolated directory without app/DB; manifest lists every included immutable file, digest/bytes/relationships; independent verifier passes. |
| ARC-03 | Remove/change one file or alter manifest → verifier fails exact mismatch; manifest checksum alone is insufficient to claim evidence file integrity. |
| ARC-04 | Archive paths with ../, absolute paths, duplicate names/case collisions and symlinks → safe names or rejection, no traversal/extraction overwrite. |
| ARC-05 | Customer archive permissions/retention/excluded data → export contains only authorized tenant/project evidence and documented metadata; secrets/internal messages excluded as required. |

## 17. Idempotency, outbox and distributed recovery

Proposed files: `apps/api/test/integration/command-receipts.spec.ts`, `apps/worker/test/integration/outbox-recovery.spec.ts`. Maps to T06.

| ID | Exact scenario and oracle |
|---|---|
| TX-01 | Same key+actor+endpoint+payload replay → original status/body/entity, one mutation/event/quota charge; key with different payload → 409. |
| TX-02 | Concurrent identical commands → one executes; other in-progress/replay according to contract, never second effect. |
| TX-03 | Same key in another tenant/actor/endpoint → correct isolation according to declared namespace; no response from another actor leaked. |
| TX-04 | Receipt claim DB unavailable → handler not run; completion write unavailable after business commit → explicit durable reconciliation, never safe-to-retry claim without proof. |
| TX-05 | Kill API after claim, after business commit, before receipt save and before HTTP response → deterministic recoverable outcome and at-most-one effect; current separate transaction gap must be exposed. |
| TX-06 | Expired completed key → renewed claim under policy; expired unresolved in-progress key → no automatic duplicate execution until reconciliation proves outcome. |
| TX-07 | Handler validation/domain failure before mutation → receipt cleanup policy permits safe correction; partial business failure → rollback all effects. |
| TX-08 | Outbox insert failure → business rollback; dispatch crash after enqueue before marking dispatched → same deterministic job ID, one effective worker effect. |
| TX-09 | Two pollers under contention → no lost events; SKIP LOCKED/scoped ordering and bounded batch behavior checked with actual rows. |
| TX-10 | Unknown event type or repeated provider outage → bounded retries, visible dead-letter/reconciliation state and metrics, not silently dispatched/dropped. |
| TX-11 | Audit/outbox actor and project context after asynchronous work → original authorized scope or explicit SYSTEM provenance retained, no creator impersonation. |
| TX-12 | Redis loses queued job after DB marks dispatch → documented durable reconciliation recreates missing work, or release blocker recorded. |

## 18. Scheduler, expiry, cleanup and notifications

Proposed files: `apps/worker/test/integration/scheduler.spec.ts`, `apps/api/test/providers/delivery.spec.ts`, `apps/api/test/http/notifications.http.spec.ts`.

| ID | Exact scenario and oracle |
|---|---|
| SCHED-01 | Two schedulers at same due period → one effective run; repeated polling same slot does not repeat successful job. |
| SCHED-02 | Old lock owner finishes after TTL and a new owner acquired lock → old owner cannot release new lock; long-running work has explicit renewal/idempotent effect policy. |
| SCHED-03 | Job fails before completion marker → next run retries; success marker TTL and timezone rollover do not suppress next legitimate period. |
| SCHED-04 | India day/week/hour boundaries, December/January ISO week and host timezone changes → correct slot once, not every poll. |
| SCHED-05 | Expiry job with expired approved file and alternate valid qualified file → expires only obligations no longer satisfied; audit/version/history policy preserved. |
| SCHED-06 | Cleanup with old unfinished intent, active multipart, referenced PENDING object and verified original → only eligible abandoned work cleaned; live/reference-protected evidence retained. |
| SCHED-07 | Multiple contracts × multiple requirements → retention sum counts each contract once and blockers each requirement once; zero/large values exact. |
| SCHED-08 | Multiple owner recipients → each receives exactly one weekly digest; dedup does not suppress distinct intended recipients. |
| NOTIF-01 | External channel create → QUEUED until actual provider acknowledgment; failure never reported SENT. IN_APP visible only to intended recipient/scope. |
| NOTIF-02 | Quiet hours exactly 22:00/08:00 India, urgency and preferences → defer/send as contracted; deferred jobs resume once. |
| NOTIF-03 | Duplicate event, retry, duplicate/out-of-order delivery callback → one logical notification with monotonic legitimate lifecycle, no duplicate provider send. |
| NOTIF-04 | Provider 429/timeout/500/invalid response → bounded backoff and actionable terminal state; credentials/OTP absent from logs. |
| NOTIF-05 | Invalid callback signature/replay/foreign notification ID → rejected without changing delivery status. |
| NOTIF-06 | Digest with missing contract values → unknown/absent financial estimate, never invented INR default; max title length and internal-note redaction verified. |

## 19. Commercial readiness, SaaS billing and payment webhooks

Proposed files: `apps/api/test/integration/commercial-readiness.spec.ts`, `apps/api/test/http/billing.http.spec.ts`, `apps/api/test/providers/payment-webhooks.spec.ts`. T19 is distinct from subscription billing. Test financial calculation correctness against approved contract fixtures; this guide does not define tax law.

| ID | Exact scenario and oracle |
|---|---|
| MONEY-01 | Integer paise at zero, one, cap and >JavaScript safe integer boundaries → exact string/BigInt results; no float rounding or invented missing input. |
| MONEY-02 | Readiness by milestone with exact JMR/MB/bill evidence → qualifying stage only; missing/disputed/expired evidence gives explainable blocker. |
| MONEY-03 | Eligible/applied/certified/received/disputed transitions → independent and auditable; handover acceptance cannot mark paid. **Future ledger acceptance.** |
| MONEY-04 | Partial release, cap, signed adjustment and duplicate receipt → consistent tranche balance and immutable source/proof. **Future ledger acceptance.** |
| MONEY-05 | Commercial summary under guest/site role → no price, total, retention or internal financial note leakage through nested DTO/export/digest. |
| BILL-01 | Authorized invoice creation/list/TDS → correct tenant, immutable numbering and independently calculated totals; unauthorized project-only roles denied. |
| BILL-02 | Provider success/failure/timeout for retained GST/e-invoice adapter → no fake issued/registered status; repeated requests do not issue duplicate invoice. |
| BILL-03 | Payment webhook altered raw body, missing/wrong signature → rejected using exact raw bytes; parsed/re-stringified body must not define signature input. |
| BILL-04 | Same webhook delivered repeatedly/concurrently → one payment/subscription/quota effect with durable provider event ID. |
| BILL-05 | Valid signature but wrong account/amount/currency/invoice/tenant → no credit or activation until reconciled. |
| BILL-06 | Refund/failure/out-of-order capture after success → documented monotonic/reconciliation behavior; immutable payment evidence retained. |
| BILL-07 | Usage/plan limits tested at N−1/N/N+1 and concurrent uploads/packages → no over-consumption or double release; rollback restores quota. |

## 20. Warranty, defects, acceptance and commissioning

Proposed files: `apps/api/test/integration/aftercare.spec.ts`, and future `quality-runs.spec.ts`. Maps to T17/T18.

| ID | Exact scenario and oracle |
|---|---|
| CARE-01 | Warranty source basis differs from contractual anchor → conflict/pending, no automatic active warranty; upload date does not silently set start date. |
| CARE-02 | OEM warranty and contractor DLP with different anchors/durations → separate clocks and reminders; exact leap-day/month boundary computed explicitly. |
| CARE-03 | Partial/conditional acceptance → only covered scope clock advances, exceptions remain actionable with owner/due dates. **Full sectional workflow acceptance.** |
| CARE-04 | Defect close without proof, unrelated/foreign/quarantined proof or unauthorized verifier → denied; valid remedy+verification creates immutable closure trail. |
| CARE-05 | Reopen defect and replacement during warranty → prior closure/history preserved, linked unit/source terms retained, no arbitrary warranty reset. |
| CARE-06 | Training attendance/spares transfer partially acknowledged → missing receipt remains blocker for required acceptance scope. **Future acceptance.** |
| QA-01 | Inspection/test pins template/procedure revision → later template edit cannot change historical expected readings or thresholds. **Future acceptance.** |
| QA-02 | Unit mismatch, missing reading, lower/upper boundary and decimal precision → explicit calculation result; no universal hardcoded HVAC pass threshold. **Future acceptance.** |
| QA-03 | Instrument calibration expired at actual test time but valid now, or valid then expired now → decision uses actual test instant and pinned certificate. **Future acceptance.** |
| QA-04 | Hold/witness point unreleased or wrong witness → cannot complete/accept run; authorized release recorded. **Future acceptance.** |
| QA-05 | Failed run/retest/seasonal deferral → linked run history; no overwrite of failure; generated report follows normal evidence scan/review. **Future acceptance.** |
| QA-06 | Offline reading conflict, backdated entry and future test date → explicit provenance/conflict; no silent accepted measurements. **Future acceptance.** |

## 21. Signature containment and audit integrity

Proposed files: `apps/api/test/http/signatures.http.spec.ts`, `packages/db/test/audit-chain.integration.spec.ts`. Maps to T10.

| ID | Exact scenario and oracle |
|---|---|
| SIGN-01 | Currently disabled signing/placeholder/injection routes → 410/unavailable as contracted, no signature record or certified PDF generated. |
| SIGN-02 | Existing record with absent/matching/mismatching candidate digest → NOT_CHECKED/DIGEST_MATCH/DIGEST_MISMATCH and `verified:false`; no trust-chain assurance implied. |
| SIGN-03 | Public verification invalid code/rate flood/foreign-sensitive metadata → bounded minimal projection without account/internal data. |
| SIGN-04 | UI/package wording for unsupported certification → no verified/legally certified badge; ordinary approval remains distinguishable from cryptographic signature verification. |
| AUDIT-01 | Successful mutations and denials → accurate authorized actor/guest/SYSTEM provenance; sensitive tokens/OTP never copied into audit payload. |
| AUDIT-02 | Concurrent audit append → correct ordered chain and prior hash under actual DB trigger/locking; no chain fork. |
| AUDIT-03 | Runtime UPDATE/DELETE audit row → immutability rejection; privileged disposable tampering → verifier detects content and link mismatch independently. |
| AUDIT-04 | Tamper first event, remove middle event, change last payload and break sequence → appropriate verification failure, including genesis policy. |
| AUDIT-05 | Audit list/filter/export with same timestamp pagination → stable scope/ordering; internal before/after payload not leaked to guest. |

## 22. Web components, offline queue and browser workflows

Proposed files: `apps/web/test/` for focused component/state tests and the browser files below. Do not substitute mocked API browser tests for all integrated scenarios.

| ID | Exact scenario and oracle |
|---|---|
| WEB-01 | Login request/verify/loading/error/resend with delivery unavailable → clear actionable state, no prefilled production OTP or fake success. |
| WEB-02 | Project/filter/page selection survives refresh/back navigation through URL; tenant switch clears inaccessible results and no stale flash of foreign data. |
| WEB-03 | Upload dialog validates metadata/limits, shows actual progress/processing/verified/failed separately; double click produces one command. |
| WEB-04 | Review displays exact version, required authority and proof; confirmation stale conflict refreshes rather than showing approved success. |
| WEB-05 | Package builder shows blockers and queued receipt, then real artifact ready; refresh/reopen resumes polling; download verifies actual file. |
| WEB-06 | API returns 401/403/404/409/412/422/429/503 → field/action-specific handling; no generic success toast, lost draft or endless spinner. |
| OFF-01 | Offline intent/file queued, page/browser restarted then network restored → persists bytes/metadata and uploads once to intended project. |
| OFF-02 | Member A logs out; member B or same user in other org logs in → A's IndexedDB records cannot be displayed/resumed/submitted as B. |
| OFF-03 | Poll timeout while server still processing → queue entry retained with recoverable state, not deleted or reuploaded automatically. |
| OFF-04 | Two tabs attempt same queued item → one effective intent/completion; tab crash allows recovery without duplicates. |
| OFF-05 | IndexedDB unavailable/full/corrupt/schema upgrade → visible failure or safe migration; user not told file is safely queued if persistence failed. |
| OFF-06 | Session expires/grant revoked during resume → pause/deny, preserve safe local recovery state; no silent context rebinding. |
| OFF-07 | Service worker cache → no private API/download/auth responses cached across principals; shell update does not discard pending work. |
| OFF-08 | Logout/org-switch server failure and pending drafts → explicit disposition and error behavior; unsent work neither silently lost nor shared. |
| UX-01 | Keyboard-only login/upload/review/submit → focus order, labels, modal focus trap/restore and error announcements correct. |
| UX-02 | Mobile portrait/landscape, 200% zoom and narrow viewport → usable primary actions/tables, no clipped confirmation/error; upload works with file picker. |
| UX-03 | Reduced motion, color contrast and status without color alone → functional accessible flows; automated accessibility checks plus manual keyboard review. |
| UX-04 | Double-click/navigation away/request cancellation → no duplicate mutation or misleading optimistic completion. |
| UX-05 | Untrusted title/comment/filename renders as text, malicious URL rejected, no script execution; browser console/network contains no credentials. |

Required **integrated browser journeys**, each with distinct member/guest browser contexts:

| ID / proposed browser file | Journey and durable outcome |
|---|---|
| E2E-01 `contractor-closeout.spec.ts` | Import/create baseline → assign → upload → real scan → reviewer approves → readiness → compile → independently inspect downloaded PDF. Verify DB/audit/outbox and guest projection. |
| E2E-02 `supplier-return-cycle.spec.ts` | Scoped supplier OTP → phone-sized upload → receipt → technical review returns → new revision → approval; supplier never approves own requirement. |
| E2E-03 `recipient-acceptance.spec.ts` | Freeze package → send to two required recipients → one accepts/one requests changes → new submission → correct aggregate outcome preserving first snapshot. |
| E2E-04 `isolation.spec.ts` | A1 user/guest attempts A2/B1 navigation, forged IDs, API requests and signed downloads → no exposure/effect anywhere. |
| E2E-05 `offline-recovery.spec.ts` | Queue while offline → restart → actor switch isolation → intended actor resumes → scan delayed → UI retains queue until actual terminal receipt. |
| E2E-06 `replacement-revalidation.spec.ts` | Replace equipment serial → old qualified evidence blocked → new evidence/revalidation → readiness restored only for intended asset. |
| E2E-07 `import-conflicts.spec.ts` | Preview realistic register → resolve duplicate/invalid rows → concurrent baseline edit → stale commit rejected then reviewed retry succeeds. **Replacement import gate.** |
| E2E-08 `aftercare.spec.ts` | Conditional section acceptance → warranty anchor pending/recorded → defect proof and independent verification → correct timeline without marking money received. **Full aftercare gate.** |

## 23. Shared package, property and state-machine tests

Proposed files: `packages/shared/test/validators.spec.ts`, `permissions.spec.ts`, `status-transitions.spec.ts`, `dates-money.property.spec.ts`.

| ID | Exact scenario and oracle |
|---|---|
| SHARED-01 | Validators for GSTIN/identity/date/UUID/size/state → known independently verified vectors plus mutation of each field; syntactic validity does not claim government registration. |
| SHARED-02 | Permission combinations including unknown role/capability, org-wide download toggle and project role → manual expected outcomes; deny missing inputs. |
| SHARED-03 | Legal/illegal lifecycle transitions for project/file/review/waiver/package/submission → exhaustive transition table, unknown state rejected. |
| SHARED-04 | Random command sequences → invariants: no approval before verification; no duplicate terminal decision; no satisfaction from unqualified evidence. Print seed/minimal failing sequence. |
| SHARED-05 | Integer money operations random bounds → exact arithmetic, caps/nonnegative balances; splitting/combining identical lawful amounts preserves total. |
| SHARED-06 | Date/time random instants around boundaries → host-timezone-independent India business date/period; explicit leap-year and ISO week vectors. |
| SHARED-07 | Environment parsing missing/invalid production config → startup fails with safe message; debug/bypass flags cannot silently weaken staging/production. |
| SHARED-08 | Catalogue rule combinations and deterministic serialization/checksums → stable semantics for equivalent canonical input, meaningful field change changes digest. |

## 24. Operations, security, recovery and performance

Proposed files: `tests/operations/restore.spec.ts`, `deployment.spec.ts`, `tests/security/abuse.spec.ts`, `tests/load/closeout.js` (tool selection documented before implementation). Run destructive/fault checks only in disposable environments.

| ID | Exact scenario and oracle |
|---|---|
| OPS-01 | Boot with DB/Redis/storage/scanner/migration mismatch → readiness distinguishes required unavailable dependency from healthy service; no raw error secrets. |
| OPS-02 | Deploy API/worker and SIGTERM during active tasks → drain or durable retry, closed connections, no lost receipts, health unavailable during shutdown. |
| OPS-03 | Restore DB into fresh instance using supported script → correct audit columns/catalog views, compare expected row counts/constraints/policies/roles; fail on any mismatch. |
| OPS-04 | Restore actual versioned object set and verify fixture/production-like sample bytes against manifests → no reliance on READY metadata alone. |
| OPS-05 | Independently recompute restored audit content/links; tampered/missing event causes drill failure; cleanup preserves diagnostic evidence according to retention policy. |
| OPS-06 | Measure RPO and RTO against approved targets with explicit start/end events and data-loss accounting; script enforces threshold, not just prints it. |
| OPS-07 | Missing old object version, expired encryption key, unavailable bucket/region → failed drill with actionable list; never PASS from database-only restore. |
| OPS-08 | Clean deployment/upgrade/rollback of application compatible with expand-only migrations → existing evidence/history preserved and jobs readable across supported release transition. |
| SEC-01 | CORS/cookie/CSP/CSRF and cache headers on auth/guest/download paths → approved origins only and no private caching; reflected host/origin cannot change trusted links. |
| SEC-02 | Query/file/comment/CSV/path injection and oversized payloads → no SQL/shell/template/script execution; errors redact details. |
| SEC-03 | Signed upload/download URLs cannot set arbitrary keys/versions or access other tenant; content-type/size/expiry restrictions enforced where contracted. |
| SEC-04 | Provider URLs/converter remote references → SSRF cannot reach metadata/internal addresses; no remote workbook/PDF content fetched implicitly. |
| SEC-05 | Dependency/secret/container/IaC scanning → actionable triaged findings with ownership and expiry for exceptions; no unreviewed blanket ignore. |
| LOAD-01 | Representative tenant fixtures at small/medium/large scales (start 100/10k/100k requirements) → measure readiness/list/dashboard p50/p95/p99, query plans and DB pool usage. Scales are test profiles, not claimed supported capacity. |
| LOAD-02 | Concurrent multipart completions/reviews/package compilation with retries → latency/resource envelopes and integrity invariants hold; no starvation of interactive reads. |
| LOAD-03 | Worker backlog and provider outage then recovery → bounded queue growth/retries, fair tenant progress, eventual recovery with no duplicate business effects. |
| LOAD-04 | Sustained scan/compile workload → memory/temp-disk/connection leak check; RSS plateaus and files cleaned after success/failure/crash. |
| LOAD-05 | Concurrent request floods across several tenants → per-tenant abuse limits, no one tenant monopolizes pool/provider budget; meaningful 429/503 behavior. |

Agree explicit latency/resource/error budgets before declaring performance tests passing. Version the fixture sizes, concurrency, deployment hardware and budgets. Never substitute an invented universal latency threshold for measured pilot requirements.

## 25. Future AI and optional product features

These are feature-enablement acceptance tests, not instructions to build excluded features. T20 requires customer processing permission and evaluation before enabling AI.

| ID | Exact scenario and oracle |
|---|---|
| AI-01 | Classification/metadata proposal → source version/digest/page citation, confidence, model/parser/prompt provenance and user accept/edit/reject recorded; no silent authoritative write. |
| AI-02 | Document contains malicious instructions → treated as untrusted data; no tool execution, approval, waiver, signing or monetary mutation. |
| AI-03 | Foreign/revoked retrieval record → absent from suggestions/citations/cache; isolation tested across tenants and after permission change. |
| AI-04 | Ambiguous OCR/date/serial and out-of-distribution fixture → explicit uncertain/unknown; labelled holdout accuracy and correction time meet pre-agreed enablement thresholds. |
| AI-05 | Provider outage, spend cap and duplicate retries → bounded cost, no duplicate charge/proposal, manual workflow remains usable. |
| OPT-01 | Decision register/waiting ledger → ingestion dedup, human matching confirmation, original source/version preservation and factual delay calculation; no unsupported blame/legal inference. |
| OPT-02 | Supplier scorecard/portfolio analytics → independently computed denominator/cohort and scope; missing data marked unknown rather than fabricated score. |
| OPT-03 | Field language support → translated critical actions/errors/dates/units checked by speaker, no loss of meaning in review/acceptance confirmation. |

## 26. CI wiring and release gates

The following script names are **proposed**; implement and document them before advertising them as runnable. Root commands must discover all owning packages, fail if a required suite has zero tests, and keep infrastructure suites distinct from fast unit tests.

| Proposed command | Required work |
|---|---|
| `test:unit` | Shared rules, config, pure domain/PDF helpers; deterministic fast tests. |
| `test:integration` | PostgreSQL/Redis/storage/scanner service+worker tests with runtime-role assertions. |
| `test:http` | Actual Nest HTTP contract matrix and all aliases. |
| `test:e2e` | Built web/API/worker Playwright journeys and browser isolation. |
| `test:artifacts` | Independent PDF/archive validation. |
| `test:providers` | Local adapter contract suite; real sandbox smoke separately gated by credentials. |
| `test:migrations` | Fresh/upgrade/checksum/concurrency/schema parity on disposable databases. |
| `test:recovery` | Database+object restore and measured failure injection in isolated environment. |
| `test:load` | Versioned representative load profiles and budgets; report artifact even on failure. |

Suggested pipeline distribution:

- **Every PR:** typecheck/build, unit, affected integration/HTTP tests plus full tenant-boundary/receipt invariants, static scans, core browser closeout/isolation, fresh migration smoke, independent small artifact validation. Required tests cannot be bypassed by filename changes in shared infrastructure.
- **Nightly:** complete role/resource cross-product, all browser journeys, provider failure matrix, upgrade baselines, random state sequences with recorded seeds, larger artifact/resource tests and worker crash recovery.
- **Before pilot/release:** all core T01–T14 acceptance evidence plus enabled T15/T16 MVP cases; real provider sandbox/storage checks; restore drill; measured load; documented manual accessibility/operator review. No open critical isolation/integrity gap.
- **Before future feature flag enabled:** its acceptance cases become required in CI, including negative and isolation cases; an existing skipped case does not satisfy the gate.

Set coverage only after obtaining the baseline. Track lines/branches by package and critical module; propose high branch coverage for pure rules but do not let a numeric target replace scenario coverage. Critical invariants above must have direct behavioral tests even when aggregate coverage is high. Use mutation testing selectively on permissions, date/money rules and state transitions: a removed deny check or changed boundary must make a test fail. Review surviving mutants rather than chasing a global percentage.

## 27. Delivery sequence and acceptance checklist

| Slice | Deliverable | Gate before proceeding |
|---|---|---|
| 0 | Route/test inventory, test projects, disposable infrastructure, fixture builders and CI artifacts | Real runtime-role DB/Redis/storage/scanner smoke; fail on privileged role or missing dependency. |
| 1 | DB/IAM/AUTHZ/HTTP and receipt crash tests | Critical trust-boundary failures reproduced and fixed or explicitly blocking release. |
| 2 | Upload/scan/review/readiness plus asset replacement | One real immutable evidence path including negative and concurrency cases. |
| 3 | Package/artifact/submission/export verification | Downloaded bytes independently verified; no false READY/archive assurance. |
| 4 | Delivery/scheduler/offline/browser cycles | Supplier/member/recipient return cycle and process/network recovery proven. |
| 5 | Remaining active org/config/billing/aftercare surfaces and operations/load | Every active route inventoried with meaningful cases, pilot recovery and budget evidence. |
| 6 | Future feature cases at implementation time | No inactive future test counted as present functionality. |

For each completed slice supply:

- Exact test IDs and paths, layer and any provider doubles; real boundary exercised.
- Setup/commands and dependency versions; fixture manifest, random seed and frozen-clock values.
- JUnit/coverage output; browser traces/screenshots on failure; worker logs/queue receipts; independent artifact digest/verifier report.
- Failure-injection point and persisted state before/after, including relevant audit/outbox/idempotency/quota rows from fresh connections.
- Open defects and future blocked cases with owner/task, next action and release impact.
- Commit hash plus dirty-tree manifest when applicable; do not attach production credentials, personal data or raw OTP/session tokens to reports.

Definition of done: a test fails when its guarded behavior is deliberately broken, passes against the accepted implementation, runs reliably in its declared CI lane, isolates its data and proves the documented outcome. The programme is complete for a release only when all enabled-feature gates pass and every active route and critical cross-service workflow has traceable evidence.
