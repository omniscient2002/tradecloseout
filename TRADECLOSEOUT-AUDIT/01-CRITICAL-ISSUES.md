# DELIVERABLE 2 — `TRADECLOSEOUT-AUDIT/01-CRITICAL-ISSUES.md`
<a id="deliverable-2--01-critical-issuesmd"></a>

Every `CRITICAL` and `HIGH` finding is documented below with all 9 mandatory audit attributes.

---

## RT-001 — Bulk Document Import (`FR-DOC-031`) Has No API Endpoint or Payload Specification ("Ghost Fix")

1. **Unique Issue ID:** `RT-001`
2. **Severity:** **CRITICAL**
3. **Exact Affected Document & Section:** `10-API-AND-INTEGRATIONS.md` §5 & §7.7; `03-PRODUCT-REQUIREMENTS.md` §9 (`FR-DOC-031`) & §19; `TRADECLOSEOUT-AUDIT/01-CRITICAL-ISSUES.md` (`AUD-009`)
4. **What is Wrong or Missing:** The v0.2 audit claims `AUD-009` was fixed by adding `API-095 POST /projects/{id}/documents/bulk-import` to `10` §7. In reality, `10` §7.7 ends at `API-094` (`POST /documents/bulk-download`). There is no `API-095` anywhere in `10-API-AND-INTEGRATIONS.md`. Nor is there any specification of how a 240-file ZIP + Excel mapping is uploaded (presigned multipart intent vs direct POST), how the dry-run preview (`SCR-055`) is requested, or how the mapping JSON/XLSX schema is structured. Additionally, `03` §9 has duplicate copy-pasted rows for `FR-DOC-029` and `FR-DOC-030` at the end of the table.
5. **Concrete Example:** A frontend developer building `SCR-055` (Bulk Document Import) looks at `10-API-AND-INTEGRATIONS.md` §7.7 to wire up the ZIP upload and dry-run preview. No endpoint exists. The developer must invent the URL, request schema, dry-run state machine, and job polling contract from scratch.
6. **Why It Matters:** Every real HVAC project onboarding mid-flight has 100–300 existing files. Without a specified API contract for bulk import, the feature cannot be built or contract-tested (`D-032`).
7. **Recommended Correction:**
   - Remove the duplicate `FR-DOC-029` and `FR-DOC-030` rows at the bottom of `03` §9.
   - Add `API-095` (`POST /projects/{id}/documents/bulk-import-intents` — creates presigned S3 upload for ZIP + CSV/XLSX), `API-096` (`POST /bulk-imports/{id}/dry-run` — parses manifest, matches `asset_tag` and `requirement_key`, returns per-file validation preview), and `API-097` (`POST /bulk-imports/{id}/commit` — enqueues extraction and version creation job) to `10` §7.7.
   - Add `bulk_import_jobs` table to `08` §3.5.
8. **Related Artefacts Affected:** `FR-DOC-031`, `API-095`–`097`, `SCR-055`, `TC-PTY-008`, `E-BULK_IMPORT_JOB`.
9. **External Evidence Available:** Internal specification verification (proven by inspecting `FILE 12` §7.7).

---

## RT-002 — Multi-Organisation Session Switching (`POST /auth/switch-org`) Missing from API Catalogue ("Ghost Fix")

1. **Unique Issue ID:** `RT-002`
2. **Severity:** **CRITICAL**
3. **Exact Affected Document & Section:** `10-API-AND-INTEGRATIONS.md` §2.1, §3 & §7.1; `05-ACTORS-AND-PERMISSIONS.md` §8; `DECISIONS-AND-OPEN-QUESTIONS.md` `D-034`
4. **What is Wrong or Missing:** `D-034` and `10` §3 mandate that `session.active_org_id` is the sole authoritative tenant, that `/orgs/{orgId}` paths must match `session.active_org_id` or return `404`, and that switching organisations is performed via `POST /auth/switch-org` and listed via `GET /auth/orgs`. However, `10` §7.1 (`API-001` to `API-008`) **omits both `GET /auth/orgs` and `POST /auth/switch-org`**. Worse, `WF-01` (New User Onboarding) creates a `User` via `POST /auth/otp/verify` **before** the user has created an `Organisation` (`POST /orgs`), yet `08` §3.1 defines `sessions.active_org_id NOT NULL`!
5. **Concrete Example:**
   - **Case A (New Signup):** A new user verifies their phone via `API-002` (`POST /auth/otp/verify`). They do not belong to any organisation yet (they are about to call `API-010 POST /orgs`). Because `sessions.active_org_id` is `NOT NULL` (`08` §3.1), the `INSERT INTO sessions` crashes with a PostgreSQL `NOT NULL` constraint violation!
   - **Case B (Multi-Org User):** An auditor belonging to Org A and Org B logs in and clicks the Org Switcher (`SCR-005`). Neither `GET /auth/orgs` nor `POST /auth/switch-org` is defined in the API catalogue or idempotency rules.
6. **Why It Matters:** New users cannot sign up (`NOT NULL` crash on `active_org_id`), and multi-org users cannot switch tenants.
7. **Recommended Correction:**
   - In `08` §3.1, change `sessions.active_org_id` to **nullable** (`UUID REFERENCES organisations(id)`), allowing pre-onboarding sessions where `active_org_id IS NULL` (permitted only to call `POST /orgs`, `GET /auth/me`, `GET /auth/orgs`, and `POST /invitations/{token}/accept`).
   - In `10` §7.1, add `API-009A GET /auth/orgs` (lists active memberships and guest grants) and `API-009B POST /auth/switch-org` (body: `{ "orgId": "uuid" }`, rotates CSRF/session state, sets `sessions.active_org_id`, returns `200 OK` with new org context).
8. **Related Artefacts Affected:** `FR-IAM-001`, `FR-ORG-001`, `E-SESSION`, `API-002`, `API-009A`, `API-009B`, `SCR-005`, `TC-IAM-001`.
9. **External Evidence Available:** Internal logical and relational constraint proof.

