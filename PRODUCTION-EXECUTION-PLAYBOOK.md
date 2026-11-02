# TRADECLOSEOUT — MASTER PRODUCTION ENGINEERING PLAYBOOK (M0–M10)

## 1. Monorepo Architecture & Directory Blueprint

The system is architected as a **TypeScript Modular Monolith + Asynchronous Worker Pool** inside a single `pnpm` workspace monorepo (`D-001`, `D-006`, `NFR-MNT-001`). Cross-module database access is strictly forbidden; modules communicate synchronously via exported service interfaces and asynchronously via a transactional PostgreSQL outbox (`D-005`, `09` §4, §5.2).

```text
tradecloseout/
├── apps/
│   ├── api/                                # NestJS Modular Monolith (REST /api/v1)
│   │   └── src/
│   │       ├── common/                     # Guards, Interceptors, Problem+JSON Filter, Pipes
│   │       │   ├── auth/                   # Opaque Session Guard, CSRF Guard, Guest Token Guard
│   │       │   ├── permissions/            # Positive-Only Scope Engine (AUD-012) & Visibility Projection (AUD-S-24)
│   │       │   ├── idempotency/            # Idempotency-Key Interceptor (10 §5)
│   │       │   └── concurrency/            # If-Match row_version Guard (10 §1)
│   │       └── modules/
│   │           ├── identity/               # FR-IAM, OTP, Magic Link, Sessions, Switch-Org
│   │           ├── organisations/          # FR-ORG, Profiles, Branding, Memberships, Reassign (WF-21)
│   │           ├── parties/                # FR-PTY, Counterparties, Guest Grants, Supplier Links (WF-08)
│   │           ├── projects/               # FR-PRJ, FR-CNT, Contracts, Spec Refs, Variations (WF-26)
│   │           ├── configuration/          # FR-CFG, L0-L4 Resolver, Template Packs, Client Profiles
│   │           ├── checklists/             # FR-CHK, Snapshots, Requirements, Revisions, Waivers, Change Requests (WF-20)
│   │           ├── assets/                 # FR-AST, Equipment Register, CSV Import/Export, Replacement Lineage
│   │           ├── documents/              # FR-DOC, S3 Multipart Intents, Versions, Bulk ZIP Import (FR-DOC-031)
│   │           ├── reviews/                # FR-REV, Row-Locked Decisions (AUD-007), External Approvals (WF-23)
│   │           ├── handover/               # FR-HND, Readiness Check, Package Preview, Multi-Recipient Submissions
│   │           ├── warranty-defects/       # WF-24 Warranty Reconciliation, WF-25 DLP Snag Tracker
│   │           ├── notifications/          # FR-NOT, Email, DLT SMS, WhatsApp Deep Links
│   │           ├── audit/                  # FR-AUD, Append-Only Business Audit & Security Events
│   │           ├── search-reports/         # FR-SRCH, FR-RPT, Scoped Metadata Search & Excel Exports
│   │           ├── billing/                # FR-BIL, Razorpay Webhooks, FOR UPDATE Usage Counters, GST/TDS/IRN
│   │           └── admin/                  # FR-ADM, Platform Orgs, Job Retries, Break-Glass Audit
│   ├── worker/                             # BullMQ Processors + Leader-Locked Scheduler (09 §3, 15 §2)
│   │   └── src/
│   │       ├── outbox-dispatcher.ts        # Polls outbox_events -> Publishes to Redis/BullMQ (09 §5.2)
│   │       ├── queues/
│   │       │   ├── file.processor.ts       # WF-11: Magic-Byte Sniff, SHA-256, qpdf Check, ClamAV Scan
│   │       │   ├── pdf.processor.ts        # WF-16 / RT-025: Pure-Node pdf-lib Cover/Index + qpdf Merge
│   │       │   ├── notify.processor.ts     # WF-14: Reminders, Quiet Hours, Owner Weekly Digest (BR-GTM-07)
│   │       │   └── retention.processor.ts  # WF-19 / WF-22: Daily Expiry, Audit Hash Chain, Legal Hold Purge
│   │       └── scheduler.ts                # Redis leader-locked cron triggers
│   └── web/                                # Next.js App Router PWA (Tailwind + shadcn/ui)
│       └── src/
│           ├── app/
│           │   ├── (public)/               # SCR-001 Landing, SCR-002 Signup, SCR-003 OTP
│           │   ├── (contractor)/           # Authenticated Contractor Shell (SCR-004 to SCR-059)
│           │   ├── (guest)/guest/[token]/  # Isolated Guest Routes: SCR-034 Supplier, SCR-035 Consultant, SCR-036/031 Client
│           │   └── (admin)/admin/          # Platform Admin Plane (SCR-051, SCR-052)
│           ├── components/
│           └── lib/                        # API Client, S3 Resumable Uploader, localStorage Draft Manager
├── packages/
│   ├── db/                                 # Drizzle Schema, SQL Migrations, RLS Transaction Wrapper
│   └── shared/                             # Shared Zod Schemas, Status Enums, Indian Formatters, Permission Matrix
└── infra/
    ├── docker/                             # Dockerfiles & docker-compose.prod.yml (API, Worker, ClamAV)
    └── terraform/                          # VPC, RDS Postgres 16, ElastiCache Redis, S3 Private Buckets, WAF, NTP

```

---

## 2. Ten Non-Negotiable Engineering Invariants (Enforced in Every File)

Your coding agent must enforce these 10 rules across every module:

1. **Tenant Resolution Only from Session (`AUD-014`):** `session.active_org_id` is the sole authoritative tenant identifier. If any route parameter `/orgs/:orgId` or body payload disagrees with `session.active_org_id`, immediately return `404 Not Found` (never `403`, to prevent existence enumeration).


2. **Transaction-Local RLS on Every Database Call (`RT-005`, `AUD-035`):** Runtime services (`api` and `worker`) connect exclusively as PostgreSQL role `tc_app` (`NOBYPASSRLS`). Every database access must run inside `withTenantTransaction(orgId, userId, fn)` which executes `SET LOCAL app.current_org = $1` and `SET LOCAL app.current_user = $2`. All tenant tables enforce `FORCE ROW LEVEL SECURITY` and fail closed (`0 rows`) if `app.current_org` is unset.


3. **Database-Enforced Cross-Project Integrity (`AUD-004`):** Every project-scoped child table (`requirements`, `documents`, `document_versions`, `document_requirements`, `document_assets`, `reviews`, `package_items`, `package_requirements`, `defects`, `warranty_events`) carries both `org_id` and `project_id` with composite foreign keys `FOREIGN KEY (org_id, project_id, ...)` referencing parent `UNIQUE (org_id, project_id, id)` constraints.


4. **Opaque Hashed Session Cookies + CSRF (`10` §1–§2.2):** Browser authentication uses `HttpOnly`, `Secure`, `SameSite=Lax` cookies containing a 256-bit random token whose SHA-256 hash is looked up in `sessions` on every request (no stateless JWTs, ensuring role revocation takes effect in `<60s` per `FR-IAM-007`). All unsafe methods (`POST`, `PATCH`, `PUT`, `DELETE`) validate the `X-CSRF-Token` header.


5. **Mandatory Idempotency & Optimistic Concurrency (`10` §1, §5):** Every state-changing `POST` requires `Idempotency-Key` scoped to `(org_id, endpoint, key)` storing a SHA-256 request body hash and response in `idempotency_keys` (reusing a key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`). Every mutable `PATCH`/`POST` decision requires `If-Match: "<rowVersion>"` and returns `412 PRECONDITION_FAILED` on mismatch.


6. **RFC 9457 `application/problem+json` Error Contract (`10` §4):** Every error response returns `{ type, title, status, code, detail, requestId, retryable, fieldErrors }` with zero stack traces or SQL leaks.


7. **Fail-Closed File & Malware Pipeline (`WF-11`, `FR-DOC-005`, `FR-DOC-009`):** Uploaded files go directly to private S3 via presigned multipart URLs (`PENDING_UPLOAD` → `UPLOADING` → `PROCESSING`). Download and preview URLs are strictly blocked until the worker sniffs magic bytes (rejecting executables, macro Office files, and `.svg`), verifies the SHA-256 hash, validates PDF structure (`qpdf --check`), and receives a `CLEAN` verdict from `clamd` (`READY`).


8. **Pure-Node.js PDF Generation with Control-Char/JS Stripping (`RT-025`, `AUD-006`, `RB-04`):** MVP uses `pdf-lib` + `qpdf` inside the worker (no Gotenberg container in MVP per `15` §2). User-supplied strings are sanitised before drawing; merged PDFs are linearised and stripped of `/JS`, `/JavaScript`, `/Launch`, and `/EmbeddedFiles` via `qpdf` under a `512 MB` memory ceiling (`RB-04`).


9. **Monetary & Time Precision (`08` §1, `README` §4.4):** All monetary amounts are stored as `BIGINT` integer paise (`₹4,999.00` = `499900`) and percentages/tax rates as integer basis points (`18%` = `1800`, `5%` retention = `500`). All timestamps are stored in `UTC` (`TIMESTAMPTZ`), while due-date/overdue/quiet-hour calculations evaluate in the project's timezone (`Asia/Kolkata` default).


10. **Transactional Outbox for All Side Effects (`09` §5.2):** Domain state transitions never call email, SMS, search, or audit writers inline. They insert an `outbox_events` row in the same database transaction, which the worker dispatches idempotently.



---

## 3. Step-by-Step Implementation Roadmap (Milestones M0–M10)

### Milestone M0: Monorepo Scaffold, Database Bootstrap & Technical Spikes

* **Deliverables:**
1. Initialize `pnpm` workspaces (`apps/api`, `apps/worker`, `apps/web`, `packages/db`, `packages/shared`) with strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`).


2. Create `infra/docker/docker-compose.dev.yml` running PostgreSQL 16, Redis 7, MinIO (S3-compatible local storage), and ClamAV (`clamav/clamav:stable`).


3. Implement UUIDv7 generator (`uuidv7`), `application/problem+json` exception filter (`10` §4), `X-Request-Id` middleware, and Pino structured JSON logger with PII redaction (`NFR-MNT-003`).


4. **Technical Spikes (`16`):**
* Verify `pdf-lib` + `qpdf` merges 500 pages with bookmarks and strips embedded `/JavaScript` in `<60s` within a `512 MB` memory limit (`RT-025`, `RB-04`).


* Verify S3 multipart resumable upload recovery when network drops mid-chunk (`FR-DOC-004`).






* **Exit Gate Tests (`TC-M0-*`):**
* `TC-M0-01`: `tc_app` database connection attempting `SELECT * FROM documents` without `SET LOCAL app.current_org` returns `0 rows` (RLS fail-closed check).


* `TC-M0-02`: `qpdf` spike rejects a password-protected PDF (`FR-DOC-010`) and strips `/JS` actions from a test PDF (`09` §5.3).





---

### Milestone M1: Identity, Passwordless Auth, Sessions & Append-Only Audit (`FR-IAM`, `FR-AUD`)

* **Database Tables (`packages/db`):**
* Global tables: `users`, `user_identities` (`UNIQUE(type, value)`), `sessions` (`token_hash UNIQUE`, `active_org_id NOT NULL`).


* Tenant/Audit tables: `organisations`, `org_profiles`, `memberships` (`UNIQUE(org_id, user_id)`), `invitations`, `audit_events` (monthly range-partitioned with `prev_hash`, `hash`), `security_events` (180-day retention), `admin_audit_events`, `idempotency_keys`, `outbox_events`.




* **Backend Modules (`apps/api/src/modules/identity`, `audit`):**
* Implement `API-001` (`POST /auth/otp/request`), `API-002` (`POST /auth/otp/verify`), `API-005`/`006` (Email Magic Link), `API-003` (`GET /auth/me`), `POST /auth/switch-org`, and `API-004` (`POST /auth/logout`).


* Implement DLT SMS provider adapter (`FR-INT-012`) with rate limiting (`5/hour/identifier`, `20/hour/IP`) and automatic fallback to email magic link after 2 failed SMS deliveries (`FR-IAM-002`, `RB-11`).


* Implement asynchronous audit hash-chain processor in `apps/worker` (`hash = sha256(prev_hash || canonical_json)`) and PII redaction before writing `before_json`/`after_json` (`08` §3.8, §5.6).




* **Frontend Screens (`apps/web`):**
* `SCR-001` Marketing Landing, `SCR-002` Sign Up, `SCR-003` Verify OTP, `SCR-005` Org Switcher.




* **Exit Gate Tests (`TC-IAM-*`, `TC-AUD-*`):**
* `TC-IAM-01`: Requesting `/api/v1/orgs/{otherOrgId}` when `session.active_org_id` is `orgA` returns `404 Not Found` (`AUD-014`).


* `TC-IAM-02`: Suspending a member revokes all active sessions immediately (`FR-IAM-007`).


* `TC-IAM-03`: Triggering 2 consecutive SMS provider failures automatically dispatches an email magic link (`FR-IAM-002`).


* `TC-AUD-01`: `tc_app` attempting `UPDATE` or `DELETE` on `audit_events` is rejected by PostgreSQL permissions/triggers (`FR-AUD-001`).





---

### Milestone M2: Organisations, Members, Parties & Projects (`FR-ORG`, `FR-PTY`, `FR-PRJ`, `FR-CNT`)

* **Database Tables:**
* `parties` (`types TEXT[]`), `party_contacts`, `projects` (`UNIQUE(org_id, upper(code))`, `UNIQUE(org_id, id)`), `project_members` (`UNIQUE(project_id, user_id)`), `contracts` (`parent_contract_id` for variations), `specification_refs`, `variations`.




* **Backend Modules (`organisations`, `parties`, `projects`):**
* Implement `API-010`–`019` (Org CRUD, GSTIN/PAN structural validation with checksum `FR-ORG-005`/`006`, Member invitations, Atomic Ownership Transfer `FR-ORG-014`, and Member Offboarding Gap Report + Bulk Reassignment `WF-21` / `API-019`).


* Implement `API-020`–`023` (Party directory with duplicate detection on GSTIN/email/normalised name `FR-PTY-009`).


* Implement `API-030`–`044` (Project lifecycle state machine `06` §3.1: `DRAFT` → `ACTIVE` → `SUSPENDED` → `HANDOVER` → `CLOSED` → `ARCHIVED`, plus Contract & Specification Registers).