---

## RT-003 — Invalid PostgreSQL DDL in `08-DATA-MODEL-AND-ERD.md` Will Fail Migration Execution

1. **Unique Issue ID:** `RT-003`
2. **Severity:** **CRITICAL**
3. **Exact Affected Document & Section:** `08-DATA-MODEL-AND-ERD.md` §3.1, §5.1, §5.4, §5.5
4. **What is Wrong or Missing:** The DDL patterns in `08` §5 contain four fatal SQL errors introduced during the v0.2 remediation:
   1. **Non-existent column in `organisations` (`§3.1`):** Specifies `UNIQUE(org_id, id)` on `organisations`, whose primary key is `id` and which has no `org_id` column.
   2. **Non-existent column in `projects` (`§5.1`):** `ALTER TABLE projects ADD CONSTRAINT projects_org_proj_id_key UNIQUE (org_id, project_id, id);` — `projects` has `id` and `org_id`, **not** `project_id`.
   3. **Circular self-referencing foreign key on `documents` (`§5.1`):** Inside `CREATE TABLE documents (...)`, line 21 declares `FOREIGN KEY (org_id, project_id, id) REFERENCES documents(org_id, project_id, id)` **before** the unique constraint `documents_org_proj_id_key` is added! PostgreSQL rejects a foreign key referencing columns that do not yet have a `UNIQUE` constraint, and a row referencing its own `(org_id, project_id, id)` is a useless tautology.
   4. **Cross-project asset link in `requirements` (`§5.4`):** `requirements.scope_key` is a free-text string (`'project'` or `'asset:{asset_id}'`). Because `asset_id` is embedded inside a string (`'asset:0192...'`), PostgreSQL **cannot enforce a foreign key** to `assets(org_id, project_id, id)`, violating Invariant #18 (`08` §8: *"the referenced asset belongs to the same project"*) and preventing `ON DELETE RESTRICT` when an asset is deleted.
5. **Concrete Example:** Running the SQL in `08` §5.1 on PostgreSQL 16 immediately throws:
   `ERROR: there is no unique constraint matching given keys for referenced table "documents"` and `ERROR: column "project_id" named in key does not exist`.
6. **Why It Matters:** The database schema is the foundation of M0–M4. Invalid DDL and string-encoded foreign keys (`'asset:{uuid}'`) break referential integrity.
7. **Recommended Correction:**
   - Remove `UNIQUE(org_id, id)` from `organisations`, remove `UNIQUE(org_id, project_id, id)` from `projects`, and remove the self-FK from `documents`.
   - In `requirements` (`08` §3.3 & §5.4), add an explicit nullable column `asset_id UUID` alongside `scope_key`:
     - `FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id)`
     - `CHECK ((asset_id IS NULL AND scope_key = 'project') OR (asset_id IS NOT NULL AND scope_key = 'asset:' || asset_id::text))`
     This preserves the deterministic `UNIQUE(project_id, requirement_key, scope_key)` index while giving PostgreSQL a true composite foreign key to `assets`!
8. **Related Artefacts Affected:** `E-ORGANISATION`, `E-PROJECT`, `E-DOCUMENT`, `E-REQUIREMENT`, `E-ASSET`, `TC-AST-002`.
9. **External Evidence Available:** Official PostgreSQL 16 Documentation (Foreign Key Constraints & Unique Indexes).

---

## RT-004 — Unresolved Contradiction on Permission Model ("Explicit Deny Wins" vs "Positive-Only")

1. **Unique Issue ID:** `RT-004`
2. **Severity:** **CRITICAL**
3. **Exact Affected Document & Section:** `03-PRODUCT-REQUIREMENTS.md` `FR-IAM-018`; `05-ACTORS-AND-PERMISSIONS.md` §3.2; `12-EDGE-CASES-AND-FAILURE-MODES.md` `EC-USR-13`; `14-TESTING-AND-ACCEPTANCE.md` `TC-IAM-004`; `DECISIONS-AND-OPEN-QUESTIONS.md` `D-039`
4. **What is Wrong or Missing:** `D-039` and `05` §3.2 state: *"Model: positive-only with narrowing scopes. There is no explicit deny list."* However:
   - `03-PRODUCT-REQUIREMENTS.md` `FR-IAM-018` (Priority M / MVP) still states: *"A member's effective permissions are the union of org role and project role, **minus explicit denies; denies win**."*
   - `12-EDGE-CASES-AND-FAILURE-MODES.md` `EC-USR-13` still states: *"Union of allows **minus denies; explicit deny wins**; denial reason shown."*
   - `14-TESTING-AND-ACCEPTANCE.md` `TC-IAM-004` still requires testing: ***"Deny overrides allow"***.
   Furthermore, in `05` §3.2, Rule 2 says *"Where two grants apply, the narrower scope wins (project grant beats org grant)"*, whereas the formula right above it uses set union (`org_role_permissions ∪ project_role_permissions`)! In set theory, the union $A \cup B$ **widens** access to the superset, whereas intersection $A \cap B$ narrows it. If an Org Admin (`project.read = A`) is added to Project X with a scoped role, does union apply (they keep org-wide access) or does "narrower scope wins" strip their org-wide access?
5. **Concrete Example:** A QA engineer writes `TC-IAM-004` per `14` §3 ("Deny overrides allow") and `FR-IAM-018`. The test fails because no deny table exists in `08`. Meanwhile, a backend developer implements "narrower scope wins" per `05` §3.2, causing an Org Admin who joins a project as a Reviewer to lose their Admin permissions on that project!
6. **Why It Matters:** Access control ambiguity leads directly to privilege escalation or broken admin workflows.
7. **Recommended Correction:**
   - Update `FR-IAM-018` in `03`, `EC-USR-13` in `12`, and `TC-IAM-004` in `14` to remove all references to "explicit denies".
   - Fix the formula and rule in `05` §3.2 to be mathematically unambiguous:
     - **Capabilities** are additive across a user's roles (`org_role_caps ∪ project_role_caps ∪ guest_caps`).
     - **Resource Scope** for a specific project grant (`project_members.scope_json` or `guest_grants.scope_json`) filters the resources to which *that specific grant's capabilities* apply. An Org Owner/Admin's org-wide grant (`A`) is never narrowed by a project membership.
     - **Approval Authority** on a requirement is gated by `reviewer_role_matches(user, requirement)`.
8. **Related Artefacts Affected:** `FR-IAM-018`, `05` §3.2, `EC-USR-13`, `TC-IAM-004`, `D-039`.
9. **External Evidence Available:** Internal cross-document contradiction.

---

## RT-005 — PostgreSQL Row-Level Security (RLS) Silently Bypassed by Table Owner / Migration Role

1. **Unique Issue ID:** `RT-005`
2. **Severity:** **CRITICAL**
3. **Exact Affected Document & Section:** `08-DATA-MODEL-AND-ERD.md` §5.2; `13-SECURITY-PRIVACY-AND-COMPLIANCE.md` §5.1; `15-DEPLOYMENT-AND-OPERATIONS.md` §5
4. **What is Wrong or Missing:** `08` §5.2 defines `ALTER TABLE documents ENABLE ROW LEVEL SECURITY; CREATE POLICY documents_tenant_isolation ...`. In PostgreSQL, **table owners and superusers bypass RLS by default** unless `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is executed, or the application connects via a separate, non-owner, `NOBYPASSRLS` database role. Because `09` §6.1 and `15` §2 use a single managed PostgreSQL database where the app runs migrations and queries, connecting as the default database owner role means **RLS policies in `08` §5.2 will never be evaluated at runtime**, and `TC-TENANT-10` (*"RLS direct query without `app.current_org` returns zero rows"*) will fail!
5. **Concrete Example:** The developer runs Drizzle migrations as `postgres` (or `tradecloseout_admin`), which owns all tables. The NestJS API connects using the same `DATABASE_URL`. A bug in a query omits `WHERE org_id = $1`. PostgreSQL sees that the current user is the table owner, **skips the RLS policy completely**, and returns every tenant's rows.
6. **Why It Matters:** RLS is the primary defence-in-depth control against cross-tenant data breaches (`RK-006`). Without `FORCE ROW LEVEL SECURITY` and role separation, RLS is completely inactive.
7. **Recommended Correction:**
   - In `08` §5.2 and `15` §5, mandate **two distinct PostgreSQL roles**:
     1. `tc_migrator` (table owner, used only in CI/CD migration steps).
     2. `tc_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, used by NestJS API and BullMQ workers).
   - Add `ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;` to the DDL template in `08` §5.2 for all tenant tables.
8. **Related Artefacts Affected:** `NFR-SEC-001`, `08` §5.2, `13` §5.1, `14` §11, `15` §5.
9. **External Evidence Available:** Official PostgreSQL 16 Documentation, Section 5.8 (*Row Security Policies*: "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system... Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.").

---

## RT-006 — Gotenberg Local File Inclusion (LFI) and SSRF via Container Filesystem & CSS/SVG Attributes

1. **Unique Issue ID:** `RT-006`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `09-SYSTEM-ARCHITECTURE.md` §5.3; `13-SECURITY-PRIVACY-AND-COMPLIANCE.md` §8.2; `03-PRODUCT-REQUIREMENTS.md` `FR-ORG-007`
4. **What is Wrong or Missing:**
   - First, `09` §5.3 and `13` §8.2 state that Gotenberg runs with *"no outbound network"* to prevent SSRF, and that user strings are HTML-escaped. However, **Local File Inclusion (LFI)** inside Gotenberg does not require outbound network access (`file:///etc/passwd`, `file:///proc/self/environ`, or temporary files of concurrent jobs in `/tmp`).
   - Second, `WF-02` (`06` §4) allows an organisation to upload an **SVG logo** (`"logo ≤2 MB (PNG/JPEG/SVG sanitised)"`), which is rendered onto every generated package cover page (`FR-ORG-007`). Rendering an SVG inside Headless Chromium (Gotenberg) allows `<image xlink:href="file:///...">`, `<foreignObject>`, and CSS `@import` LFI/SSRF unless SVG is rasterised to PNG before reaching Gotenberg.
   - Third, `09` §5.3 says *"no shared temp paths"* in `12` `EC-TECH-12`, but `09` §3 runs a single Gotenberg container handling concurrent requests from the worker.
5. **Concrete Example:** A malicious user uploads an SVG company logo containing `<svg><foreignObject><iframe src="file:///proc/self/cmdline"></iframe></foreignObject></svg>` or a crafted CSS style. When Gotenberg renders the handover package cover page via Chromium, it embeds internal container process data into the generated PDF.
6. **Why It Matters:** Allows reading internal container memory, environment variables, or concurrent tenant PDFs inside the Gotenberg container.
7. **Recommended Correction:**
   - **Ban SVG logos entirely** in `WF-02` (`06` §4): accept only `PNG`, `JPEG`, or `WebP`, and re-encode server-side via `sharp`/`libvips` to a clean PNG before storing.
   - Configure Gotenberg with `--chromium-deny-list=^file:///.*` (allowing only the specific request temp directory or inline `data:image/png;base64,...` assets) and `--chromium-disable-javascript=true`.
   - Set worker PDF concurrency to `1` per Gotenberg instance in MVP (`15` §2).
8. **Related Artefacts Affected:** `FR-ORG-007`, `WF-02`, `09` §5.3, `13` §8.2, `14` §15b.
9. **External Evidence Available:** Official Gotenberg 8 Documentation (`--chromium-deny-list`, `--chromium-disable-javascript`).

---