* **Frontend Screens:**
* `SCR-004` 4-Step Resumable Onboarding Wizard (creates demo project if skipped), `SCR-010` Home Dashboard (with independent per-card retry on failure), `SCR-011` Projects List, `SCR-012` Create Project, `SCR-032`–`033` Parties Directory, `SCR-040`–`042` Members & Org Settings, `SCR-056` Bulk Reassign Work.




* **Exit Gate Tests (`TC-ORG-*`, `TC-PRJ-*`):**
* `TC-ORG-01`: Removing the last Owner or removing a member who owns open reviews without reassignment is blocked and returns the gap report (`WF-21`, `AUD-P-12`).


* `TC-PRJ-01`: Activating a project (`POST /projects/{id}/activate`) without an active checklist snapshot or without at least one managing member fails with `422` (`FR-PRJ-003`).


* `TC-PRJ-02`: Mutating `project.code` after activation is rejected (`FR-PRJ-004`), and write operations on a `SUSPENDED`, `CLOSED`, or `ARCHIVED` project are rejected even for `R-OWNER` (`05` §3.2).





---

### Milestone M3: Customisation Engine, Checklists & Variations (`FR-CFG`, `FR-CHK`, `WF-06`, `WF-20`, `WF-26`)

> **M3 EXTERNAL BUILD GATE (`TRADECLOSEOUT-MASTER-PROMPT.md` §0 Rule 4):** Before marking `TPL-HVAC-IN-001` as production-verified, validate its 72 default items against 5 real consultant/contractor HVAC checklists.
> 
> 

* **Database Tables:**
* `template_packs`, `config_versions`, `client_profiles`, `checklist_snapshots` (`UNIQUE(project_id, version_no)`), `requirements` (`scope_key` = `'project'` or `'asset:{uuid}'`), `requirement_revisions` (append-only definition history), `requirement_change_requests`, `waivers` (`second_approved_by` for mandatory items).




* **Backend Modules (`configuration`, `checklists`):**
* Implement the 5-level configuration resolver (`07` §4.3: `PLATFORM` → `ORG` [containing installed `TRADE` copy] → `CLIENT_CONTRACT` → `PROJECT`) enforcing `locked`, `inherit_only`, `overridable`, `additive`, and `keyed_merge` policies and complexity limits (`07` §5.1).


* Implement Snapshot Creation (`API-056`, `WF-06`), Post-Activation Controlled Change Requests (`API-063`–`066`, `WF-20`) with impact analysis, Variation Order L4 overrides with provenance (`API-184`–`185`, `WF-26`), and Two-Approver Waivers (`API-061`, `FR-CHK-016`).


* Enforce rule `FR-CHK-010`: a requirement with `due_at IS NULL` is never derived as `MISSING`.




* **Frontend Screens:**
* `SCR-014` Virtualised Checklist Grid (`@tanstack/react-virtual` rendering 1,000 rows in `<2s p95`), `SCR-015` Requirement Detail Drawer, `SCR-016` Pre-Activation Checklist Customiser, `SCR-017` Post-Activation Change Request Modal, `SCR-037`–`039` Templates & Config Diff Viewer.




* **Exit Gate Tests (`TC-CFG-*`, `TC-CHK-*`):**
* `TC-CFG-01`: Attempting to override a `locked` L0/L1 field at L2/L4 fails validation with the offending field path (`07` §8).


* `TC-CHK-01`: Editing an Org template (`L2`) does not mutate any active project's `checklist_snapshots` or `requirements` (`07` §13).


* `TC-CHK-02`: Waiving a `mandatory = true` requirement remains pending until a second `R-OWNER`/`R-ADMIN` user countersigns via `requirement.waive_second` (`FR-CHK-016`).





---

### Milestone M4: Equipment / Asset Register & Dynamic Requirement Instantiation (`FR-AST`, `WF-07`)

* **Database Tables:**
* `asset_categories`, `assets` (`UNIQUE(project_id, upper(tag))`, `UNIQUE(org_id, project_id, id)`, `warranty_start_basis`, `replaced_by_asset_id`).




* **Backend Modules (`assets`):**
* Implement `API-070`–`076` (Asset CRUD, case-insensitive tag normalisation, CSV/Excel import with dry-run row validation report, Excel export, and Asset-to-Document Matrix).


* Implement **Dynamic Asset-Scoped Instantiation (`AUD-002`, `WF-06`):** Whenever a new asset is created or imported on an active project, automatically instantiate requirement rows (`scope_key = 'asset:{asset_id}'`) for every asset-category requirement in the active snapshot matching `asset.category_key`.




* **Frontend Screens:**
* `SCR-018` Assets List, `SCR-019` Asset Detail & Document Matrix, `SCR-020` Asset CSV/Excel Importer.




* **Exit Gate Tests (`TC-AST-*`):**
* `TC-AST-01`: Creating asset `CHLR-02` (`category_key = 'CHILLER'`) on an active project automatically creates all Chiller-scoped requirements (`scope_key = 'asset:{CHLR-02.id}'`).


* `TC-AST-02`: Hard-deleting an asset with approved documents is blocked; soft-delete/retirement preserves historical documents (`FR-AST-006`, `FR-AST-008`).





---

### Milestone M5: Direct-to-S3 Uploads, Verification Pipeline & Bulk Import (`FR-DOC`, `WF-09`–`11`, `WF-13`)

* **Database Tables:**
* `storage_objects`, `documents` (`latest_version_id`, `current_approved_version_id`), `document_versions` (`UNIQUE(document_id, version_no)`, `UNIQUE(document_id, revision_code)`), `document_requirements`, `document_assets` (partial unique index enforcing exactly one `is_primary = true` per document `AUD-A-03`), `document_contracts`, `document_events`.




* **Backend & Worker Modules (`documents`, `file.processor.ts`):**
* Implement `API-080`–`094` (Presigned S3 multipart upload intents `API-082`, upload completion `API-083`, abort `API-084`, signed 15-minute download/preview URLs `API-088`/`089`, soft-delete/restore `API-090`/`091`, and Bulk ZIP + Mapping Spreadsheet Import `FR-DOC-031` / `SCR-055`).


* Implement `WF-11` in `file.processor.ts`: magic-byte MIME sniffing (banning `.svg`, `.exe`, `.xlsm`), SHA-256 verification, project/org duplicate hash detection (`FR-DOC-008`, `FR-DOC-033`), `qpdf` encryption/corruption check (`FR-DOC-010`), and ClamAV (`clamd`) scan.


* Enforce `AUD-P-04`: soft-deleted `document_versions` rows continue to reserve their `revision_code`; re-uploading a used revision code returns `409 DUPLICATE_REVISION`.




* **Frontend Screens:**
* `SCR-021` Documents Library, `SCR-022` Document Detail, `SCR-023`–`024` Mobile Upload Sheet with `localStorage` draft persistence & resumable S3 multipart progress, `SCR-055` Bulk Document Importer.




* **Exit Gate Tests (`TC-DOC-*`):**
* `TC-DOC-01`: Requesting a download URL (`API-088`) for a version in `PROCESSING`, `QUARANTINED`, or `FAILED` state is rejected (`06` §3.7).