## RT-007 — Multi-Recipient Submission State Machine Deadlock (`submissions` vs `submission_recipients`)

1. **Unique Issue ID:** `RT-007`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `06-WORKFLOWS-AND-STATE-MACHINES.md` §3.11, §3.12, `WF-17`, `WF-18`; `08-DATA-MODEL-AND-ERD.md` §3.7; `10-API-AND-INTEGRATIONS.md` `API-117`
4. **What is Wrong or Missing:** In v0.2, `submission_recipients` was added (`08` §3.7, `FR-HND-019`) so a handover package can be sent to the **Client**, **Main Contractor**, and **Consultant** simultaneously, with each recording their own decision (`status`, `decision`, `decided_at`). **However, the state machines (`06` §3.11 & §3.12) and `API-117` (`POST /submissions/{id}/decision`) were not updated to aggregate multiple recipients!**
   - What is `submissions.status` and `handover_packages.status` when the **Consultant** clicks `ACCEPT` (`submission_recipients.decision = 'ACCEPTED'`), the **Main Contractor** clicks `REJECT` (`decision = 'REJECTED'`), and the **Client** has not responded (`status = 'SENT'`)?
   - `WF-18` (Project Closure) requires `Submission ACCEPTED` as its precondition. Does closure require **all** recipients to accept, or only the `CLIENT` recipient, or any one recipient?
   - `API-117` (`POST /submissions/{id}/decision`) does not even take a `recipientId` or derive it unambiguously when an internal PM records an external acceptance on behalf of one of the three parties!
5. **Concrete Example:** A PM creates a submission for Package v1 with two recipients: Main Contractor (`MC`) and Consultant (`CONSULTANT`). The Consultant logs in via guest link and clicks **Accept**. If `API-117` immediately transitions `submissions.status → ACCEPTED` and `handover_packages.status → ACCEPTED`, the Main Contractor can no longer reject it (`409 INVALID_STATE_TRANSITION` because `ACCEPTED` is terminal in `06` §3.12)! Conversely, if it waits for all recipients, and one recipient is informational (`CC`), the package is stuck in `SUBMITTED` forever.
6. **Why It Matters:** Multi-party handover acceptance is the core final workflow of the product (`WF-17`/`WF-18`). A developer cannot implement `API-117` without an aggregation rule.
7. **Recommended Correction:**
   - Add `is_required_approver BOOLEAN NOT NULL DEFAULT true` to `submission_recipients` (`08` §3.7).
   - Define the deterministic aggregation rule in `06` §3.12:
     - If **any** required recipient decides `REJECTED` → `submissions.status = 'REJECTED'` and `handover_packages.status = 'REJECTED'`.
     - If **all** required recipients decide `ACCEPTED` (or `ACCEPTED_WITH_EXCEPTIONS`) → `submissions.status = 'ACCEPTED'` and `handover_packages.status = 'ACCEPTED'`.
     - While some required recipients have decided `ACCEPTED` and others are still pending → `submissions.status = 'PARTIALLY_ACCEPTED'` (add this state to `06` §3.12).
   - Change `API-117` to `POST /submissions/{id}/recipients/{recipientId}/decision` (or infer `recipientId` from the guest grant when called by a guest).
8. **Related Artefacts Affected:** `FR-HND-011`, `FR-HND-019`, `06` §3.11–3.12, `WF-17`, `WF-18`, `E-SUBMISSION`, `E-SUBMISSION_RECIPIENT`, `API-117`, `TC-HND-005`.
9. **External Evidence Available:** Internal state-machine verification.

---

## RT-008 — Missing Indian MEP Commercial Handover Artifacts (RA Bill / Final Bill Linkage, JMR, & As-Built Drawing Register)

1. **Unique Issue ID:** `RT-008`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `00-PRODUCT-VISION.md` §6; `03-PRODUCT-REQUIREMENTS.md` §6 (`FR-CNT-001`); `04-DOCUMENT-CATALOGUE.md` §3 (`DT-085`); `08-DATA-MODEL-AND-ERD.md` §3.2
4. **What is Wrong or Missing:**
   - **Payment Milestone / RA Bill Linkage Missing:** `00` §6 promises *"1. Never lose retention to a missing document. A live gap register tied to payment milestones."* And `FR-CNT-001` says *"A Contract records: ... payment milestones"*. Yet **`08-DATA-MODEL-AND-ERD.md` has no `payment_milestones` table or column on `contracts` or `requirements`!** In Indian HVAC contracting, payments are released in stages: e.g., 60% against delivery (`MIR` + `MTC` + `PO`), 20% against installation (`Installation Checklist` + `Hydro/Duct Test`), 10% against commissioning (`TAB` + `Commissioning Report`), 5% against Handover (`O&M` + `As-Built` + `Completion Certificate`), and 5% Retention after DLP (`No Defect Certificate`). Because `requirements` cannot be tagged to a payment milestone (e.g., `RA_BILL_3`, `PRE_COMMISSIONING`, `FINAL_BILL`, `DLP_RELEASE`), the system cannot tell a contractor what is blocking their next Running Account (RA) bill vs what is needed at final handover!
   - **Measurement Book (MB) / Joint Measurement Record (JMR):** On Indian government (CPWD/PWD) and private item-rate contracts, the **Final Bill cannot be submitted without approved Joint Measurement Sheets (`DT-085`) matched to BOQ items**. Marking `DT-085` as a single project-level "optional/conditional" document with no system/zone/BOQ-section breakdown makes it useless for real billing closeout.
5. **Concrete Example:** An HVAC contractor is trying to release their 10% Commissioning payment milestone (`RA Bill #6`) on a ₹15 Crore project. They open TradeCloseout, which shows "42 of 120 project documents missing"—mixing final DLP certificates with commissioning reports. They cannot filter by "What blocks the Commissioning Milestone?".
6. **Why It Matters:** Tying documentation to payment stages is the core commercial value proposition of the entire product (`00` §3 & §6).
7. **Recommended Correction:**
   - Add `milestone_key TEXT NOT NULL DEFAULT 'HANDOVER' CHECK (milestone_key IN ('MOBILISATION','SUBMISSION','DELIVERY','INSTALLATION','COMMISSIONING','HANDOVER','FINAL_BILL','DLP_END'))` to `requirements` (`08` §3.3).
   - Add `milestone_key` filter to `GET /requirements` (`API-058`), `SCR-013` (Project Overview), and `SCR-014` (Checklist).
   - Allow `DT-085` (Joint Measurement Record) to be instantiated per zone/system or bill number.
8. **Related Artefacts Affected:** `FR-CNT-001`, `FR-CHK-002`, `FR-NOT-002`, `E-REQUIREMENT`, `SCR-013`, `SCR-014`.
9. **External Evidence Available:** Verified against CPWD Works Manual 2022/2024 and standard Indian item-rate HVAC subcontract payment terms.

---

## RT-009 — Uploading an Already-Expired Certificate Leaves Requirement Stuck in `UPLOADED` and Blocks Review Submission

1. **Unique Issue ID:** `RT-009`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `06-WORKFLOWS-AND-STATE-MACHINES.md` §3.6, `WF-09`, `WF-22`; `12-EDGE-CASES-AND-FAILURE-MODES.md` `EC-DOC-12`
4. **What is Wrong or Missing:** Look at the interaction between `WF-09` (Upload), `EC-DOC-12` (Expired certificate uploaded), and `06` §3.6 (Requirement state machine):
   - In `WF-09` Step 6: *"Validations: ... expiry > issue date."* It does **not** validate `expiry_date >= current_date` at upload intent, or if it allows upload per `EC-DOC-12` (*"Accepted but flagged; requirement cannot be approved if validity already ended"*):
   - In `06` §3.6, `EXPIRED` can **only** be entered from `APPROVED` (`APPROVED --> EXPIRED: validity lapses`). There is no transition `UPLOADED --> EXPIRED` or `IN_REVIEW --> EXPIRED`.
   - Furthermore, when `WF-22` (Daily validity job) transitions a requirement `APPROVED → EXPIRED`, `06` `WF-22` says *"the version stays `APPROVED` historically"*, while `08` §5.3 says `documents.current_approved_version_id` is the version that satisfies linked requirements! If `current_approved_version_id` is still non-null and `review_status = 'APPROVED'`, any query checking `current_approved_version_id` thinks the document is valid, while `requirements.status` says `EXPIRED`!
5. **Concrete Example:** A QC engineer uploads a gauge calibration certificate (`DT-025`) whose `expiry_date` was last month. Per `WF-09`, the requirement moves to `UPLOADED`. The engineer submits it for review; the reviewer tries to click Approve, gets blocked by `EC-DOC-12`, and has to reject it manually instead of the system flagging `EXPIRED` on upload. Later, another calibration certificate expires after approval; `requirements.status` becomes `EXPIRED`, but `package_items` still pulls `documents.current_approved_version_id` as an "Approved" document without marking its version status or clearing active satisfaction.
6. **Why It Matters:** Causes state inconsistency between `requirements.status`, `document_versions.review_status`, and package readiness checks.
7. **Recommended Correction:**
   - In `WF-11` (Automated verification), if `expiry_date < CURRENT_DATE`, set `checks_json.expired_on_upload = true` and **block `submit-review` (`API-062`) with `422 DOCUMENT_ALREADY_EXPIRED`** unless the user uploads a current certificate or requests a waiver.
   - In `WF-22` (Daily expiry job), when `document_versions.expiry_date < CURRENT_DATE` on a `current_approved_version_id`, set `requirements.status = 'EXPIRED'` and ensure `API-118` (Readiness) and `WF-16` (Package Builder) check `requirements.status = 'APPROVED' AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)`.
8. **Related Artefacts Affected:** `FR-DOC-016`, `FR-HND-008`, `06` §3.6, `WF-09`, `WF-11`, `WF-22`, `EC-DOC-12`.
9. **External Evidence Available:** Internal state-machine verification.

---

## RT-010 — Duplicate API Endpoint Identifiers (`API-030` and `API-120`) in `10-API-AND-INTEGRATIONS.md`

1. **Unique Issue ID:** `RT-010`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `10-API-AND-INTEGRATIONS.md` §7.3, §7.4, §7.9, §7.10; `README.md` §0 Rule 6
4. **What is Wrong or Missing:** `README.md` Rule 6 requires unique, consistent IDs across all artefacts. In `10-API-AND-INTEGRATIONS.md`:
   - `API-030` is assigned to `POST /guest/{token}/otp/verify` in §7.3 **AND** `API-030` is assigned to `GET /projects` in §7.4.
   - `API-120` is assigned to `GET /packages/{id}/preview` in §7.9 **AND** `API-120` is assigned to `GET /notifications` in §7.10.
5. **Concrete Example:** A test traceability matrix or OpenAPI generator mapping `API-030` and `API-120` overwrites `GET /projects` with guest OTP verification, and `GET /notifications` with package preview.
6. **Why It Matters:** Breaks automated contract-test generation (`D-032`) and requirement-to-API traceability (`03` §19).
7. **Recommended Correction:**
   - Renumber `POST /guest/{token}/otp/request` to `API-028A` and `POST /guest/{token}/otp/verify` to `API-028B` (keeping `API-030` exclusively for `GET /projects`).
   - Renumber `GET /packages/{id}/manifest` to `API-118A` and `GET /packages/{id}/preview` to `API-118B` (keeping `API-120` exclusively for `GET /notifications`).
8. **Related Artefacts Affected:** `10` §7.3, §7.4, §7.9, §7.10; `03` §19; `14` §6.
9. **External Evidence Available:** Internal inspection of `FILE 12`.

---