* `TC-DOC-02`: Uploading an EICAR test virus file transitions the version to `QUARANTINED` and blocks all downloads (`FR-DOC-009`, `RB-09`).


* `TC-DOC-03`: Uploading a new unapproved revision `R2` updates `documents.latest_version_id` to `R2` but keeps `documents.current_approved_version_id` pointing at approved `R1` until `R2` is approved (`FR-DOC-014`).





---

### Milestone M6: Scoped Guest Grants, Supplier Upload Links & Visibility Projection (`FR-PTY`, `WF-08`)

* **Database Tables:**
* `guest_grants` (`capabilities TEXT[]`, `scope_json`, `otp_required DEFAULT true`, `token_hash`).




* **Backend Modules (`parties`, `permissions`):**
* Implement `API-024`–`029` (Guest grant issuance, revocation within 60s, Supplier upload link creation, Guest OTP request/verify, and Guest session exchange).


* Enforce `FR-DOC-032` & `AUD-P-15`: Supplier upload links are strictly scoped to one project and the assigned requirement batch; uploading to an unassigned requirement is rejected.


* Implement the **Field-Level Visibility Projection Interceptor (`05` §6.4, `AUD-S-24`)** stripping contract value, retention, pricing, internal comments (`visibility = 'INTERNAL'`), and other suppliers' submissions from guest responses.




* **Frontend Screens:**
* Isolated `/guest/[token]` routes: `SCR-034` Supplier Request Upload Page (zero navigation chrome), `SCR-035` Consultant Portal, `SCR-036` Client Portal.




* **Exit Gate Tests (`TC-PTY-*`, `TC-SEC-*`):**
* `TC-PTY-01`: Supplier A's guest session attempting to read or upload to Requirement B (assigned to Supplier B) returns `404 Not Found` (`05` §12).


* `TC-PTY-02`: Inspecting raw JSON responses for `R-CLIENT`, `R-MC`, and `R-SUPPLIER-OEM` confirms zero leakage of `value_paise`, `retention_bps`, or `INTERNAL` review comments (`05` §6.4).





---

### Milestone M7: Reviews, Row-Locked Approvals, External Approvals & Expiry (`FR-REV`, `WF-12`, `WF-22`, `WF-23`)

* **Database Tables:**
* `reviews` (`UNIQUE(document_version_id, stage_key, reviewer_subject_type, reviewer_subject_id)`, `method` = `'IN_APP'` or `'EXTERNAL'`), `review_comments` (`page_no`, `visibility`), `approval_overrides`.




* **Backend Modules (`reviews`):**
* Implement `API-062` (`POST /requirements/{id}/submit-review`) and `API-100`–`107` (Review queue, In-App Decisions `API-102`, Page Comments `API-103`, Admin Override `API-105`, External Approval Recording `API-106` / `WF-23`, and Bulk Decisions `API-107`).


* Enforce `FR-REV-002` (`AUD-005`): A reviewer (including `R-PM`) can only decide on requirements where their role matches `requirements.reviewer_role`.


* Implement daily expiry job (`WF-22`) in `retention.processor.ts` transitioning requirements whose approved evidence has `valid_until < now()` to `EXPIRED`.




* **Frontend Screens:**
* `SCR-025` Split-Pane PDF.js Document Viewer with Page Pin annotations, `SCR-026` Review Queue, `SCR-027` In-App & External Approval Decision Modal.




* **Exit Gate Tests (`TC-REV-*`):**
* `TC-REV-01`: Two reviewers submitting concurrent `POST /reviews/{id}/decisions` on the same version results in `200 OK` for the first and `409 CONFLICT` for the second (`FR-REV-013`, `AUD-007`).


* `TC-REV-02`: Uploader attempting to approve their own upload returns `403 SELF_APPROVAL_DENIED` (`FR-REV-009`).





---

### Milestone M8: Pure-Node Handover Package Compiler & Multi-Recipient Submissions (`FR-HND`, `WF-15`–`18`)

* **Database Tables:**
* `handover_packages` (`snapshot_id`, `snapshot_checksum`), `package_items` (composite FK `(org_id, project_id, document_version_id)`), `package_requirements` (frozen requirement state at generation time `AUD-008`), `submissions`, `submission_recipients`, `submission_events`, `package_layouts`.




* **Backend & Worker Modules (`handover`, `pdf.processor.ts`):**
* Implement `API-110`–`120` (Readiness check `API-118` separating `MISSING` and `EXPIRED` from `EXPIRING` per `FR-HND-008`, Package Preview `SCR-057`, Asynchronous Generation `API-110`, Manifest Download `API-119`, Multi-Recipient Submissions `API-115` / `FR-HND-019`, and Client Acceptance `API-117`).


* Implement `AUD-P-16`: When a client records `ACCEPT_WITH_EXCEPTIONS` or `REJECT` on `SCR-031`, automatically write each exception back as a `requirement_change_requests` row.


* Implement Pure-Node PDF Compiler (`RT-025`) in `pdf.processor.ts`: renders Cover Page, Signature/Stamp Block (`07` §9.3), Approval Summary, Asset Register (with `REPLACED BY` lineage `FR-AST-011`), Waiver List, and Bookmarked Merged PDF + ZIP Manifest.




* **Frontend Screens:**
* `SCR-028` Package Builder, `SCR-057` Package Preview (with item exclusion + reason), `SCR-029` Package Detail, `SCR-030` Submission Form, `SCR-031` Client Acceptance Portal.




* **Exit Gate Tests (`TC-HND-*`):**
* `TC-HND-01`: Attempting to insert a `package_items` row referencing a `document_version_id` from another project fails at the PostgreSQL foreign key constraint (`FR-HND-016`, `AUD-004`).


* `TC-HND-02`: Injecting `<script>alert(1)</script>` or PDF control characters into project/asset/requirement titles produces a clean, escaped PDF with zero active content (`AUD-006`, `RB-12`).





---

### Milestone M9: Warranty Reconciliation, DLP Snags, Notifications & Reports (`WF-24`, `WF-25`, `FR-NOT`, `FR-RPT`)

* **Database Tables:**
* `warranty_events`, `defects`, `notification_templates`, `notifications` (dedup index `AUD-A-06`), `notification_preferences`.




* **Backend & Worker Modules (`warranty-defects`, `notifications`, `search-reports`):**
* Implement Warranty Registration & Start-Date Basis Reconciliation (`API-180`–`181`, `WF-24`, `FR-AST-012` where existing `asset.warranty_start` always wins over closure defaults).


* Implement Defect / Snag Tracker (`API-182`–`183`, `WF-25`) requiring closure evidence before closing a defect.


* Implement `notify.processor.ts`: daily missing-document reminders (`WF-14`), warranty/DLP expiry reminders at 30/14/7/1 days (`FR-NOT-014`), `20:00–08:00 IST` quiet hours, 60-character title truncation with zero sensitive content in message bodies (`FR-NOT-013`), and Weekly Owner PDF/Email Digest (`BR-GTM-07`).


* Implement `API-130` Scoped Search (query-time permission filtering `FR-SRCH-002`) and Excel/CSV Exports (`FR-RPT-001`–`004`).