## RT-011 — Soft-Deleted `document_versions` Permanently Block Re-Uploading the Same Revision Code (`409 DUPLICATE_REVISION` Trap)

1. **Unique Issue ID:** `RT-011`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `08-DATA-MODEL-AND-ERD.md` §3.5; `06-WORKFLOWS-AND-STATE-MACHINES.md` `WF-13`; `12-EDGE-CASES-AND-FAILURE-MODES.md` `EC-DOC-15` & `EC-DOC-25`
4. **What is Wrong or Missing:** In v0.2, `06` `WF-13` and `08` §3.5 added the rule: *"Revision code unique per document and reserved by soft-deleted rows (`AUD-P-04`): re-uploading a used code returns `409 DUPLICATE_REVISION` until the row is purged."* Meanwhile, `08` §7 says: *"Document version: Never deleted while current; revision code reserved; Purge: With document."*
   Think about what happens in real life (`EC-DOC-15`):
   - A site engineer is asked to upload **Revision `R0`** of the Chiller Shop Drawing (which is stamped `R0` on the physical drawing).
   - They accidentally select the wrong PDF from their phone and upload it as `R0`.
   - Before or during review, they realise they picked the wrong file and click "Withdraw / Delete unapproved version" (`EC-DOC-15`), or theupload fails (`file_status = 'FAILED'`).
   - Now they try to upload the **actual** `R0` PDF. **The system rejects it with `409 DUPLICATE_REVISION` because `R0` is permanently reserved by the failed/withdrawn row!** They cannot call it `R1` because the consultant's drawing stamp literally says `R0`!
5. **Concrete Example:** Any failed upload (`FAILED`), aborted multipart upload (`PENDING_UPLOAD` → aborted), or withdrawn unapproved upload permanently burns that `revision_code` (`R0`, `R1`, `Rev A`) for the life of the project (8+ years!).
6. **Why It Matters:** This makes everyday error recovery impossible for site engineers and document controllers. Only **approved** (or externally submitted/reviewed) revisions should reserve a revision code for audit history; failed, aborted, or withdrawn *unreviewed* uploads must not burn the revision code.
7. **Recommended Correction:**
   - Change the unique index on `document_versions` (`08` §3.5) to a partial unique index:
     ```sql
     CREATE UNIQUE INDEX document_versions_rev_code_uq
       ON document_versions (document_id, upper(revision_code))
       WHERE deleted_at IS NULL
         AND file_status NOT IN ('FAILED', 'QUARANTINED')
         AND review_status <> 'WITHDRAWN';
     ```
   - Allow an uploader to withdraw an **unapproved, unreviewed** version (`review_status = 'NOT_SUBMITTED'`) or replace a `FAILED` upload using the same `revision_code`, while preserving the audit event `VERSION_WITHDRAWN`. Once a version has entered `IN_REVIEW` and received a decision (`APPROVED`, `CHANGES_REQUESTED`, `REJECTED`), its `revision_code` is permanently locked.
8. **Related Artefacts Affected:** `FR-DOC-014`, `06` `WF-13`, `08` §3.5, `12` `EC-DOC-15`/`EC-DOC-25`.
9. **External Evidence Available:** Domain workflow verification.

---

## RT-012 — Resumable Multipart Upload (`FR-DOC-004`) Lacks Part-Listing and URL-Refresh APIs

1. **Unique Issue ID:** `RT-012`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `10-API-AND-INTEGRATIONS.md` §7.7, §8.1, §9; `06-WORKFLOWS-AND-STATE-MACHINES.md` `WF-09`; `12-EDGE-CASES-AND-FAILURE-MODES.md` `EC-TECH-01`
4. **What is Wrong or Missing:** `FR-DOC-004` and `WF-09` state: *"Resumable/multipart upload is supported for files >10 MB and recovers from network interruption... expired URL → re-issue"*, and `EC-TECH-01` says *"Multipart parts retained until expiry (24h); user resumes"*. However:
   - `10` §8.1 shows that `POST /projects/{id}/documents/upload-intents` returns presigned part URLs that expire in **15–60 minutes** (`expiresAt`).
   - Look at `10` §7.7 (`API-080` to `API-094`): there is `API-082` (`upload-intents`), `API-083` (`complete`), and `API-084` (`abort`). **There is NO endpoint to query which parts succeeded or to refresh expired presigned part URLs for an existing `versionId`!**
5. **Concrete Example:** A site engineer on patchy 4G starts uploading an 80 MB O&M manual (8 parts of 10 MB). Parts 1–5 succeed; then power/4G drops for 90 minutes. When they reconnect, the presigned URLs from `API-082` have expired. Because there is no `GET /document-versions/{id}/upload-status` or `POST /document-versions/{id}/upload-urls` endpoint, the client cannot resume from Part 6 and must re-upload all 80 MB from scratch.
6. **Why It Matters:** Resumable mobile upload over weak 4G is a core product principle (`00` §7 Principle 8, `FR-DOC-004`). Without a URL-refresh/status endpoint, multipart upload is not resumable across token expiry or page reloads.
7. **Recommended Correction:**
   - Add `API-082A POST /document-versions/{id}/refresh-upload-urls` to `10` §7.7: calls S3 `ListParts` for the active `uploadId`, returns already-uploaded `[ { partNumber, etag, sizeBytes } ]`, and issues fresh 15-minute presigned PUT URLs for the remaining parts.
   - Store `s3_upload_id TEXT` on `storage_objects` (`08` §3.5) while `status = 'PENDING'`.
8. **Related Artefacts Affected:** `FR-DOC-004`, `WF-09`, `E-STORAGE_OBJECT`, `API-082A`, `SCR-024`, `EC-TECH-01`, `TC-DOC-002`.
9. **External Evidence Available:** AWS S3 Multipart Upload specification (`CreateMultipartUpload`, `ListParts`, `UploadPart`, `CompleteMultipartUpload`).

---

## RT-013 — Statutory Non-Compliance: `BR-SLA-04` (72-Hour Breach Notice) Violates CERT-In 6-Hour Mandate

1. **Unique Issue ID:** `RT-013`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `02-BUSINESS-REQUIREMENTS.md` `BR-SLA-04` & `BR-REG-07`; `13-SECURITY-PRIVACY-AND-COMPLIANCE.md` §2.1 & §16.3; `15-DEPLOYMENT-AND-OPERATIONS.md` §8; `SOURCES-VERIFICATION.md` `SRC-022`
4. **What is Wrong or Missing:**
   - Under the **CERT-In Directions of 28 April 2022** (issued under Section 70B(6) of the IT Act, 2000), all body corporates and service providers must report specified cyber security incidents to CERT-In **within 6 hours** of noticing or being brought to notice, sync ICT system clocks to **NIC (`samay1.nic.in`, `samay2.nic.in`) or NPL (`time.nplindia.org`)** NTP servers, and retain ICT logs for 180 days **within Indian jurisdiction**.
   - In contrast, `02` `BR-SLA-04` states: *"Within 72 hours of confirmation"*; `12` `EC-TECH-15` merely says *"Sync NTP"* without specifying NIC/NPL servers; and `13` §18 leaves the regions for Sentry (Error tracking) and Observability (Logs/metrics) as *"Verify"*, which risks shipping ICT logs outside India in violation of CERT-In Direction (iv).
5. **Concrete Example:** TradeCloseout suffers an unauthorised cross-tenant access incident at 09:00 IST. Following `BR-SLA-04` (72 hours), the founder waits 2 days before reporting. Under Section 70B(7) of the IT Act, failure to report to CERT-In within 6 hours is a statutory offence, and enterprise/PSU customers will fail vendor security audits if NIC/NPL NTP and Indian log residency are not specified.
6. **Why It Matters:** Direct statutory compliance gap under Indian cyber law (`SRC-022`).
7. **Recommended Correction:**
   - Update `BR-SLA-04` in `02` and `13` §16.3 to distinguish:
     1. **CERT-In initial incident report:** **Within 6 hours** of detection for reportable cyber incidents (with supplemental details provided within a reasonable time).
     2. **DPDP Act / Customer breach intimation:** Without undue delay upon confirmation, and detailed report to the Data Protection Board of India (DPBI) **within 72 hours** (per DPDP Rules 2025 Rule 7).
   - In `15` §3 and `12` `EC-TECH-15`, require chrony/NTP configuration pointing to `samay1.nic.in`, `samay2.nic.in`, and `time.nplindia.org`.
   - In `13` §18, mandate that security and ICT logs (`security_events` and host/container logs) are stored **within Indian jurisdiction** (`ap-south-1`).
8. **Related Artefacts Affected:** `BR-SLA-04`, `BR-REG-07`, `12` `EC-TECH-15`, `13` §2.1, §16.3, §18, `SOURCES-VERIFICATION.md` `SRC-022`.
9. **External Evidence Available:** **Verified** against CERT-In Directions No. 20(3)/2022-CERT-In dated 28 April 2022 and DPDP Rules 2025 (notified 13 Nov 2025).

---

## RT-014 — Unauthenticated Guest OTP Endpoint (`API-029`) Enables SMS Pumping / DoS & Link Lockout

1. **Unique Issue ID:** `RT-014`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `10-API-AND-INTEGRATIONS.md` §2.3, §7.3 (`API-029`, `API-030`), §10; `05-ACTORS-AND-PERMISSIONS.md` §6.2; `08-DATA-MODEL-AND-ERD.md` §3.1 (`guest_grants`)
4. **What is Wrong or Missing:**
   - In v0.2, `Q-004` was resolved by setting `guest_grants.otp_required = true` by default (`05` §6.2).
   - However, look at `08` §3.1 (`guest_grants`): `guest_grants` links to `party_id`, which has a single `parties.phone` or `party_contacts`. It does **not** record which specific phone/email the link is bound to on `guest_grants`, nor is there a table or column tracking guest OTP attempts/lockouts!
   - Worse, in `10` §10 (Rate limits), public guest endpoints are allowed **60 requests/min/token and 20/hour/IP**, while `API-029` (`POST /guest/{token}/otp/request`) has no per-grant or per-org daily SMS cap! If a supplier shares a link in a WhatsApp group, or an attacker hits `POST /guest/{token}/otp/request`, they can trigger 20 SMS messages/hour per IP, draining the org's/platform's SMS balance, or enter 5 wrong OTPs (`10` §2.1) and permanently lock the legitimate supplier out of the link!
5. **Concrete Example:** A supplier upload link is posted in a 15-person project WhatsApp group (standard Indian site practice). Three different clerks click the link on their phones. Clerk A triggers an OTP to the supplier owner's phone; Clerk B enters a wrong code 5 times; the link is now locked, or SMS retries exhaust the DLT quota.
6. **Why It Matters:** High risk of both financial abuse (SMS pumping) and operational lockout for unsophisticated suppliers.
7. **Recommended Correction:**
   - Add `target_email CITEXT` and `target_phone_e164 TEXT` explicitly to `guest_grants` (`08` §3.1) so each link is bound to a specific recipient contact.
   - Cap `POST /guest/{token}/otp/request` to **3 SMS sends per hour per `grant_id`** (and 10 per day per `grant_id`), with automatic fallback to email OTP if `target_email` is present.
   - After 5 failed OTP verifications, apply a **15-minute cooldown** on the grant rather than permanent revocation, so a clerk's typo does not permanently kill the link.
8. **Related Artefacts Affected:** `FR-IAM-010`, `05` §6.2, `08` §3.1, `10` §2.3, §7.3, §10.
9. **External Evidence Available:** OWASP Automated Threat Handbook (OAT-004 / SMS Pumping).

---

## RT-015 — E-Invoicing (`FR-BIL-005`) Is Mandated in MVP Despite Statutory ₹5 Crore Turnover Exemption