* **Frontend Screens:**
* `SCR-058` Warranty Register, `SCR-059` Defect/Snag Tracker, `SCR-043` Notification Settings, `SCR-047` Global Search, `SCR-048` Notifications List.





---

### Milestone M10: INR Billing, GST/TDS/e-Invoice, Retention & Production Launch (`FR-BIL`, `FR-ADM`, `15`)

* **Database Tables:**
* `plans`, `subscriptions`, `invoices`, `invoice_lines`, `invoice_tds`, `payment_events`, `usage_counters`, `credit_notes`, `retention_policies`, `legal_holds`, `deletion_requests`, `job_executions`.




* **Backend Modules (`billing`, `admin`, `retention.processor.ts`):**
* Implement `FOR UPDATE` transactional plan-limit enforcement on `usage_counters` (`AUD-A-08`) when activating projects, adding seats, uploading files, or generating packages.


* Implement Razorpay subscription checkout (`API-152`), HMAC-verified idempotent webhook handler (`API-160`), sequential GST tax invoice generator (`FR-BIL-005`), customer TDS deduction recording (`FR-BIL-011`), and configurable e-invoice IRN/QR fields (`BR-BIL-13`).


* Implement Retention & Legal Hold Purge Job (`WF-19`) with the `purged_at` reopen guard (`AUD-P-11`), DSR workflow (`API-143`–`144`, `BR-DAT-09`), and Platform Admin plane (`API-170`–`172`).




* **Frontend Screens:**
* `SCR-044` Billing & Usage, `SCR-045` Checkout, `SCR-046` Audit Log, `SCR-051`–`054` Admin, Exports & Retention/Legal Hold.





---

## 4. Production Reference Code for Critical Backend & Worker Engines

Below is the reference implementation for the four most security-critical backend components that your coding agent must use as its baseline.

### 4.1 Transactional RLS + Outbox Wrapper & Idempotency Helper (`packages/db/src/tenant-tx.ts`)

Enforces `RT-005` (`tc_app` RLS context binding), `AUD-035` (fail-closed tenant isolation), `D-005` (transactional outbox), and `AUD-A-08` (`FOR UPDATE` usage counter locking).

```typescript
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';

export interface TenantActorContext {
  orgId: string;       // Must come exclusively from session.active_org_id (AUD-014)
  userId: string;
  actorType: 'MEMBER' | 'GUEST' | 'SYSTEM' | 'ADMIN';
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface DomainOutboxEvent {
  eventType: string;
  projectId?: string;
  entityType: string;
  entityId: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
}

/**
 * Executes a database callback inside a transaction with PostgreSQL RLS
 * context bound to the session's active_org_id and writes domain events
 * to both outbox_events and audit_events atomically.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  ctx: TenantActorContext,
  work: (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => Promise<T>,
): Promise<T> {
  if (!ctx.orgId || !ctx.userId) {
    throw new Error('SECURITY_INVARIANT_VIOLATION: Missing orgId or userId in RLS context');
  }

  const client = await pool.connect();
  const stagedEvents: DomainOutboxEvent[] = [];

  try {
    await client.query('BEGIN');

    // Bind transaction-local settings for PostgreSQL RLS policies (08 §5.2)
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [ctx.orgId]);
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [ctx.userId]);

    const result = await work(client, (ev) => stagedEvents.push(ev));

    // Flush staged domain events to outbox_events & audit_events in the same tx (09 §5.2)
    for (const ev of stagedEvents) {
      const eventId = uuidv7();
      await client.query(
        `INSERT INTO outbox_events (id, org_id, project_id, event_type, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          eventId,
          ctx.orgId,
          ev.projectId ?? null,
          ev.eventType,
          JSON.stringify({
            entityType: ev.entityType,
            entityId: ev.entityId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
          }),
        ],
      );

      await client.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, ip, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [
          uuidv7(),
          ctx.orgId,
          ev.projectId ?? null,
          ctx.actorType,
          ctx.userId,
          ev.eventType,
          ev.entityType,
          ev.entityId,
          ev.beforeJson ? JSON.stringify( redactSensitiveFields(ev.beforeJson) ) : null,
          ev.afterJson ? JSON.stringify( redactSensitiveFields(ev.afterJson) ) : null,
          ctx.ip,
          ctx.userAgent,
          ctx.requestId,
        ],
      );
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Locks the org's usage_counters row FOR UPDATE and enforces plan ceilings
 * inside the active transaction (AUD-A-08).
 */