1. **Unique Issue ID:** `RT-015`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `02-BUSINESS-REQUIREMENTS.md` `BR-BIL-13`; `03-PRODUCT-REQUIREMENTS.md` `FR-BIL-005` (Pri: M, Phase: MVP); `16-MVP-AND-IMPLEMENTATION-ROADMAP.md` §3.1 M9 & §9b; `17-BUSINESS-VALIDATION-PLAN.md` §6
4. **What is Wrong or Missing:** Because the previous AI agent did not verify Indian GST law (`AUD-013`), it panicked and added **GSP/ASP e-invoicing integration (IRN + signed QR code)** into the **MVP scope** (`FR-BIL-005` = M/MVP, `16` M9, and ₹1,000–3,000/month GSP fees in `17` §6).
   **External Verification Proof:** Under CBIC Notification No. 10/2023–Central Tax, e-invoicing applies **only if the supplier's (TradeCloseout's) aggregate annual turnover exceeds ₹5 Crore** in any financial year since 2017–18. TradeCloseout's target in Year 1 is 10–50 customers (`BO-01`: ~₹12–60 Lakh ARR). A newly incorporated Indian SaaS entity with <₹5 Crore turnover **cannot and need not issue e-invoices** (indeed, the IRP portal only enables e-invoicing for GSTINs crossing the threshold or opting in). A standard Rule 46 GST tax invoice (with supplier GSTIN, buyer GSTIN, SAC `998315`, place of supply, and CGST/SGST or IGST breakdown) is 100% legally valid for B2B buyers to claim Input Tax Credit (ITC) via GSTR-1/GSTR-2B!
5. **Concrete Example:** The solo developer spends 1–2 weeks in Milestone M9 integrating a GSP API (ClearTax/MasterIndia) and applying for IRP credentials, only to discover that NIC's e-invoice portal rejects their new GSTIN because their turnover is under ₹5 Crore.
6. **Why It Matters:** Saves 1–2 weeks of solo-developer effort and ₹36,000/year in fixed GSP fees during MVP while remaining 100% GST-compliant.
7. **Recommended Correction:**
   - Move GSP/IRP e-invoicing integration in `FR-BIL-005` from `M / MVP` to `C / V2 (when annual turnover approaches ₹5 Crore)`. Keep the nullable `irn` and `qr_payload` columns in `invoices` (`08` §3.10) for future-proofing, and include a standard declaration on B2B invoices: *"E-invoicing under Rule 48(4) of CGST Rules is not applicable as aggregate annual turnover is below the notified threshold of ₹5 Crore."*
   - Update `SOURCES-VERIFICATION.md` `SRC-007`, `SRC-008`, `SRC-033` to `VERIFIED`.
8. **Related Artefacts Affected:** `BR-BIL-13`, `FR-BIL-005`, `16` M9 & §9b, `17` §6, `SOURCES-VERIFICATION.md` `SRC-008`.
9. **External Evidence Available:** **Verified** — CBIC Notification No. 10/2023–Central Tax (effective 1 Aug 2023, ₹5 Cr threshold in force in 2026) and CGST Rule 46 / Rule 48(4).

---

## RT-016 — Broken Traceability Matrix in `03-PRODUCT-REQUIREMENTS.md` §19 (Points to Non-Existent Screens `SCR-090`–`094` and Wrong APIs)

1. **Unique Issue ID:** `RT-016`
2. **Severity:** **HIGH**
3. **Exact Affected Document & Section:** `03-PRODUCT-REQUIREMENTS.md` §19; `10-API-AND-INTEGRATIONS.md` §7; `11-UI-UX-SPECIFICATION.md` §3
4. **What is Wrong or Missing:** `03` §19 explicitly states: *"**Note:** the API and screen ranges above are the authoritative ranges and supersede earlier drafts."* Yet the table in `03` §19 is riddled with broken pointers:
   1. **Row `WTY/DEF`:** Lists APIs `API-130`–`135`. In `10` §7.10, `API-130` is `GET /search`! The actual Warranty/Defect endpoints in `10` §7.11 are `API-180`–`185`.
   2. **Row `WTY/DEF`:** Lists Requirements Area `WTY/DEF` and Tests `TC-WTY-*`, **neither of which exists in `03` (`§1.1` area codes) or `14` (`Testing`)**!
   3. **Row `BIL`:** Lists Screens `SCR-044`–`045`, **`SCR-090`–`094`**. In `11-UI-UX-SPECIFICATION.md` §3, screen numbers end at `SCR-059`! `SCR-090`–`094` are completely fabricated.
   4. **Row `IAM`:** Lists Screens `SCR-010`–`016`, `SCR-040`–`041`. In `11` §3, `SCR-010`–`016` are Home Dashboard, Projects List, Create Project, Project Overview, and Checklists—not IAM!
   5. **Row `PRJ/CNT`:** Lists Screens `SCR-011`–`013`, `SCR-020`–`028`. In `11` §3, `SCR-020`–`028` are Asset Import, Documents Library, Upload Sheet, Document Viewer, Review Queue, and Package Builder—not Projects/Contracts!
5. **Concrete Example:** A developer following the "authoritative" traceability table in `03` §19 looks for `SCR-090`–`094` to build billing screens and `API-130`–`135` to build warranty endpoints, finding nothing.
6. **Why It Matters:** `03` is the highest-authority behavioural document (`README.md` §3). Declaring a broken table "authoritative" corrupts the entire specification's cross-references.
7. **Recommended Correction:** Replace the table in `03` §19 with the exact, verified API, Screen, and Test ranges matching `10` §7, `11` §3, and `14` §3–9 (exact replacement table provided in `07-RECOMMENDED-CHANGES.md`).
8. **Related Artefacts Affected:** `03` §19, `10` §7, `11` §3, `14` §2.
9. **External Evidence Available:** Internal cross-document audit.

---
---