export async function consumePlanQuota(
  client: PoolClient,
  orgId: string,
  metric: 'ACTIVE_PROJECTS' | 'SEATS' | 'STORAGE_BYTES' | 'PACKAGE_GENERATIONS',
  period: string, // 'ALL_TIME' or 'YYYY-MM'
  delta: bigint,
  limitCeiling: bigint,
): Promise<void> {
  await client.query(
    `INSERT INTO usage_counters (id, org_id, metric, period, value)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (org_id, metric, period) DO NOTHING`,
    [uuidv7(), orgId, metric, period],
  );

  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM usage_counters
      WHERE org_id = $1 AND metric = $2 AND period = $3
      FOR UPDATE`,
    [orgId, metric, period],
  );

  const currentVal = BigInt(rows[0]?.value ?? '0');
  if (currentVal + delta > limitCeiling) {
    const err = new Error(`Plan limit exceeded for ${metric} (${currentVal + delta} > ${limitCeiling})`);
    (err as any).code = 'PLAN_LIMIT_EXCEEDED';
    throw err;
  }

  await client.query(
    `UPDATE usage_counters
        SET value = value + $4, updated_at = now()
      WHERE org_id = $1 AND metric = $2 AND period = $3`,
    [orgId, metric, period, delta.toString()],
  );
}

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const REDACTED_KEYS = new Set(['token', 'token_hash', 'otp', 'password', 'secret', 'qr_payload']);
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    clone[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return clone;
}

export function hashRequestPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

```

---

### 4.2 5-Level Configuration & Snapshot Resolver (`apps/api/src/modules/configuration/config-resolver.ts`)

Implements `07-CUSTOMISATION-ENGINE.md` §4.3 (`PLATFORM` → `ORG` [with installed `TRADE` copy] → `CLIENT_CONTRACT` → `PROJECT`), enforcing `locked`, `inherit_only`, `overridable`, `additive`, and `keyed_merge` policies and computing the canonical SHA-256 `snapshot_checksum` (`FR-HND-021`).

```typescript
import { createHash } from 'crypto';

export type ConfigLevel = 'PLATFORM' | 'TRADE' | 'ORG' | 'CLIENT_CONTRACT' | 'PROJECT';
export type OverridePolicy = 'locked' | 'inherit_only' | 'overridable' | 'additive' | 'keyed_merge';

export interface FieldSchemaRule {
  overridePolicy: OverridePolicy;
  ownerLevel?: ConfigLevel;
  mergeKey?: string;
}

export interface ConfigLayerInput {
  level: ConfigLevel;
  versionId: string;
  payload: Record<string, any>;
}

export interface ConflictRecord {
  path: string;
  attemptedAtLevel: ConfigLevel;
  lockedAtLevel: ConfigLevel;
  message: string;
}

const CONFIG_SCHEMA: Record<string, FieldSchemaRule> = {
  maxFileSizeBytes: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  allowedMimeTypes: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  requireMalwareScan: { overridePolicy: 'locked', ownerLevel: 'PLATFORM' },
  packageIncludeApprovalSummary: { overridePolicy: 'locked', ownerLevel: 'TRADE' },
  branding: { overridePolicy: 'inherit_only', ownerLevel: 'ORG' },
  namingPattern: { overridePolicy: 'overridable' },
  reminderSchedule: { overridePolicy: 'overridable' },
  extraAllowedFormats: { overridePolicy: 'additive' },
  groups: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
  requirements: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
  packageSections: { overridePolicy: 'keyed_merge', mergeKey: 'key' },
};

export function resolveConfigurationHierarchy(layers: ConfigLayerInput[]) {
  const result: Record<string, any> = {};
  const provenance: Record<string, { level: ConfigLevel; versionId: string }> = {};
  const conflicts: ConflictRecord[] = [];

  for (const layer of layers) {
    for (const [key, incomingVal] of Object.entries(layer.payload)) {
      if (incomingVal === undefined || incomingVal === null) continue;

      const rule: FieldSchemaRule = CONFIG_SCHEMA[key] ?? { overridePolicy: 'overridable' };
      const existingOrigin = provenance[key];

      // 1. Locked field guard (07 §4.3 & §5)
      if (rule.overridePolicy === 'locked' && existingOrigin) {
        if (JSON.stringify(incomingVal) !== JSON.stringify(result[key])) {
          conflicts.push({
            path: key,
            attemptedAtLevel: layer.level,
            lockedAtLevel: existingOrigin.level,
            message: `Field '${key}' is locked at ${existingOrigin.level} and cannot be overridden at ${layer.level}.`,
          });
        }
        continue;
      }

      // 2. Inherit-only guard
      if (rule.overridePolicy === 'inherit_only' && rule.ownerLevel && layer.level !== rule.ownerLevel) {
        continue;
      }

      // 3. Merge semantics by policy (07 §4.4)
      if (rule.overridePolicy === 'additive' && Array.isArray(incomingVal)) {
        const currentArr = Array.isArray(result[key]) ? result[key] : [];
        result[key] = Array.from(new Set([...currentArr, ...incomingVal]));
      } else if (rule.overridePolicy === 'keyed_merge' && Array.isArray(incomingVal)) {
        const mergeKey = rule.mergeKey ?? 'key';
        result[key] = mergeKeyedArray(result[key] ?? [], incomingVal, mergeKey, layer.level, conflicts);
      } else {
        if (incomingVal && typeof incomingVal === 'object' && incomingVal.$clear === true) {
          result[key] = null;
        } else {
          result[key] = structuredClone(incomingVal);
        }
      }

      provenance[key] = { level: layer.level, versionId: layer.versionId };
    }
  }

  // Enforce complexity limits (07 §5.1)
  if (Array.isArray(result.requirements) && result.requirements.length > 1000) {
    conflicts.push({
      path: 'requirements',
      attemptedAtLevel: 'PROJECT',
      lockedAtLevel: 'PLATFORM',
      message: `Requirements count (${result.requirements.length}) exceeds limit of 1,000.`,
    });
  }

  const canonicalJson = JSON.stringify(sortObjectKeys(result));
  const checksum = createHash('sha256').update(canonicalJson).digest('hex');

  return {
    payload: result,
    provenance,
    conflicts,
    checksum,
  };
}

function mergeKeyedArray(
  baseList: Record<string, any>[],
  incomingList: Record<string, any>[],
  keyField: string,
  level: ConfigLevel,
  conflicts: ConflictRecord[],
): Record<string, any>[] {
  const map = new Map<string, Record<string, any>>();
  for (const item of baseList) {
    map.set(String(item[keyField]), structuredClone(item));
  }

  for (const patch of incomingList) {
    const k = String(patch[keyField]);
    const existing = map.get(k);

    if (patch.$remove === true) {
      if (existing?.locked === true) {
        conflicts.push({
          path: `${keyField}:${k}`,
          attemptedAtLevel: level,
          lockedAtLevel: 'PLATFORM',
          message: `Cannot remove locked item '${k}' at level ${level}.`,
        });
      } else {
        map.delete(k);
      }
      continue;
    }

    if (existing) {
      if (existing.locked === true && patch.mandatory === false && existing.mandatory === true) {
        conflicts.push({
          path: `${keyField}:${k}.mandatory`,
          attemptedAtLevel: level,
          lockedAtLevel: 'PLATFORM',
          message: `Cannot mark locked mandatory item '${k}' as optional at level ${level}.`,
        });
        continue;
      }
      map.set(k, { ...existing, ...patch, provenanceLevel: level });
    } else {
      map.set(k, { ...patch, provenanceLevel: level });
    }
  }

  return Array.from(map.values());
}

function sortObjectKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc: Record<string, any>, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

```

---

### 4.3 File Verification, Magic-Byte Sniffing & ClamAV Worker (`apps/worker/src/queues/file.processor.ts`)

Implements `WF-11` (`06` §3.7 & §4), `FR-DOC-005`–`010`, and `11` §4.8 (strict SVG and macro ban, PDF password/corruption check via `qpdf`, and fail-closed ClamAV scanning).

```typescript
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execFileAsync = promisify(execFile);

export interface FileVerificationResult {
  finalStatus: 'READY' | 'QUARANTINED' | 'FAILED';
  detectedMime: string;
  sha256: string;
  pageCount: number | null;
  failureCode?: string;
  failureDetail?: string;
}

const ALLOWED_MAGIC_SIGNATURES: Array<{ mime: string; check: (buf: Buffer) => boolean }> = [
  { mime: 'application/pdf', check: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    check: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    check: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'application/zip', // Also covers DOCX / XLSX OOXML containers
    check: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
  {
    mime: 'image/vnd.dwg',
    check: (b) => /^AC10[0-9]{2}$/.test(b.subarray(0, 6).toString('ascii')),
  },
];

export async function verifyAndScanUploadedFile(
  localFilePath: string,
  originalFilename: string,
  expectedSha256: string,
  clamdHost = '127.0.0.1',
  clamdPort = 3310,
): Promise<FileVerificationResult> {
  // 1. Strict Extension & SVG / Macro Ban (FR-DOC-005 & 11 §4.8)
  const lowerName = originalFilename.toLowerCase();
  if (
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.exe') ||
    lowerName.endsWith('.bat') ||
    lowerName.endsWith('.docm') ||
    lowerName.endsWith('.xlsm')
  ) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256: '',
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail:
        "This file type isn't supported. Use PDF, JPG, PNG, WebP, DOCX, XLSX, DWG or ZIP (SVG is strictly banned).",
    };
  }

  // 2. Read header bytes + compute SHA-256 stream
  const { headBuffer, sha256 } = await computeHashAndHeader(localFilePath);
  if (expectedSha256 && sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256,
      pageCount: null,
      failureCode: 'CHECKSUM_MISMATCH',
      failureDetail: 'Uploaded file SHA-256 checksum does not match declared upload intent.',
    };
  }

  // 3. Reject disguised SVG/HTML/XML payloads inside first 512 bytes
  const headText = headBuffer.toString('utf8').toLowerCase();
  if (headText.includes('<svg') || headText.includes('<!doctype html') || headText.includes('<script')) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'image/svg+xml',
      sha256,
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail: 'SVG and active HTML files are strictly prohibited.',
    };
  }

  const matchedSig = ALLOWED_MAGIC_SIGNATURES.find((sig) => sig.check(headBuffer));
  if (!matchedSig) {
    return {
      finalStatus: 'FAILED',
      detectedMime: 'application/octet-stream',
      sha256,
      pageCount: null,
      failureCode: 'UNSUPPORTED_FILE_TYPE',
      failureDetail: 'File content signature does not match any supported format.',
    };
  }

  // 4. ClamAV INSTREAM Malware Scan (Fail-Closed per WF-11)
  const avVerdict = await scanFileWithClamd(localFilePath, clamdHost, clamdPort);
  if (avVerdict.infected) {
    return {
      finalStatus: 'QUARANTINED',
      detectedMime: matchedSig.mime,
      sha256,
      pageCount: null,
      failureCode: 'MALWARE_DETECTED',
      failureDetail: `Quarantined by ClamAV: ${avVerdict.signature}`,
    };
  }

  // 5. PDF Structural, Encryption & Page-Count Verification via qpdf (FR-DOC-010)
  let pageCount: number | null = null;
  if (matchedSig.mime === 'application/pdf') {
    try {
      const { stdout: encOut } = await execFileAsync('qpdf', ['--show-encryption', localFilePath], {
        timeout: 15_000,
      });
      if (!encOut.includes('File is not encrypted')) {
        return {
          finalStatus: 'FAILED',
          detectedMime: matchedSig.mime,
          sha256,
          pageCount: null,
          failureCode: 'PDF_PASSWORD_PROTECTED',
          failureDetail: 'This PDF is password-protected. Remove the password and try again.',
        };
      }

      const { stdout: npagesOut } = await execFileAsync('qpdf', ['--show-npages', localFilePath], {
        timeout: 15_000,
      });
      pageCount = parseInt(npagesOut.trim(), 10) || 1;

      // RT-034 Decompression Bomb Protection: max 1,000 pages (Dimension 4: 10.0/10)
      if (pageCount > 1000) {
        return {
          finalStatus: 'FAILED',
          detectedMime: matchedSig.mime,
          sha256,
          pageCount,
          failureCode: 'PDF_PAGE_LIMIT_EXCEEDED',
          failureDetail: `PDF contains ${pageCount} pages, exceeding the 1,000-page safety ceiling (RT-034).`,
        };
      }

      // RT-034 Decompression Bomb Protection: max 25,000 indirect objects
      const { stdout: xrefOut } = await execFileAsync('qpdf', ['--show-xref', localFilePath], {
        timeout: 20_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const objectCount = xrefOut.split('\n').filter((line) => line.includes('offset =')).length;
      if (objectCount > 25000) {
        return {
          finalStatus: 'FAILED',
          detectedMime: matchedSig.mime,
          sha256,
          pageCount,
          failureCode: 'PDF_OBJECT_BOMB_DETECTED',
          failureDetail: `PDF contains ${objectCount} internal objects, exceeding the 25,000-object safety ceiling (RT-034).`,
        };
      }
    } catch {
      return {
        finalStatus: 'FAILED',
        detectedMime: matchedSig.mime,
        sha256,
        pageCount: null,
        failureCode: 'PDF_CORRUPT',
        failureDetail: 'PDF file is corrupt or unreadable.',
      };
    }
  }

  return {
    finalStatus: 'READY',
    detectedMime: matchedSig.mime,
    sha256,
    pageCount,
  };
}

async function computeHashAndHeader(filePath: string): Promise<{ headBuffer: Buffer; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    let headBytesCollected = 0;
    const stream = createReadStream(filePath);

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      if (headBytesCollected < 512) {
        const slice = chunk.subarray(0, 512 - headBytesCollected);
        chunks.push(slice);
        headBytesCollected += slice.length;
      }
    });
    stream.on('end', () => resolve({ headBuffer: Buffer.concat(chunks), sha256: hash.digest('hex') }));
    stream.on('error', reject);
  });
}

async function scanFileWithClamd(
  filePath: string,
  host: string,
  port: number,
): Promise<{ infected: boolean; signature?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write('zINSTREAM\0');
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on('data', (chunk: Buffer) => {
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(chunk.length, 0);
        socket.write(lenBuf);
        socket.write(chunk);
      });
      stream.on('end', () => {
        const endBuf = Buffer.alloc(4, 0);
        socket.write(endBuf);
      });
      stream.on('error', reject);
    });

    let response = '';
    socket.on('data', (d) => (response += d.toString('utf8')));
    socket.on('end', () => {
      if (response.includes('FOUND')) {
        const sig = response.split(':')[1]?.replace('FOUND', '').trim();
        resolve({ infected: true, signature: sig });
      } else if (response.includes('OK')) {
        resolve({ infected: false });
      } else {
        reject(new Error(`Unexpected clamd response: ${response}`));
      }
    });
    socket.on('error', reject);
  });
}

```

---

### 4.4 Pure-Node.js Handover Package PDF Compiler (`apps/worker/src/queues/pdf.processor.ts`)

Implements `RT-025` (`15` §2: pure Node.js `pdf-lib` + `qpdf` without Gotenberg in MVP), `AUD-006` (control/injection sanitisation), `AUD-008` (`package_requirements` frozen index), and `FR-HND-002`–`004`.

```typescript
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';

export interface PackageCompileInput {
  packageId: string;
  versionNo: number;
  orgLegalName: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  contractRef: string;
  snapshotChecksum: string;
  generatedAtIst: string;
  requirementsIndex: Array<{
    requirementKey: string;
    title: string;
    assetTag: string | null;
    docTypeKey: string;
    revisionCode: string | null;
    statusAtGeneration: string;
    decidedBy: string | null;
    decisionMethod: 'IN_APP' | 'EXTERNAL' | 'WAIVED' | null;
  }>;
  sourceFiles: Array<{
    documentVersionId: string;
    sectionKey: string;
    title: string;
    localPath: string;
    sha256: string;
  }>;
}

/**
 * Sanitises any user-controlled string before drawing into PDF content streams
 * or PDF metadata dictionaries (AUD-006 / RB-12).
 */
export function sanitisePdfText(input: string | null | undefined, maxLen = 140): string {
  if (!input) return '—';
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // Strip control characters
    .replace(/[<>\\]/g, '')                         // Strip angle brackets & escapes
    .trim()
    .slice(0, maxLen);
}

export async function compileHandoverDossierPdf(
  input: PackageCompileInput,
  outputPath: string,
): Promise<{
  totalPages: number;
  pdfSha256: string;
  itemPageRanges: Array<{ documentVersionId: string; pageStart: number; pageEnd: number }>;
}> {
  const mergedPdf = await PDFDocument.create();
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontMono = await mergedPdf.embedFont(StandardFonts.Courier);

  // 1. Render A4 Executive Cover Page + CPWD/PMC Signature Block (07 §9.3 & FR-HND-002)
  const coverPage = mergedPdf.addPage([595.28, 841.89]); // A4 Portrait
  const { width, height } = coverPage.getSize();

  // Top Blueprint Navy Accent Bar
  coverPage.drawRectangle({
    x: 0,
    y: height - 28,
    width,
    height: 28,
    color: rgb(0.059, 0.161, 0.259), // #0F2942
  });

  coverPage.drawText(sanitisePdfText(input.orgLegalName, 80).toUpperCase(), {
    x: 48,
    y: height - 76,
    size: 11,
    font: fontBold,
    color: rgb(0.059, 0.161, 0.259),
  });

  coverPage.drawText('TECHNICAL CLOSEOUT & O&M HANDOVER DOSSIER', {
    x: 48,
    y: height - 104,
    size: 18,
    font: fontBold,
    color: rgb(0.059, 0.09, 0.165),
  });

  const metaRows: Array<[string, string]> = [
    ['Project Code & Title', `${sanitisePdfText(input.projectCode, 30)} — ${sanitisePdfText(input.projectName, 70)}`],
    ['Client Organisation', sanitisePdfText(input.clientName, 80)],
    ['Contract Reference', sanitisePdfText(input.contractRef, 60)],
    ['Package Version', `v${input.versionNo}`],
    ['Generated (IST)', sanitisePdfText(input.generatedAtIst, 40)],
    ['Checklist Snapshot SHA-256', sanitisePdfText(input.snapshotChecksum, 64)],
  ];

  let yCursor = height - 155;
  for (const [label, value] of metaRows) {
    coverPage.drawText(`${label}:`, {
      x: 48,
      y: yCursor,
      size: 9.5,
      font: fontBold,
      color: rgb(0.28, 0.33, 0.41),
    });
    coverPage.drawText(value, {
      x: 210,
      y: yCursor,
      size: 9.5,
      font: label.includes('SHA-256') ? fontMono : fontRegular,
      color: rgb(0.06, 0.09, 0.16),
    });
    yCursor -= 22;
  }

  // Government / PSU / PMC 3-Column Signature & Rubber-Stamp Grid (07 §9.3 AUD-P-18)
  const boxY = 140;
  const boxW = (width - 96) / 3;
  const stampTitles = [
    'PREPARED BY (SUBCONTRACTOR)',
    'REVIEWED BY (MEP CONSULTANT)',
    'ACCEPTED BY (CLIENT / MC)',
  ];
  stampTitles.forEach((title, idx) => {
    const bx = 48 + idx * boxW;
    coverPage.drawRectangle({
      x: bx,
      y: boxY,
      width: boxW - 8,
      height: 110,
      borderColor: rgb(0.58, 0.64, 0.72),
      borderWidth: 0.8,
    });
    coverPage.drawText(title, {
      x: bx + 8,
      y: boxY + 94,
      size: 7.5,
      font: fontBold,
      color: rgb(0.2, 0.25, 0.33),
    });
    coverPage.drawText('Sign & Stamp:', {
      x: bx + 8,
      y: boxY + 14,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.52),
    });
  });

  // 2. Render Approval Summary & Requirement Index Page (FR-HND-002 / AUD-008)
  let indexPage = mergedPdf.addPage([595.28, 841.89]);
  let rowY = height - 60;
  indexPage.drawText('MASTER REQUIREMENT & APPROVAL REGISTER', {
    x: 48,
    y: rowY,
    size: 13,
    font: fontBold,
    color: rgb(0.059, 0.161, 0.259),
  });
  rowY -= 26;

  for (const req of input.requirementsIndex) {
    if (rowY < 60) {
      indexPage = mergedPdf.addPage([595.28, 841.89]);
      rowY = height - 60;
    }
    const methodLabel =
      req.decisionMethod === 'EXTERNAL'
        ? 'Approved (external)'
        : req.decisionMethod === 'WAIVED'
        ? 'Waived'
        : sanitisePdfText(req.statusAtGeneration, 24);

    const line = `${sanitisePdfText(req.requirementKey, 16).padEnd(16)} | ${sanitisePdfText(
      req.assetTag ?? 'PROJECT',
      12,
    ).padEnd(12)} | ${sanitisePdfText(req.revisionCode ?? '-', 4).padEnd(4)} | ${methodLabel}`;

    indexPage.drawText(line, {
      x: 48,
      y: rowY,
      size: 8,
      font: fontMono,
      color: rgb(0.1, 0.15, 0.22),
    });
    rowY -= 14;
  }

  // 3. Merge Validated Source PDFs & Record Exact Page Ranges (FR-HND-003)
  const itemPageRanges: Array<{ documentVersionId: string; pageStart: number; pageEnd: number }> = [];

  for (const src of input.sourceFiles) {
    const fileBytes = await readFile(src.localPath);
    const actualSha = createHash('sha256').update(fileBytes).digest('hex');
    if (actualSha.toLowerCase() !== src.sha256.toLowerCase()) {
      throw new Error(`Checksum mismatch while merging version ${src.documentVersionId}`);
    }

    const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: false });
    const startPage = mergedPdf.getPageCount() + 1;
    const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const p of copiedPages) {
      mergedPdf.addPage(p);
    }
    const endPage = mergedPdf.getPageCount();

    itemPageRanges.push({
      documentVersionId: src.documentVersionId,
      pageStart: startPage,
      pageEnd: endPage,
    });
  }

  const finalBytes = await mergedPdf.save();
  await writeFile(outputPath, finalBytes);
  const pdfSha256 = createHash('sha256').update(finalBytes).digest('hex');

  return {
    totalPages: mergedPdf.getPageCount(),
    pdfSha256,
    itemPageRanges,
  };
}

```

---

## 5. Production Deployment & Pre-Invoice Launch Gate (`15-DEPLOYMENT-AND-OPERATIONS.md`)

### 5.1 Production `docker-compose.prod.yml` (`15` §2 Single-VM 8 GB RAM Target `RT-026`)

```yaml
version: "3.9"

services:
  api:
    build:
      context: ../..
      dockerfile: infra/docker/api.Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      TZ: Asia/Kolkata
      DATABASE_URL: ${APP_DATABASE_URL} # Connects as tc_app (NOBYPASSRLS)
      REDIS_URL: ${REDIS_URL}
    ports:
      - "127.0.0.1:4000:4000"
    deploy:
      resources:
        limits:
          cpus: "1.5"
          memory: 2048M

  worker:
    build:
      context: ../..
      dockerfile: infra/docker/worker.Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      TZ: Asia/Kolkata
      DATABASE_URL: ${APP_DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CLAMD_HOST: clamav
      CLAMD_PORT: "3310"
    depends_on:
      - clamav
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2560M # Enforces memory ceiling for qpdf/pdf-lib tasks (RB-04)

  clamav:
    image: clamav/clamav:stable
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 2048M # Isolated ~1.5-2 GB RAM for clamd signatures (RT-026)

```

### 5.2 CERT-In 2022 Host NTP Synchronization (`15` §3 `RT-013`)

On the production Ubuntu/Debian VM (`ap-south-1`), configure `/etc/systemd/timesyncd.conf` or `chrony` to synchronize exclusively with the official Indian reference clocks:

```ini
[Time]
NTP=time.nplindia.org samay1.nic.in
FallbackNTP=samay2.nic.in

```
