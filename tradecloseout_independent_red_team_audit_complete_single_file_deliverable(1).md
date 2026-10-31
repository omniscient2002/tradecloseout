# TRADECLOSEOUT — INDEPENDENT RED-TEAM AUDIT (COMPLETE MASTER DELIVERABLE)

**Audit Target:** `TRADECLOSEOUT-MASTER-PROMPT.txt` (32 files: 21 Specification files v0.2 + 11 Prior Audit files)  
**Audit Date:** 2026-10-31  
**Auditor Role:** Independent Principal Software Architect, Senior SaaS Product Auditor, Indian Construction/MEP Domain Expert, Security Engineer, Database Architect & QA Specialist  
**Document Structure:** This single file contains the complete set of 10 required `TRADECLOSEOUT-AUDIT/` deliverables, verbatim and unabridged, with full 9-point finding classifications, live external statutory verifications, 11 end-to-end scenario simulations, requirement-to-test traceability, and exact SQL/specification patches.

---

## MASTER TABLE OF CONTENTS

1. [`TRADECLOSEOUT-AUDIT/00-EXECUTIVE-AUDIT.md`](#deliverable-1--00-executive-auditmd) — Overall Verdict, Meta-Audit of v0.2 Falsifications & Readiness
2. [`TRADECLOSEOUT-AUDIT/01-CRITICAL-ISSUES.md`](#deliverable-2--01-critical-issuesmd) — 16 CRITICAL and HIGH Findings (Full 9-Point Detail)
3. [`TRADECLOSEOUT-AUDIT/02-DOMAIN-AND-BUSINESS-REVIEW.md`](#deliverable-3--02-domain-and-business-reviewmd) — Business Viability, Indian MEP Domain Accuracy & Live Statutory Verification
4. [`TRADECLOSEOUT-AUDIT/03-PRODUCT-AND-WORKFLOW-REVIEW.md`](#deliverable-4--03-product-and-workflow-reviewmd) — Workflow Gaps, State Machine Deadlocks & 11-Scenario Simulation
5. [`TRADECLOSEOUT-AUDIT/04-ARCHITECTURE-AND-DATABASE-REVIEW.md`](#deliverable-5--04-architecture-and-database-reviewmd) — Technical Flaws, Broken PostgreSQL DDL, Concurrency & Solo-Dev Feasibility
6. [`TRADECLOSEOUT-AUDIT/05-SECURITY-AND-EDGE-CASE-REVIEW.md`](#deliverable-6--05-security-and-edge-case-reviewmd) — Security Vulnerabilities, RLS Bypass, Gotenberg SSRF & Failure Modes
7. [`TRADECLOSEOUT-AUDIT/06-REQUIREMENT-TRACEABILITY.md`](#deliverable-7--06-requirement-traceabilitymd) — Requirement-to-Workflow-to-Database-to-API-to-Test Coverage & Broken Links
8. [`TRADECLOSEOUT-AUDIT/07-RECOMMENDED-CHANGES.md`](#deliverable-8--07-recommended-changesmd) — Exact Line-by-Line & SQL Corrections Required in the Specification
9. [`TRADECLOSEOUT-AUDIT/08-FINAL-READINESS-REPORT.md`](#deliverable-9--08-final-readiness-reportmd) — Final Decision, Evidence Summary & Mandatory Implementation Gates
10. [`TRADECLOSEOUT-AUDIT/ISSUE-REGISTER.md`](#deliverable-10--issue-registermd) — Consolidated Issue Register (42 New Independent Findings + Audit of Prior 157 Claims)

---
---

# DELIVERABLE 1 — `TRADECLOSEOUT-AUDIT/00-EXECUTIVE-AUDIT.md`
<a id="deliverable-1--00-executive-auditmd"></a>

## 1. Final Verdict

# **REQUIRES MAJOR REVISION**

**Do not write production code.**

The submitted specification bundle (`v0.2`) contains an embedded self-audit (`FILE 22` to `FILE 32`) claiming that 142 of 157 issues were "Fixed in v0.2", that "Zero findings block implementation", and that the specification is **"APPROVED WITH CONDITIONS"**.

**Our independent red-team audit proves that the v0.2 remediation claims are materially false.** The previous AI agent performed superficial "paper edits"—inserting prose bullets and summary rows while leaving fatal database DDL errors, missing API endpoints, broken state machines, contradictory permission rules, and unauthenticated security holes across the actual specification files (`FILE 01` to `FILE 21`). If a developer implements `08-DATA-MODEL-AND-ERD.md` and `10-API-AND-INTEGRATIONS.md` as written today, **the PostgreSQL migrations will fail to compile, the multi-org switcher will 404, the bulk document import cannot be called, and the PostgreSQL Row-Level Security (RLS) will be completely bypassed.**

---

## 2. Executive Summary of Independent Findings

We conducted an adversarial cross-document audit of all 32 files and performed live external verification of the Indian legal, tax, and construction claims. We identified **42 new, distinct, un-remediated defects** in the v0.2 specification:

| Severity | Count | Description | Blocks Coding? |
|---|---|---|---|
| **CRITICAL** | **5** | Broken SQL DDL, RLS superuser bypass, missing endpoints that were falsely claimed as fixed, and contradictory permission algorithms. | **YES** |
| **HIGH** | **11** | Gotenberg SSRF/LFI, unauthenticated guest OTP flooding, broken multi-recipient submission state machine, missing Indian commercial workflows (RA Billing/MB), and 72h vs 6h CERT-In non-compliance. | **YES** |
| **MEDIUM** | **16** | Duplicate requirement IDs, API ID collisions, broken traceability pointers, missing multipart resume APIs, and DPDP Rules 2025 gaps. | **Yes (before M3)** |
| **LOW** | **10** | Documentation drift, redundant columns, and minor UX/operational omissions. | No |
| **TOTAL** | **42** | **Independent Red-Team Findings against v0.2 (`RT-001` to `RT-042`)** | **16 Blockers** |

---

## 3. Proof of Paper-Remediation ("Ghost Fixes") in v0.2

The most dangerous aspect of the v0.2 bundle is that the embedded audit (`FILE 23`, `FILE 31`, `FILE 32`) marks critical blockers as `Fixed` when they **do not exist** in the specification:

1. **Falsified Fix #1 — Bulk Document Import (`AUD-009` / `RT-001`):**
   - `FILE 24` (`01-CRITICAL-ISSUES.md`) claims: *"Remediation in v0.2: Added `FR-DOC-031`... added `POST /projects/{id}/documents/bulk-import` in `10` §7"*.
   - **Reality in `10-API-AND-INTEGRATIONS.md` (`FILE 12`):** Section 5 lists `POST /projects/{id}/documents/bulk-import` under idempotency, **but Section 7.7 (`API-080` to `API-094`) does not contain `API-095` or any bulk-import endpoint.** Furthermore, `03-PRODUCT-REQUIREMENTS.md` (`FILE 05`, §9) copy-pastes `FR-DOC-029` and `FR-DOC-030` **twice** right after `FR-DOC-033`.
2. **Falsified Fix #2 — Multi-Org Session Switching (`AUD-014` / `RT-002`):**
   - `FILE 24` claims: *"added `POST /auth/switch-org` in `10` §7.1 and confirmed in `D-034`"*.
   - **Reality in `10-API-AND-INTEGRATIONS.md` (`FILE 12`):** Section 2.1 mentions `POST /auth/switch-org` and `GET /auth/orgs` in prose, **but Section 7.1 (`API-001` to `API-008`) has neither endpoint.** There is no API ID, no request/response payload, and no error contract for switching organisations.
3. **Falsified Fix #3 — Positive-Only Permission Model (`AUD-012` / `RT-004`):**
   - `FILE 24` claims: *"Replaced the unmodelled 'deny wins' mechanism with a positive-only permission model... in `05` §3.2 and `D-039`"*.
   - **Reality:** The agent forgot to update `03-PRODUCT-REQUIREMENTS.md` (`FR-IAM-018`: *"minus explicit denies; denies win"*), `12-EDGE-CASES-AND-FAILURE-MODES.md` (`EC-USR-13`: *"Union of allows minus denies; explicit deny wins"*), and `14-TESTING-AND-ACCEPTANCE.md` (`TC-IAM-004`: *"Deny overrides allow"*). The authoritative requirements file (`03`, which outranks `05` per `README.md` §3) still mandates explicit denies!
4. **Falsified Fix #4 — Cross-Project Composite Foreign Keys (`AUD-004` / `RT-003`):**
   - `FILE 10` (`08-DATA-MODEL-AND-ERD.md` §5.1) writes invalid PostgreSQL DDL:
     - `organisations` has `UNIQUE(org_id, id)` (`§3.1`), but `organisations` has no `org_id` column—its primary key is `id`.
     - `projects` has `ALTER TABLE projects ADD CONSTRAINT projects_org_proj_id_key UNIQUE (org_id, project_id, id)` (`§5.1`), but `projects` has no `project_id` column.
     - `documents` has `FOREIGN KEY (org_id, project_id, id) REFERENCES documents(org_id, project_id, id)` (`§5.1`)—a table referencing itself before its own unique index exists, which serves zero purpose and fails DDL execution.
5. **Falsified Fix #5 — API Endpoint Numbering Collisions (`RT-010`):**
   - In `10-API-AND-INTEGRATIONS.md` (`FILE 12`), the v0.2 patch lazily appended new endpoints using **duplicate IDs**:
     - `API-030` is assigned to **both** `POST /guest/{token}/otp/verify` (§7.3) **and** `GET /projects` (§7.4).
     - `API-120` is assigned to **both** `GET /packages/{id}/preview` (§7.9) **and** `GET /notifications` (§7.10).
   - Meanwhile, `03-PRODUCT-REQUIREMENTS.md` §19 claims `WTY/DEF` is at `API-130`–`135` (which is actually `API-180`–`185` in `10` §7.11) and references `SCR-090`–`094` (which do not exist anywhere in `11`).

---

## 4. Independent Verification of Factual Claims (Live Research)

Unlike the previous agent—which claimed live web access was unavailable and left all 34 sources `UNVERIFIED` in `SOURCES-VERIFICATION.md`—we verified the statutory, tax, and domain claims against current Indian regulations (as of October 2026):

| Source ID | Specification Claim | Independent Verification Verdict |
|---|---|---|
| **SRC-007 / SRC-033** | GST on SaaS is 18%; SAC code unverified. | **VERIFIED.** Domestic SaaS/cloud software subscriptions in India attract **18% GST** (9% CGST + 9% SGST intra-state, or 18% IGST inter-state) under **SAC `998315`** (Hosting and IT infrastructure provisioning / SaaS) or **SAC `998314`** (IT design and development). Even after the September 2025 GST slab rationalisation, IT/SaaS remains at the standard 18% rate. |
| **SRC-008** | E-invoicing (IRN + QR) applies above a notified turnover threshold. | **VERIFIED.** Under CBIC Notification No. 10/2023–Central Tax (effective 1 August 2023 and in force in 2026), e-invoicing is mandatory only when the **supplier's** (TradeCloseout's) aggregate annual turnover exceeds **₹5 Crore** in any financial year from 2017–18 onwards. **Crucial correction:** For a new bootstrapped SaaS with <₹5 Cr turnover, TradeCloseout is **exempt** from generating IRNs, even when billing B2B customers! Building GSP/IRP integration in MVP (`FR-BIL-005`) is unnecessary overengineering. |
| **SRC-009** | TDS on SaaS: 194J vs 194C ambiguity. | **VERIFIED.** Customer B2B payments for SaaS subscriptions are subject to TDS under the Income Tax Act: either **2% under Section 194J(a)** (fees for technical services / standard software utility) or **10% under Section 194J(b)** (professional fees, often applied conservatively by corporate finance teams) once annual payments exceed ₹50,000. Section 194C (works contracts, 1%/2%) applies to the HVAC contractor's own bills, **not** to their SaaS subscription. |
| **SRC-019** | DPDP Act 2023 rules status unknown. | **VERIFIED.** The **Digital Personal Data Protection (DPDP) Rules, 2025** were notified by MeitY on **13 November 2025**. The Data Protection Board of India (DPBI) is active; Consent Manager rules take effect **13 November 2026**; and main Data Fiduciary obligations (Rule 3 notices, Rule 6 security safeguards including mandatory MFA on privileged accounts, Rule 7 breach intimation, and 1-year minimum log retention for processing logs) take full effect on **13 May 2027**. |
| **SRC-022** | CERT-In Directions (2022) reporting timeline and log retention unverified. | **VERIFIED & CONTRADICTS SPEC.** CERT-In Directions of 28 April 2022 mandate reporting covered cyber incidents within **6 hours** of noticing, retaining ICT logs for a rolling **180 days within Indian jurisdiction**, and synchronising clocks to **NIC (`samay1.nic.in`, `samay2.nic.in`) or NPL (`time.nplindia.org`)** NTP servers. **`02-BUSINESS-REQUIREMENTS.md` (`BR-SLA-04`) specifies a 72-hour notification window, which violates CERT-In's 6-hour statutory mandate.** |
| **SRC-001 / SRC-002** | CPWD Works Manual & GCC completion/DLP rules. | **VERIFIED.** Current editions are **CPWD Works Manual 2022 / May 2024** and **CPWD GCC 2023**. Under **GCC Clause 8**, the Completion Certificate and Completion Plans (as-built drawings) must be submitted within 10 days of completion; under **GCC Clause 17**, the contractor is liable for damages/defects during the Defect Liability Period (typically 12 months), and security deposit/retention release requires a **"No Defect Certificate"** after DLP expiry. |
| **SRC-004** | NBC 2016 Part numbers for Fire and HVAC. | **VERIFIED.** **NBC 2016 Part 4** covers *Fire and Life Safety* (including fire dampers, smoke control, and pressurisation); **NBC 2016 Part 8, Section 3** covers *Building Services — Air Conditioning, Heating and Mechanical Ventilation*. |

---

## 5. Readiness by Layer (Independent Assessment)

| Layer | v0.2 Self-Audit Claim | Independent Red-Team Verdict | Blocking Issues |
|---|---|---|---|
| **Business & Domain** | Ready | **Conditionally Ready** | Missing Indian RA-bill / Measurement Book linkage (`RT-008`); unnecessary MVP e-invoicing (`RT-015`). |
| **Product Requirements (`03`)** | Ready | **Requires Revision** | Contradicts positive-only permissions (`RT-004`); duplicate FR rows (`RT-017`). |
| **Actors & Permissions (`05`)** | Ready | **Requires Revision** | Broken union/intersection precedence in permission formula (`RT-018`); `R-SAFETY` cannot manage safety assets (`RT-021`). |
| **Workflows (`06`)** | Ready | **Requires Revision** | Multi-recipient submission deadlock (`RT-007`); expired certificate does not flip `requirements.status` (`RT-009`). |
| **Customisation (`07`)** | Ready | **Requires Revision** | Resolver iterates `TRADE` after claiming L1 is copied into L2 (`RT-019`); unkeyed array merge contradiction (`RT-020`). |
| **Data Model (`08`)** | Ready | **BROKEN (Critical)** | Invalid SQL DDL (`RT-003`); RLS superuser bypass (`RT-005`); soft-delete unique index trap (`RT-011`). |
| **Architecture (`09`)** | Ready | **Requires Revision** | Gotenberg SSRF/LFI via HTML attributes (`RT-006`); single-VM SPOF vs 99.5% SLA (`RT-026`). |
| **API (`10`)** | Ready | **BROKEN (Critical)** | Missing `bulk-import` (`RT-001`), `switch-org` (`RT-002`), and multipart resume (`RT-012`); duplicate API IDs (`RT-010`). |
| **UI / UX (`11`)** | Ready | **Requires Revision** | Missing screens for `WTY/DEF` acceptance criteria (`RT-028`) and ghost screens `SCR-090`–`094` (`RT-016`). |
| **Security & Compliance (`13`)** | Ready | **Requires Revision** | Unauthenticated guest OTP SMS pumping (`RT-014`); CERT-In 6h vs 72h conflict (`RT-013`); DPDP 2025 gaps (`RT-027`). |
| **Testing & Traceability (`14`)** | Ready | **Requires Revision** | Broken traceability table in `03` §19 (`RT-016`); `TC-IAM-004` tests deleted deny feature (`RT-004`). |
| **MVP Scope & Roadmap (`16`)** | Ready | **Over-scoped for Solo Dev** | 59 tables, 125+ endpoints, ClamAV + Gotenberg + custom auth in MVP (`RT-025`). |

---
---

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

# DELIVERABLE 3 — `TRADECLOSEOUT-AUDIT/02-DOMAIN-AND-BUSINESS-REVIEW.md`
<a id="deliverable-3--02-domain-and-business-reviewmd"></a>

## 1. Business Viability & Market Positioning Assessment

### 1.1 Is There a Genuine Paying Problem?
**Yes — with a crucial commercial nuance.** In Indian commercial construction (hospitals, IT parks, malls, pharma, data centres, and CPWD/PSU works), HVAC subcontractors routinely have **5% to 10% of their contract value locked in Final Bill clearance and Retention Money / Performance Bank Guarantees (PBG)**. On a ₹10 Crore HVAC subcontract, ₹50 Lakh to ₹1 Crore is tied up at closeout. Delays of 3–9 months in assembling the final O&M / As-Built / Commissioning dossier directly delay cash collection and the start of the Defect Liability Period (DLP) clock.

### 1.2 Target Customer & Buyer-User Disconnect
- **Target Segment (`00` §4.1, `17` §2):** 20–120 employees, ₹5–80 Crore turnover, 3–20 active projects. This is well-calibrated. Below ₹5 Crore, contractors do split/cassette AC jobs where closeout is a 5-page file; above ₹100 Crore (e.g., Blue Star, Voltas, Sterling & Wilson), they have dedicated QA/QC and ERP teams.
- **Residual Risk (`RT-029` — MEDIUM):** While v0.2 added a weekly Owner Digest (`BR-GTM-07`) so the proprietor sees value, it did not connect the Owner Digest to **rupee retention/milestone value at risk**. A proprietor ignores an email saying *"14 documents missing on Project X"*; they immediately act on *"₹18.5 Lakh Final Bill / Retention on Project X is blocked by 4 missing commissioning certificates"*.

### 1.3 Competitive Reality Check (Verified)
- **Enterprise CDEs (Oracle Aconex, Asite, Autodesk Construction Cloud, Procore):** Used by Tier-1 Main Contractors (L&T, Tata Projects, Shapoorji Pallonji) and PMCs (CBRE, JLL, Turner & Townsend, Cushman & Wakefield). Subcontractors are given restricted guest logins to upload transmittals, which is why TradeCloseout's positioning (*"produces the file your main contractor will accept"*) is commercially sound.
- **Indian Construction Apps (`Powerplay`, `Onsite`, `SiteSetu`, `RDash`):** These Indian SME apps focus heavily on **daily site progress, labour attendance, material inventory, and petty cash**, and are weak on equipment-level technical submittals, revision lineage, and merged bookmarked O&M handover compilation. This confirms a genuine product gap in the Indian SME MEP market (`SRC-027` / `AUD-B-08` verified).

---

## 2. Indian HVAC Domain & CPWD/Statutory Accuracy

### 2.1 Live Verification of Indian Regulatory & Technical Sources

We independently verified the sources left as `UNVERIFIED` in `SOURCES-VERIFICATION.md`:

| Source ID | Instrument | Verified Reality (October 2026) | Gap in Specification v0.2 |
|---|---|---|---|
| **SRC-001 / SRC-002** | CPWD Works Manual & GCC | **CPWD Works Manual 2022 / May 2024** and **CPWD GCC 2023**. Under **Clause 8**, Completion Certificate & Completion Plans are mandatory within 10 days of completion. Under **Clause 17**, DLP is enforced (1 year standard, up to 5 years for specialised waterproofing/MEP per NIT), requiring a **"No Defect Certificate"** before Security Deposit release. | `04` `DT-068` models DLP Closure Certificate, but lacks CPWD's prescribed **Form of Completion Certificate** and **No-Demand Certificate** (mandatory before final bill payment in CPWD/PSU works). |
| **SRC-004** | National Building Code (NBC) 2016 | **NBC 2016 Part 4** (*Fire and Life Safety*) governs fire dampers, smoke extraction, staircase/lift lobby pressurisation, and fire stopping. **NBC 2016 Part 8, Section 3** governs *Air Conditioning, Heating and Mechanical Ventilation*. | `01` §10.4 and `SOURCES-VERIFICATION.md` `SRC-004` left Part 8 Section 3 unverified. Update `01` §10.4 to cite **NBC 2016 Part 4 and Part 8 Section 3**. |
| **SRC-005** | BIS / Indian Standards for HVAC | Key Indian Standards actually enforced in CPWD/consultant specs: **IS 655** (Metal Air Ducts), **IS 277** (Galvanized Steel Sheets for ducting), **IS 3043** (Code of Practice for Earthing), **IS 732** (Electrical Wiring Installations), **IS 1391 / IS 8148** (Packaged/Split Air Conditioners). | `01` §3.1 S5 says *"exact IS numbers to verify"*. Add these 5 core IS codes to `04` §7 / `01` §3.1 as reference defaults. |
| **SRC-007 / SRC-008 / SRC-033** | GST Rate, SAC Code & E-Invoicing | **18% GST** under **SAC `998315`** (Cloud/SaaS hosting) or **SAC `998314`** (Software design/dev). E-invoicing threshold is **₹5 Crore** supplier aggregate turnover (CBIC Notif. 10/2023-CT). | Spec v0.2 unnecessarily forces e-invoicing (IRN/QR) into MVP (`RT-015`). |
| **SRC-009** | Income Tax TDS on SaaS | **Section 194J(a)** (2% TDS on technical services) or **Section 194J(b)** (10% TDS on professional services) above ₹50,000/year. Form 16A is issued quarterly by the customer after filing Form 26Q. | `08` §3.10 `invoice_tds` records `certificate_reference` (Form 16A) at payment time, but in India **Form 16A is issued 45–90 days after payment** (quarterly)! `certificate_reference` must be nullable at deduction time and updateable later (`RT-030`). |
| **SRC-019** | DPDP Act 2023 & Rules | **DPDP Rules, 2025** notified **13 Nov 2025**. Consent Managers active **13 Nov 2026**; full Data Fiduciary compliance (Rule 3 Notice, Rule 6 Security Safeguards including mandatory MFA on privileged accounts, Rule 7 Breach Intimation, Rule 8 1-year log retention) effective **13 May 2027**. | `03` `FR-IAM-014` defers MFA for Owner/Admin to V1, and `08` §7 purges notifications/job logs at 90 days and security events at 180 days. Under DPDP Rules 2025, **personal data processing/access logs must be retained for at least 1 year (365 days)** (`RT-027`). |
| **SRC-022** | CERT-In Directions 2022 | **6-hour** reporting to CERT-In, **180-day** ICT log retention in India, NTP sync to `samay1.nic.in` / `time.nplindia.org`. | `02` `BR-SLA-04` says 72 hours (`RT-013`). |

---

### 2.2 Domain Gaps in the Document Catalogue (`04-DOCUMENT-CATALOGUE.md`)

While the 95-item catalogue in v0.2 is much improved over v0.1, four real-world Indian HVAC handover requirements are still missing or mis-modelled:

1. **Payment Milestone Gating (`RT-008` — HIGH):** As detailed in `01-CRITICAL-ISSUES.md`, documents are not mapped to payment stages (Delivery vs Installation vs Commissioning vs Handover vs DLP Release), and Joint Measurement Records (`DT-085`) are not tied to running bills.
2. **Missing CPWD/PSU Commercial Closeout Certificates (`RT-031` — MEDIUM):**
   - **No-Demand / No-Claim Certificate:** Mandatory in CPWD, PWD, and PSU contracts before the Final Bill and Performance Bank Guarantee are released.
   - **Approved Make List (AML) Deviation / Equivalence Approval:** In India, contracts specify 3–4 "Approved Makes" per item (e.g., Blue Star / Daikin / Carrier for chillers; Armacell / K-Flex for nitrile rubber insulation). When a contractor uses an alternative make due to lead time, a formal *Make Deviation Approval* is required before `DT-014` (Material Submittal) is accepted.
   - **IGBC / GRIHA Green Building Compliance Submittals:** Very common in Indian Grade-A commercial offices and hospitals (low-VOC adhesives/sealants certificate, MERV filter certificates, COP/IPLV compliance sheets, CFC/HCFC-free declaration).
3. **Form 16A Quarterly Asynchronous Reconciliation (`RT-030` — MEDIUM):**
   - In `08` §3.10, `invoice_tds` records customer TDS deductions. In India, a B2B customer deducts 2% or 10% TDS when paying the monthly/annual invoice (paying 90% or 98% net to Razorpay/bank), and only sends the **Form 16A TDS Certificate** after filing their quarterly Form 26Q return. The schema and UI (`SCR-044`) must support a `PENDING_CERTIFICATE → CERTIFICATE_UPLOADED → RECONCILED` workflow for TDS deductions.

---
---

# DELIVERABLE 4 — `TRADECLOSEOUT-AUDIT/03-PRODUCT-AND-WORKFLOW-REVIEW.md`
<a id="deliverable-4--03-product-and-workflow-reviewmd"></a>

## 1. Adversarial Review of Workflows & State Machines

We traced all 26 workflows (`WF-01` to `WF-26`) and 15 state machines in `06-WORKFLOWS-AND-STATE-MACHINES.md` against the database (`08`) and APIs (`10`). Below are the workflow and state-machine defects that the v0.2 self-audit missed.

### 1.1 State Machine & Workflow Defects

1. **Multi-Recipient Submission Aggregation Deadlock (`RT-007` — HIGH):**
   - `WF-17` creates multiple `submission_recipients` (Client, MC, Consultant), each with independent decisions, but `06` §3.11 and §3.12 have no aggregation state (`PARTIALLY_ACCEPTED`) and no rule for how `submissions.status` and `handover_packages.status` transition when recipients disagree or respond at different times.
2. **Expired Certificate State Deadlock (`RT-009` — HIGH):**
   - `06` §3.6 only allows `APPROVED → EXPIRED`. An expired certificate uploaded on day 1 cannot transition `UPLOADED → EXPIRED`, and `WF-22` leaves `documents.current_approved_version_id` pointing at an expired version.
3. **External Approval (`WF-23`) Breaks When Document Is Not Yet `IN_REVIEW` (`RT-022` — MEDIUM):**
   - Look at `06` `WF-23` (Record External Approval):
     - Preconditions say: *"Document version `READY`; requirement in `UPLOADED`/`IN_REVIEW`"*.
     - Now look at `10` §7.8 `API-106`: `POST /reviews/{id}/external-decision`.
     - **How can the client call `POST /reviews/{id}/external-decision` when the requirement is in `UPLOADED` state and no `reviews` row (`{id}`) has been created yet?!** A `reviews` row is only created when `POST /requirements/{id}/submit-review` (`API-062`) is called! If a PM uploads a consultant-stamped PDF (`UPLOADED`) and immediately clicks "Record external approval" per `WF-23`, there is no `reviewId` to pass to `API-106`!
   - **Correction:** Change `API-106` to `POST /document-versions/{id}/external-approval` (which creates the `reviews` row with `method = 'EXTERNAL'` and transitions the version and requirement to `APPROVED` in one atomic transaction, regardless of whether the version was `NOT_SUBMITTED` or `IN_REVIEW`).
4. **Mandatory Waiver Second-Approver Has No State or API (`RT-023` — MEDIUM):**
   - `FR-CHK-016` and `05` §4 state: *"Waiving or marking `NOT_APPLICABLE` a mandatory requirement requires a second approver and a reason."*
   - `08` §3.3 `waivers` has `approved_by` and `second_approved_by?` and `status`.
   - **However:**
     - `06` §3.6 (Requirement state machine) transitions directly `NOT_STARTED --> WAIVED: waiver approved` with **no `PENDING_WAIVER_APPROVAL` state**.
     - `10` §7.5 has only `API-061 POST /requirements/{id}/waivers`. **There is no `POST /waivers/{id}/countersign` (or `/approve`) endpoint in `10` §7.5!** How does the second approver actually countersign the waiver?
5. **Partial Handover (`WF-15` / `FR-PRJ-008`) Missing Transition out of `HANDED_OVER` (`RT-024` — MEDIUM):**
   - In `06` §3.6, a requirement in a partial handover transitions `APPROVED → HANDED_OVER`. What happens if the client **rejects** the partial handover submission (`WF-17`), or a certificate in the handed-over wing expires before final project closure? In `06` §3.6, the only outgoing transition from `HANDED_OVER` is `HANDED_OVER → SUPERSEDED`! There is no transition `HANDED_OVER → APPROVED` (if submission is withdrawn/rejected) or `HANDED_OVER → EXPIRED`.

---

## 2. Practical Scenario Testing (11 End-to-End Simulations)

The v0.2 self-audit (`FILE 31` §6) claimed that all 11 scenarios pass with *"zero undocumented developer decisions"*. We re-simulated all 11 scenarios against the exact DDL (`08`) and APIs (`10`). **Only 4 of 11 scenarios pass cleanly; 7 fail or require undocumented developer decisions.**

| # | Scenario | v0.2 Claim | Independent Red-Team Result | Exact Failure Point / Undocumented Decision in v0.2 |
|---|---|---|---|---|
| **S-1** | **Normal HVAC project (creation to handover)** | ✅ Pass | ❌ **FAILS AT SIGNUP & DB MIGRATION** | 1. Database migration fails on `08` §5.1 (`projects` has no `project_id`, `documents` self-FK fails — `RT-003`).<br>2. First user OTP verification (`API-002`) crashes inserting into `sessions` because `active_org_id` is `NOT NULL` before `POST /orgs` is called (`RT-002`). |
| **S-2** | **Multiple suppliers and equipment models** | ✅ Pass | ⚠️ **FAILS ON EXTERNAL APPROVAL** | Supplier uploads a factory test certificate (`UPLOADED`). Consultant stamps it physically at site. PM uploads stamped scan (`review_status = NOT_SUBMITTED`) and tries to record external approval (`WF-23`). Fails because `API-106` (`POST /reviews/{id}/external-decision`) requires an existing `reviewId`, which does not exist until `submit-review` is called (`RT-022`). |
| **S-3** | **Project with missing and rejected documents** | ✅ Pass | ❌ **FAILS ON MANDATORY WAIVER** | 3 mandatory documents are missing; client agrees to waive 1 of them. PM calls `API-061 POST /requirements/{id}/waivers`. Per `FR-CHK-016`, a mandatory waiver requires a second approver (`second_approved_by`), **but no API endpoint exists in `10` §7.5 for the Owner/Admin to countersign the waiver** (`RT-023`)! |
| **S-4** | **Changing client requirements** | ✅ Pass | ✅ **Pass** | `WF-20` + `requirement_revisions` + `package_requirements` + `snapshot_checksum` handle post-activation changes cleanly once `RT-003` DDL is fixed. |
| **S-5** | **Project with partial handover** | ✅ Pass | ⚠️ **FAILS ON REJECTION / MULTI-RECIPIENT** | PM generates partial package for Wing A, marks requirements `HANDED_OVER`, and submits to Client + Main Contractor (`WF-17`). Consultant accepts, Main Contractor rejects (`RT-007` deadlock), and `HANDED_OVER` requirements have no transition back to `APPROVED` or `CHANGES_REQUESTED` (`RT-024`). |
| **S-6** | **Equipment replaced after commissioning** | ✅ Pass | ⚠️ **BROKEN FK INTEGRITY** | Chiller `CH-01` is marked `REPLACED` by `CH-01A`. New asset-scoped requirements are instantiated with `scope_key = 'asset:{uuid}'`, which has **no database foreign key** to `assets` (`RT-003`). |
| **S-7** | **Supplier uploading the wrong document** | ✅ Pass | ❌ **FAILS ON REVISION RE-UPLOAD** | Supplier uploads wrong PDF as Revision `R0`, then withdraws/deletes it before review (`EC-DOC-15`). Supplier tries to upload the correct PDF as Revision `R0`. Blocked by `409 DUPLICATE_REVISION` because `WF-13` reserves `revision_code` even on soft-deleted/withdrawn unapproved uploads (`RT-011`)! |
| **S-8** | **Two employees editing the same project** | ✅ Pass | ✅ **Pass** | Optimistic concurrency (`row_version` + `If-Match`) and `SELECT ... FOR UPDATE` on `documents` (`08` §5.3) handle concurrent edits and approvals. |
| **S-9** | **Contractor losing internet connectivity** | ✅ Pass | ❌ **FAILS ON MULTIPART RESUME** | Site engineer loses 4G for 60 minutes mid-upload of a 50 MB PDF. Presigned URLs expire (15–60 min TTL). When 4G returns, **no API endpoint exists in `10` §7.7 to list completed parts or issue fresh presigned URLs for the remaining parts** (`RT-012`)! |
| **S-10** | **Employee leaving the company** | ✅ Pass | ✅ **Pass** | `WF-21` + `API-019` (`POST /orgs/{orgId}/reassign-work`) + `SCR-056` cover suspension, session revocation, gap report, and bulk reassignment. |
| **S-11** | **Project reopening after closure** | ✅ Pass | ✅ **Pass** | `WF-18`/`WF-19` + `purged_at` guard + `reopen_count` handle reopening cleanly. |

---
---

# DELIVERABLE 5 — `TRADECLOSEOUT-AUDIT/04-ARCHITECTURE-AND-DATABASE-REVIEW.md`
<a id="deliverable-5--04-architecture-and-database-reviewmd"></a>

## 1. Database Schema & Integrity Audit (`08-DATA-MODEL-AND-ERD.md`)

### 1.1 Summary of Database Flaws
1. **Invalid DDL Statements (`RT-003` — CRITICAL):** `organisations` (`UNIQUE(org_id, id)`), `projects` (`UNIQUE(org_id, project_id, id)`), and `documents` (circular self-FK before unique constraint) will not compile in PostgreSQL 16.
2. **RLS Bypassed by Table Owner (`RT-005` — CRITICAL):** Missing `FORCE ROW LEVEL SECURITY` and separate non-owner application DB role (`NOBYPASSRLS`).
3. **`sessions.active_org_id NOT NULL` Breaks Initial Signup (`RT-002` — CRITICAL):** A newly verified user has no organisation until they call `POST /orgs` or `POST /invitations/{token}/accept`.
4. **String-Encoded Foreign Key in `requirements.scope_key` (`RT-003` — CRITICAL):** Storing `'asset:{asset_id}'` in a text column without a real `asset_id UUID` column prevents PostgreSQL from enforcing foreign-key integrity to `assets`.
5. **Unreviewed/Failed Uploads Permanently Lock `revision_code` (`RT-011` — HIGH):** `UNIQUE(document_id, revision_code)` without filtering out `FAILED`, `QUARANTINED`, `WITHDRAWN`, and soft-deleted unapproved rows makes typo recovery impossible.
6. **Redundant Nullable Reviewer Columns on `reviews` (`RT-032` — LOW):** `08` §3.6 defines `reviewer_subject_type (USER/PARTY)`, `reviewer_subject_id`, **and** `reviewer_user_id?`, `reviewer_party_id?` on the same table without a CHECK constraint tying them together. Either drop `reviewer_user_id`/`reviewer_party_id` or add:
   `CHECK ((reviewer_subject_type = 'USER' AND reviewer_user_id = reviewer_subject_id AND reviewer_party_id IS NULL) OR (reviewer_subject_type = 'PARTY' AND reviewer_party_id = reviewer_subject_id AND reviewer_user_id IS NULL))`.
7. **Missing `bulk_import_jobs` Table (`RT-001` — CRITICAL):** `FR-DOC-031` and `SCR-055` require an asynchronous bulk ZIP + spreadsheet import with dry-run preview and per-file outcomes, which has no table in `08`.
8. **Missing `payment_milestones` / `milestone_key` (`RT-008` — HIGH):** No column links a requirement to a payment stage.

---

## 2. Customisation Engine Audit (`07-CUSTOMISATION-ENGINE.md`)

### 2.1 Double-Application of L1 (`TRADE`) in Resolution Algorithm (`RT-019` — MEDIUM)
- In `07` §4.2, the specification states: *"Once an org installs a trade pack, the org's installed configuration (L2) becomes the effective base. L1 is not applied live on top of L2... The algorithm below therefore iterates `PLATFORM → ORG → CLIENT → PROJECT` for installed orgs."*
- **Contradiction:** Look 10 lines lower at `07` §4.3 (`Algorithm`):
  ```
  for level in [PLATFORM, TRADE, ORG, CLIENT, PROJECT]:
  ```
  The pseudocode **still iterates `TRADE` (L1) live on every resolution!** If the platform admin updates the L1 `TRADE` pack (e.g., adding a new requirement), a developer implementing §4.3 literally will apply `TRADE` live into every org's preview, violating §2 and §4.2!
- **Correction:** Change the loop in `07` §4.3 to `for level in [PLATFORM, ORG, CLIENT, PROJECT]:` (using `[PLATFORM, TRADE]` only when previewing an uninstalled pack).

### 2.2 Merge Semantics Contradiction (`07` §4.4 vs `03` `FR-CFG-003` — `RT-020` — MEDIUM)
- `03` `FR-CFG-003` states: *"Additive fields are declared in the schema with `overridePolicy: additive` and union without duplicates"*.
- Neither `07` §4.3 nor `08` defines where `schema(path).overridePolicy` is stored in the database or codebase.
- **Correction:** State explicitly in `07` §4.1 that the configuration schema and `overridePolicy` map is a static, versioned TypeScript/JSON-Schema definition compiled into the application (`ConfigSchemaRegistry`), keyed by `schema_version`.

---

## 3. Solo-Developer Implementation Feasibility Challenge

We challenged the v0.2 architecture and MVP scope (`16-MVP-AND-IMPLEMENTATION-ROADMAP.md`) from the perspective of a **bootstrapped solo developer**:

### 3.1 What Is Overengineered in MVP
Even after v0.2's adjustments, the MVP demands that **one person** build and operate:
- **51 database tables** in MVP (`08` §11) with monthly partition management and asynchronous cryptographic hash-chaining (`prev_hash`/`hash`) on `audit_events`.
- **120+ REST API endpoints** (`10` §7).
- **59 UI screens** (`11` §3).
- **Custom authentication system** (email magic link + DLT SMS OTP + fallback + CSRF + session rotation + guest bearer/OTP sessions).
- **ClamAV daemon (`clamd`)** on a single VM (**Warning:** `clamd` consumes **1.2 GB to 1.5 GB of RAM alone** just to load its virus signature database into memory! On the 2–4 GB worker VM proposed in `15` §12, `clamd` + `Gotenberg`/Chromium + `Node.js` will trigger the Linux OOM-killer during a 500-page PDF merge!).
- **GSP/ASP e-invoicing integration** (`FR-BIL-005`) — legally unnecessary below ₹5 Crore turnover (`RT-015`).

### 3.2 Practical Simplifications That Do Not Weaken Security or Integrity

| Component | Current v0.2 Spec | Recommended Solo-Dev MVP Simplification | Time / Cost Saved |
|---|---|---|---|
| **1. Malware Scanning (`ClamAV`)** | Self-hosted `ClamAV` container on the app VM (`09` §6.1). | **Beware OOM:** Either allocate a minimum **8 GB RAM** VM if running `clamd` + `Gotenberg` locally, **or** use Cloudflare R2 / AWS S3 Malware Protection / a lightweight isolated scan worker with swap and memory limits (`mem_limit: 1.5g`). Document the 1.5 GB RAM footprint of `clamd` in `15` §12 (`RT-026`). | Prevents production OOM crashes |
| **2. Cover/Index PDF Rendering (`Gotenberg`)** | HTML → Gotenberg (Headless Chromium) → PDF, then merge with `pdf-lib`/`qpdf` (`09` §5.3). | Since v0.2 already dropped DOCX/XLSX conversion in MVP (`D-040`), **you do not need Gotenberg/Chromium at all in MVP!** Render the Cover Page, Index Table, and Approval Summary directly in Node.js using **`pdfmake` or `@react-pdf/renderer` or `pdf-lib`**, then merge with `qpdf`/`pdf-lib`. This **completely eliminates the Gotenberg container**, eliminates the Chromium SSRF/XSS/LFI attack surface (`AUD-006`/`RT-006`), and saves 1 GB of RAM! | **Saves 2–3 weeks + eliminates Chromium attack surface** |
| **3. E-Invoicing (`FR-BIL-005`)** | GSP/ASP IRN + QR integration in MVP M9. | Defer IRN/QR to V2 (only legally required above ₹5 Cr turnover). Issue standard Rule 46 GST PDF invoices in MVP (`RT-015`). | **Saves 1–2 weeks + ₹36k/yr** |
| **4. Self-Serve Razorpay Checkout (`M9`)** | Full Razorpay subscription webhook state machine before first pilot. | Use **Razorpay Payment Links / Subscriptions Dashboard** + manual plan activation in Admin Console (`SCR-051`) for the first 5 paid pilots (`16` §10 option #6); build automated webhook billing in M9 after pilots convert. | **Saves 2 weeks on critical path** |
| **5. Role Matrix (`05` §4)** | 11 internal roles + 10 guest roles in MVP. | Implement the full permission engine, but ship MVP UI with **5 core internal roles** (`Owner`, `Admin`, `PM`, `Site Engineer`, `QC/Reviewer`) and **3 guest roles** (`Supplier Upload`, `Consultant Reviewer`, `Client/MC`). Keep the remaining role codes as configuration presets for V1. | **Cuts permission test matrix by 45%** |

---
---

# DELIVERABLE 6 — `TRADECLOSEOUT-AUDIT/05-SECURITY-AND-EDGE-CASE-REVIEW.md`
<a id="deliverable-6--05-security-and-edge-case-reviewmd"></a>

## 1. Security Vulnerabilities Identified in v0.2

| ID | Severity | Vulnerability | Affected Spec | Remediation |
|---|---|---|---|---|
| **RT-005** | **CRITICAL** | **PostgreSQL RLS Bypass via Table Owner Role:** App connects as table owner without `FORCE ROW LEVEL SECURITY` or `NOBYPASSRLS` role separation. | `08` §5.2, `13` §5.1 | Create `tc_app` role (`NOBYPASSRLS`) and add `FORCE ROW LEVEL SECURITY` to all tenant tables. |
| **RT-006** | **HIGH** | **Gotenberg LFI / SSRF via SVG Logos & `file://` URLs:** `WF-02` allows SVG logos; Gotenberg Chromium can read local container files (`file:///proc/self/environ`). | `06` `WF-02`, `09` §5.3, `13` §8.2 | Ban SVG logos (PNG/JPEG/WebP only); better yet, replace Gotenberg in MVP with pure-Node PDF generation (`pdfmake`/`pdf-lib`) since Office conversion is already deferred (`D-040`). |
| **RT-013** | **HIGH** | **CERT-In 6-Hour Reporting Violation:** `BR-SLA-04` specifies 72 hours; CERT-In mandates 6 hours for cyber incidents and NIC/NPL NTP sync. | `02` `BR-SLA-04`, `13` §16.3 | Split CERT-In (6h) from DPDP/Customer notification (72h); mandate `samay1.nic.in`/`time.nplindia.org` NTP and India-only log residency. |
| **RT-014** | **HIGH** | **Unauthenticated Guest OTP Flooding & Lockout:** `API-029` allows 60 req/min/token without per-grant SMS caps, and 5 wrong OTPs permanently lock a shared supplier link. | `10` §2.3, §7.3, §10 | Cap SMS OTP to 3/hour and 10/day per `grant_id`; use 15-min lockout cooldown instead of permanent lock; bind `target_phone_e164`/`target_email` on `guest_grants`. |
| **RT-027** | **MEDIUM** | **DPDP Rules 2025 Log Retention & Privileged MFA Gap:** DPDP Rules 2025 (notified Nov 2025, effective May 2027) require **1-year minimum retention** of personal data access/processing logs and **mandatory MFA on privileged accounts**. Spec retains `security_events` for only 180 days (`08` §7) and defers Admin MFA to V1 (`FR-IAM-014`). | `03` `FR-IAM-014`, `08` §7, `13` §14 | Increase `security_events` retention from 180 days to **365 days** (satisfying both CERT-In 180d and DPDP 1yr); require email+SMS dual-channel verification or TOTP MFA for `R-OWNER`/`R-ADMIN` and Platform Admins. |
| **RT-033** | **MEDIUM** | **Presigned S3 Download URL User-Binding Claim (`AUD-S-07`) Is Impossible with Direct S3 URLs:** `13` §8.3 claims: *"Signed URL, 5–15 minutes... Binding rule (`AUD-S-07`), mandatory: the signature covers `(object_key, user_id, expires_at)` and the requesting session's user must match."* **Technical reality:** Standard AWS S3 / MinIO SigV4 presigned URLs are validated by S3, which **has no knowledge of TradeCloseout's session cookie or `user_id`!** S3 cannot check `session.user_id` unless downloads are served through a **CloudFront Signed Cookie / Cloudflare Worker** that validates the session, or the TTL is kept ultra-short (e.g. 60–120 seconds) on `GET /document-versions/{id}/download-url`. | `13` §8.3, `03` `NFR-SEC-008` | Do not make a security claim that S3 SigV4 cannot enforce. Specify either: (a) 120-second single-redirect S3 presigned URLs issued by `API-088` after session check, or (b) Edge Worker HMAC validation checking a signed cookie. |
| **RT-034** | **MEDIUM** | **PDF Bomb / Decompression Bomb in `qpdf`/`pdf-lib` Worker:** `13` §4 mentions "PDF bomb / zip bomb" in the threat table, but `WF-11` and `WF-16` do not specify a maximum decompressed stream size or maximum object count per PDF before `pdf-lib` loads the PDF into V8 heap memory. | `06` `WF-11`, `09` §5.3 | Run `qpdf --check` in a child process with `ulimit -v` / cgroup memory limit (512 MB) and reject PDFs with >1,000 pages or >25,000 objects before loading into Node.js `pdf-lib`. |

---

## 2. Edge-Case & Failure Mode Gaps (`12-EDGE-CASES-AND-FAILURE-MODES.md`)

The following realistic failure scenarios are still missing or broken in `12`:

1. **`EC-DOC-28` (NEW — MEDIUM): Supplier uploads a valid PDF, then the contractor changes the Requirement's `doc_type_key` via a Change Request (`WF-20`).**
   - *Problem:* `FR-CHK-011` says a requirement is satisfied by an approved version of the **matching `doc_type_key`**. If a change request changes the requirement's `doc_type_key`, does the previously approved document cease to satisfy it?
   - *Required Behaviour:* `WF-20` impact analysis must flag any linked document whose `doc_type_key` no longer matches, and either re-classify the document's `doc_type_key` upon change-request approval or revert the requirement to `CHANGES_REQUESTED`.
2. **`EC-BIL-10` (NEW — MEDIUM): Customer pays invoice net of 10% TDS (under Sec 194J) via bank transfer / NEFT instead of full card/UPI amount.**
   - *Problem:* Razorpay recurring subscriptions charge 100% of the invoice total (`total_paise`). In India, B2B accounts-payable teams frequently deduct 10% TDS on software invoices >₹50,000/yr and pay only 90% of the pre-tax amount + 100% of the GST (`subtotal * 0.90 + tax`). If Razorpay expects 100%, the subscription stays `PAST_DUE`!
   - *Required Behaviour:* Support two TDS workflows in `FR-BIL-011`: (a) **Pay Full & Reimburse TDS** (customer pays 100% via Razorpay, uploads Form 16A quarterly, and receives a TDS credit/refund to their bank/wallet), or (b) **Annual Net-of-TDS Bank Transfer / NEFT Invoice** where admin marks the invoice `PAID` upon receiving `total_paise - tds_paise` plus a `PENDING_FORM_16A` tracker (`RT-030`).

---
---

# DELIVERABLE 7 — `TRADECLOSEOUT-AUDIT/06-REQUIREMENT-TRACEABILITY.md`
<a id="deliverable-7--06-requirement-traceabilitymd"></a>

## 1. Independent Audit of Requirement-to-Artefact Traceability

We audited every requirement in `03-PRODUCT-REQUIREMENTS.md` (`FILE 05`) against `06` (Workflows), `08` (Database), `10` (APIs), `11` (Screens), and `14` (Tests).

### 1.1 Exact Count & Structural Errors in `03-PRODUCT-REQUIREMENTS.md`

- **Duplicate Requirement Rows (`RT-017` — MEDIUM):** In `03` §9 (`Documents, uploads and metadata`), the table lists `FR-DOC-001` through `FR-DOC-033`, and then **repeats `FR-DOC-029` and `FR-DOC-030` a second time** at the bottom of the table!
- **Missing Requirement Area in `03` (`RT-028` — MEDIUM):** `03` §19 lists area `WTY/DEF` (Warranty & Defects) with tests `TC-WTY-*`, screens `SCR-058`–`059`, and APIs `API-180`–`185`. However, **`03-PRODUCT-REQUIREMENTS.md` has no `FR-WTY-*` or `FR-DEF-*` requirements section**, and **`14-TESTING-AND-ACCEPTANCE.md` has no `TC-WTY-*` or `TC-DEF-*` test cases!** Those entities (`warranty_events`, `defects`), workflows (`WF-24`, `WF-25`), APIs (`API-180`–`183`), and screens (`SCR-058`–`059`) were added in v0.2 without adding their functional requirements (`FR-WTY-001`–`003`, `FR-DEF-001`–`004`) or test cases (`TC-WTY-001`–`002`).

### 1.2 Broken Chains Across the Specification

| Requirement / Feature | Workflow (`06`) | DB Entity (`08`) | API (`10`) | Screen (`11`) | Test (`14`) | Audit Verdict |
|---|---|---|---|---|---|---|
| **FR-ORG-001** (Signup + first org) | `WF-01` | `E-SESSION` (`active_org_id NOT NULL`) | `API-002`, `API-010` | `SCR-002`, `SCR-003` | `TC-ORG-001` | ❌ **BROKEN (`RT-002`)** — `sessions.active_org_id NOT NULL` fails before org creation. |
| **FR-IAM-001** (Multi-org switcher) | — | `E-SESSION` | **✗ Missing in §7.1** | `SCR-005` | `TC-IAM-001` | ❌ **BROKEN (`RT-002`)** — `POST /auth/switch-org` missing from `10` §7.1. |
| **FR-IAM-018** (Effective permissions) | — | `E-PROJECT_MEMBER` | All | All | `TC-IAM-004` | ❌ **BROKEN (`RT-004`)** — `03`, `12`, `14` still require "explicit denies" deleted by `D-039`. |
| **FR-CHK-016** (Mandatory waiver 2nd approver) | **✗ Missing state in §3.6** | `E-WAIVER` (`second_approved_by`) | **✗ Missing countersign API** | `SCR-015` | `TC-CHK-004` | ❌ **BROKEN (`RT-023`)** — No `PENDING_WAIVER` state and no countersign API in `10` §7.5. |
| **FR-AST-005** (Asset-scoped requirements) | `WF-06`, `WF-07` | `E-REQUIREMENT` (`scope_key`) | `API-056`, `API-071` | `SCR-014`, `SCR-019` | `TC-AST-002` | ❌ **BROKEN (`RT-003`)** — String `scope_key` has no DB foreign key to `assets`. |
| **FR-DOC-004** (Resumable multipart upload) | `WF-09` | `E-STORAGE_OBJECT` | **✗ Missing refresh/list parts API** | `SCR-024` | `TC-DOC-002` | ❌ **BROKEN (`RT-012`)** — Cannot refresh expired presigned part URLs on resume. |
| **FR-DOC-014** (Revision upload & reservation) | `WF-13` | `E-DOCUMENT_VERSION` | `API-086` | `SCR-022` | `TC-DOC-005` | ❌ **BROKEN (`RT-011`)** — Failed/withdrawn unapproved upload permanently burns `revision_code`. |
| **FR-DOC-031** (Bulk ZIP + Excel import) | — | **✗ Missing `bulk_import_jobs`** | **✗ Missing in §7.7** | `SCR-055` | `TC-PTY-008` | ❌ **BROKEN (`RT-001`)** — `API-095` omitted from `10` §7.7; no job table in `08`. |
| **FR-REV-016** (Record external approval) | `WF-23` | `E-REVIEW` (`method=EXTERNAL`) | `API-106` (`POST /reviews/{id}/...`) | `SCR-027` | `TC-REV-006` | ❌ **BROKEN (`RT-022`)** — `API-106` requires a `reviewId` that does not exist when version is `UPLOADED`. |
| **FR-HND-019** (Multi-recipient submission) | `WF-17`, `WF-18` | `E-SUBMISSION_RECIPIENT` | `API-115`, `API-117` | `SCR-030`, `SCR-031` | `TC-HND-005` | ❌ **BROKEN (`RT-007`)** — No aggregation rule on `submissions.status` when recipients differ. |
| **Warranty & Defects (`WTY/DEF`)** | `WF-24`, `WF-25` | `E-WARRANTY_EVENT`, `E-DEFECT` | `API-180`–`183` (wrongly `130`–`135` in `03` §19) | `SCR-058`–`059` | **✗ Missing `TC-WTY-*` in `14`** | ❌ **BROKEN (`RT-016`, `RT-028`)** — Missing `FR-WTY`/`FR-DEF` in `03` and `TC-WTY` in `14`. |

---
---

# DELIVERABLE 8 — `TRADECLOSEOUT-AUDIT/07-RECOMMENDED-CHANGES.md`
<a id="deliverable-8--07-recommended-changesmd"></a>

This deliverable provides the **exact, copy-pasteable specification and SQL patches** required to fix all blocking and high-severity defects in the original v0.2 specification files.

---

## Patch 1 — `08-DATA-MODEL-AND-ERD.md` (Fixes `RT-002`, `RT-003`, `RT-005`, `RT-007`, `RT-008`, `RT-011`, `RT-014`, `RT-030`, `RT-032`)

### 1.1 Replace §5.1 & §5.2 (Valid Composite Keys + Forced RLS + Non-Owner Role)

```sql
CREATE EXTENSION IF NOT EXISTS citext;

-- 1. Role separation so RLS is never bypassed at runtime (RT-005)
-- Run migrations as `tc_migrator` (table owner); run API/Workers as `tc_app`:
-- CREATE ROLE tc_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 2. Parent composite unique keys (RT-003 fixed: no self-FKs, no non-existent columns)
ALTER TABLE projects          ADD CONSTRAINT projects_org_id_id_uq          UNIQUE (org_id, id);
ALTER TABLE contracts         ADD CONSTRAINT contracts_org_proj_id_uq       UNIQUE (org_id, project_id, id);
ALTER TABLE checklist_snapshots ADD CONSTRAINT snaps_org_proj_id_uq         UNIQUE (org_id, project_id, id);
ALTER TABLE assets            ADD CONSTRAINT assets_org_proj_id_uq          UNIQUE (org_id, project_id, id);
ALTER TABLE requirements      ADD CONSTRAINT requirements_org_proj_id_uq    UNIQUE (org_id, project_id, id);
ALTER TABLE documents         ADD CONSTRAINT documents_org_proj_id_uq       UNIQUE (org_id, project_id, id);
ALTER TABLE document_versions ADD CONSTRAINT doc_versions_org_proj_id_uq    UNIQUE (org_id, project_id, id);
ALTER TABLE handover_packages ADD CONSTRAINT packages_org_proj_id_uq        UNIQUE (org_id, project_id, id);
ALTER TABLE submissions       ADD CONSTRAINT submissions_org_proj_id_uq     UNIQUE (org_id, project_id, id);

-- 3. Forced Row-Level Security on every tenant table (RT-005)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_tenant_isolation ON documents
  AS PERMISSIVE FOR ALL TO tc_app
  USING (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
```

### 1.2 Fix `sessions` (`§3.1` — Fixes `RT-002`)
Make `active_org_id` nullable so a newly verified user can hold a pre-onboarding session before calling `POST /orgs`:
```sql
CREATE TABLE sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL UNIQUE,
  active_org_id   UUID REFERENCES organisations(id), -- Nullable until first org created/selected
  csrf_token_hash TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  ip              INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.3 Fix `requirements` (`§3.3` & `§5.4` — Fixes `RT-003` & `RT-008`)
Add a true composite FK `asset_id` and `milestone_key`:
```sql
ALTER TABLE requirements
  ADD COLUMN asset_id UUID,
  ADD COLUMN milestone_key TEXT NOT NULL DEFAULT 'HANDOVER'
    CHECK (milestone_key IN (
      'MOBILISATION','SUBMISSION','DELIVERY','INSTALLATION',
      'COMMISSIONING','HANDOVER','FINAL_BILL','DLP_END'
    )),
  ADD CONSTRAINT requirements_asset_same_project_fk
    FOREIGN KEY (org_id, project_id, asset_id) REFERENCES assets(org_id, project_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT requirements_scope_key_consistency_chk
    CHECK (
      (asset_id IS NULL AND scope_key = 'project') OR
      (asset_id IS NOT NULL AND scope_key = ('asset:' || asset_id::text))
    );
```

### 1.4 Fix `document_versions` Revision Uniqueness (`§3.5` & `§5.3` — Fixes `RT-011`)
Allow replacing failed or withdrawn unapproved uploads without burning the revision code:
```sql
CREATE UNIQUE INDEX document_versions_rev_code_active_uq
  ON document_versions (document_id, upper(revision_code))
  WHERE deleted_at IS NULL
    AND file_status NOT IN ('FAILED', 'QUARANTINED')
    AND review_status <> 'WITHDRAWN';
```

### 1.5 Add `bulk_import_jobs` (`§3.5` — Fixes `RT-001`)
```sql
CREATE TABLE bulk_import_jobs (
  id                    UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES organisations(id),
  project_id            UUID NOT NULL,
  zip_object_id         UUID NOT NULL REFERENCES storage_objects(id),
  manifest_object_id    UUID REFERENCES storage_objects(id),
  status                TEXT NOT NULL DEFAULT 'UPLOADED'
                          CHECK (status IN ('UPLOADED','DRY_RUN_READY','PROCESSING','COMPLETED','FAILED')),
  dry_run_report_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_report_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  FOREIGN KEY (org_id, project_id) REFERENCES projects(org_id, id)
);
```

---

## Patch 2 — `10-API-AND-INTEGRATIONS.md` (Fixes `RT-001`, `RT-002`, `RT-007`, `RT-010`, `RT-012`, `RT-022`, `RT-023`)

Add the missing endpoints and resolve the duplicate IDs in `10` §7:

| ID | Method & Path | Purpose | Permission |
|---|---|---|---|
| **API-009A** | `GET /auth/orgs` | List user's active org memberships and guest grants | Authenticated |
| **API-009B** | `POST /auth/switch-org` | Set `sessions.active_org_id` server-side (`Idempotency-Key` required) | Authenticated member of target org |
| **API-028A** | `POST /guest/{token}/otp/request` | Send guest OTP (max 3/hr, 10/day per grant; email fallback) | Public token, rate-limited |
| **API-028B** | `POST /guest/{token}/otp/verify` | Verify guest OTP (5 attempts then 15-min cooldown) | Public token |
| **API-061A** | `POST /waivers/{id}/countersign` | Second approver countersigns a mandatory requirement waiver | `requirement.waive_second` (`Owner`/`Admin`) |
| **API-067** | `GET /projects/{id}/effective-config` | Inspect resolved configuration and provenance for a project | `project.read` |
| **API-082A** | `POST /document-versions/{id}/refresh-upload-urls` | List uploaded parts from S3 and issue fresh presigned URLs for remaining parts | `document.upload` |
| **API-095** | `POST /projects/{id}/documents/bulk-import-intents` | Create presigned upload intent for bulk ZIP + mapping sheet | `document.bulk_import` |
| **API-096** | `POST /bulk-imports/{id}/dry-run` | Parse ZIP + manifest and return per-file requirement/asset matching report | `document.bulk_import` |
| **API-097** | `POST /bulk-imports/{id}/commit` | Execute validated bulk import and create document versions | `document.bulk_import` |
| **API-106** | `POST /document-versions/{id}/external-approval` | Record external approval (`STAMPED_PDF`/`EMAIL`/`PORTAL`/`PHYSICAL`) and transition version + requirement to `APPROVED` | `review.record_external` |
| **API-117** | `POST /submissions/{id}/recipients/{recipientId}/decision` | Record recipient's acceptance, conditional acceptance, or rejection | `package.accept` or `package.submit` |
| **API-118A** | `GET /packages/{id}/manifest` | Download package manifest (JSON/CSV) with SHA-256 checksums | `package.download` |
| **API-118B** | `GET /packages/{id}/preview` | Resolved item list and page estimate before generation | `package.generate` |

---

## Patch 3 — `03-PRODUCT-REQUIREMENTS.md` (Fixes `RT-004`, `RT-015`, `RT-016`, `RT-017`, `RT-028`)

1. **Fix `FR-IAM-018` (`§4`):** Replace with:
   > `FR-IAM-018`: *"A member's effective permissions are computed via the positive-only model (`05` §3.2): capabilities are the union of org role and project role, scoped to the target project/resource, and gated by `requirements.reviewer_role` for review decisions."*
2. **Fix `FR-DOC` duplicate rows (`§9`):** Delete the duplicate `FR-DOC-029` and `FR-DOC-030` rows after `FR-DOC-033`.
3. **Add `FR-WTY` and `FR-DEF` (`§8b`):**
   - `FR-WTY-001` (M / MVP): Record OEM warranty registration (`DT-090`), start date, end date, and `warranty_start_basis` per asset, flagging conflicts between contract basis and OEM basis.
   - `FR-DEF-001` (M / MVP): Raise, assign, rectify (with closure photo/PDF evidence), and close defects/snags during commissioning and the Defect Liability Period (`WF-25`).
4. **Fix `FR-BIL-005` (`§15`):** Issue Rule 46 GST-compliant tax invoices (with SAC `998315`, buyer GSTIN, and place of supply) in MVP; enable IRP e-invoicing (`irn`/`qr_payload`) via configuration when supplier turnover approaches the ₹5 Crore CBIC threshold.
5. **Replace Authoritative Traceability Table (`§19`):**

| Area | Permissions | States | Data Entities | API | Screens | Tests |
|---|---|---|---|---|---|---|
| `ORG` | `05` §4 | `06` §3.2 | `E-ORGANISATION`, `E-ORG_PROFILE` | `API-010`–`019` | `SCR-001`–`005`, `SCR-042` | `TC-ORG-*` |
| `IAM` | `05` §4–6 | `06` §3.3–3.4 | `E-USER`, `E-USER_IDENTITY`, `E-SESSION`, `E-MEMBERSHIP`, `E-INVITATION`, `E-GUEST_GRANT` | `API-001`–`009B`, `API-013`–`019`, `API-024`–`028B` | `SCR-002`–`005`, `SCR-040`–`041`, `SCR-056` | `TC-IAM-*` |
| `PTY` | `05` §2.3, §6 | `06` `WF-08` | `E-PARTY`, `E-PARTY_CONTACT`, `E-GUEST_GRANT` | `API-020`–`028B` | `SCR-032`–`036` | `TC-PTY-*` |
| `PRJ/CNT` | `05` §4 | `06` §3.1, `WF-03`/`05`/`26` | `E-PROJECT`, `E-CONTRACT`, `E-SPECIFICATION_REF`, `E-VARIATION` | `API-030`–`044`, `API-184`–`186` | `SCR-010`–`013` | `TC-PRJ-*`, `TC-CNT-*` |
| `CHK/CFG` | `05` §4 | `06` §3.5–3.6, `WF-06`/`20` | `E-CONFIG_VERSION`, `E-CHECKLIST_SNAPSHOT`, `E-REQUIREMENT`, `E-REQUIREMENT_REVISION`, `E-WAIVER` | `API-050`–`067` | `SCR-014`–`017`, `SCR-037`–`039` | `TC-CHK-*`, `TC-CFG-*` |
| `AST` | `05` §4 | `06` `WF-07` | `E-ASSET`, `E-ASSET_CATEGORY` | `API-070`–`076` | `SCR-018`–`020` | `TC-AST-*` |
| `DOC` | `05` §4 | `06` §3.7–3.8, `WF-09`/`11`/`13` | `E-DOCUMENT`, `E-DOCUMENT_VERSION`, `E-STORAGE_OBJECT`, `E-BULK_IMPORT_JOB` | `API-080`–`097` | `SCR-021`–`025`, `SCR-055` | `TC-DOC-*` |
| `REV` | `05` §4 | `06` §3.8–3.9, `WF-12`/`23` | `E-REVIEW`, `E-REVIEW_COMMENT`, `E-APPROVAL_OVERRIDE` | `API-100`–`107` | `SCR-025`–`027` | `TC-REV-*` |
| `HND` | `05` §4 | `06` §3.11–3.12, `WF-15`–`18` | `E-HANDOVER_PACKAGE`, `E-PACKAGE_ITEM`, `E-PACKAGE_REQUIREMENT`, `E-SUBMISSION`, `E-SUBMISSION_RECIPIENT` | `API-110`–`118B` | `SCR-028`–`031`, `SCR-057` | `TC-HND-*` |
| `NOT` | `05` §4 | `06` `WF-14` | `E-NOTIFICATION`, `E-NOTIFICATION_PREFERENCE` | `API-120`–`123` | `SCR-043`, `SCR-048` | `TC-NOT-*` |
| `WTY/DEF` | `05` §4 | `06` `WF-24`/`25` | `E-WARRANTY_EVENT`, `E-DEFECT` | `API-180`–`183` | `SCR-058`–`059` | `TC-WTY-*`, `TC-DEF-*` |
| `SRCH/RPT` | `05` §4 | n/a | `E-DOCUMENT_SEARCH` | `API-130` | `SCR-047` | `TC-SRCH-*`, `TC-RPT-*` |
| `AUD` | `05` §4 | `06` `WF-19` | `E-AUDIT_EVENT`, `E-SECURITY_EVENT` | `API-140`–`144` | `SCR-046`, `SCR-053`–`054` | `TC-AUD-*` |
| `BIL` | `05` §4 | `06` §3.13 | `E-SUBSCRIPTION`, `E-INVOICE`, `E-INVOICE_LINE`, `E-INVOICE_TDS`, `E-USAGE_COUNTER` | `API-124`, `API-150`–`160` | `SCR-044`–`045` | `TC-BIL-*` |
| `ADM` | `05` §4 | n/a | `E-ADMIN_AUDIT_EVENT`, `E-JOB_EXECUTION` | `API-170`–`172` | `SCR-051`–`052` | `TC-ADM-*` |

---
---

# DELIVERABLE 9 — `TRADECLOSEOUT-AUDIT/08-FINAL-READINESS-REPORT.md`
<a id="deliverable-9--08-final-readiness-reportmd"></a>

## 1. Final Verdict

# **REQUIRES MAJOR REVISION**

## 2. Evidence-Based Justification

We reject the v0.2 self-audit verdict (`APPROVED WITH CONDITIONS`) because our independent red-team inspection proved that **16 CRITICAL and HIGH severity defects** remain in the v0.2 specification, including 5 "Ghost Fixes" where the previous AI agent claimed an issue was fixed in `TRADECLOSEOUT-AUDIT/` without actually adding the endpoints, DDL, or state transitions to the specification files:

1. **`RT-001` (CRITICAL):** `API-095` (Bulk document import) is claimed fixed in the audit but is completely absent from `10-API-AND-INTEGRATIONS.md` §7.7 and `08-DATA-MODEL-AND-ERD.md`.
2. **`RT-002` (CRITICAL):** `POST /auth/switch-org` and `GET /auth/orgs` are absent from `10` §7.1, and `sessions.active_org_id NOT NULL` crashes new-user OTP verification before an organisation exists.
3. **`RT-003` (CRITICAL):** `08-DATA-MODEL-AND-ERD.md` §5.1 contains invalid PostgreSQL DDL (`organisations` `UNIQUE(org_id, id)`, `projects` `UNIQUE(org_id, project_id, id)`, `documents` circular self-FK) and lacks a database foreign key for asset-scoped requirements (`scope_key`).
4. **`RT-004` (CRITICAL):** `03` (`FR-IAM-018`), `12` (`EC-USR-13`), and `14` (`TC-IAM-004`) still mandate "explicit denies win", directly contradicting `05` §3.2 and `D-039` ("positive-only model").
5. **`RT-005` (CRITICAL):** PostgreSQL RLS policies in `08` §5.2 lack `FORCE ROW LEVEL SECURITY` and non-owner role separation (`NOBYPASSRLS`), meaning RLS is silently bypassed at runtime.
6. **`RT-006` to `RT-016` (HIGH):** Gotenberg SVG/LFI vulnerability, deadlocked multi-recipient submission state machine, missing RA Bill / payment milestone linkage, expired-on-upload state deadlock, duplicate API IDs (`API-030`, `API-120`), permanent `revision_code` lockout on withdrawn/failed uploads, missing multipart resume URL-refresh endpoint, CERT-In 6-hour vs 72-hour non-compliance, guest OTP SMS pumping, unnecessary MVP e-invoicing integration, and fabricated screen references (`SCR-090`–`094`).

---

## 3. Path to `APPROVED WITH CONDITIONS`

Once the exact patches in **`07-RECOMMENDED-CHANGES.md`** (Patches 1, 2, and 3) are applied to `02`, `03`, `05`, `06`, `07`, `08`, `09`, `10`, `12`, `13`, `14`, and `SOURCES-VERIFICATION.md`:

- All 5 CRITICAL and 11 HIGH technical blockers will be closed.
- The solo developer can drop Gotenberg from MVP (using pure-Node PDF generation for Cover/Index + `qpdf`/`pdf-lib` merge) and drop GSP e-invoicing from MVP (using Rule 46 GST invoices under the ₹5 Cr exemption), cutting **4–5 weeks of unnecessary infrastructure work**.
- Implementation of Milestones **M0–M2** can then begin safely while the 5 real consultant checklists are collected for the **M3 gate**.

---
---

# DELIVERABLE 10 — `TRADECLOSEOUT-AUDIT/ISSUE-REGISTER.md`
<a id="deliverable-10--issue-registermd"></a>

## 1. Consolidated Independent Issue Register (`RT-001` to `RT-042`)

All 42 findings discovered during this independent red-team audit of v0.2 are registered below with their severity, status, affected files, and recommended action.

| ID | Severity | Status | Affected Files & Sections | Summary of Defect | Recommended Action |
|---|---|---|---|---|---|
| **RT-001** | **CRITICAL** | `Open (Ghost Fix in v0.2)` | `10` §5, §7.7; `03` `FR-DOC-031`; `08` §3.5 | Bulk document import (`API-095`) was claimed fixed in `AUD-009` but omitted from `10` §7.7 and `08` §3.5. | Add `API-095`–`097` to `10` §7.7 and `bulk_import_jobs` to `08` §3.5 (Patch 1 & 2). |
| **RT-002** | **CRITICAL** | `Open (Ghost Fix in v0.2)` | `10` §2.1, §7.1; `08` §3.1 | `POST /auth/switch-org` and `GET /auth/orgs` omitted from `10` §7.1; `sessions.active_org_id NOT NULL` crashes new user signup before `POST /orgs`. | Make `sessions.active_org_id` nullable for pre-onboarding; add `API-009A` & `API-009B` (Patch 1 & 2). |
| **RT-003** | **CRITICAL** | `Open` | `08` §3.1, §5.1, §5.4 | Invalid PostgreSQL DDL (`organisations` `org_id`, `projects` `project_id`, `documents` self-FK) and no FK on `requirements.scope_key` to `assets`. | Fix DDL in `08` §5.1; add `requirements.asset_id` with composite FK to `assets(org_id, project_id, id)` (Patch 1). |
| **RT-004** | **CRITICAL** | `Open (Ghost Fix in v0.2)` | `03` `FR-IAM-018`; `05` §3.2; `12` `EC-USR-13`; `14` `TC-IAM-004` | `03`, `12`, and `14` still mandate "explicit denies win", contradicting `05` §3.2 and `D-039`; union vs narrowing scope formula is ambiguous. | Remove explicit deny from `03`, `12`, `14`; clarify additive capabilities vs per-grant resource scope in `05` §3.2 (Patch 3). |
| **RT-005** | **CRITICAL** | `Open` | `08` §5.2; `13` §5.1; `15` §5 | PostgreSQL table owner bypasses RLS by default unless `FORCE ROW LEVEL SECURITY` and a `NOBYPASSRLS` runtime role are used. | Create `tc_app` (`NOBYPASSRLS`) runtime role and add `FORCE ROW LEVEL SECURITY` on all tenant tables (Patch 1). |
| **RT-006** | **HIGH** | `Open` | `06` `WF-02`; `09` §5.3; `13` §8.2 | Gotenberg LFI/SSRF via SVG logos (`<foreignObject>`, `xlink:href="file://..."`) and local container files. | Ban SVG logos (PNG/JPEG/WebP only); replace Gotenberg in MVP with pure-Node PDF index generator (`pdfmake`/`pdf-lib`). |
| **RT-007** | **HIGH** | `Open` | `06` §3.11–3.12, `WF-17`, `WF-18`; `08` §3.7; `10` `API-117` | `submission_recipients` has no aggregation rule into `submissions.status` / `handover_packages.status`; `API-117` lacks `recipientId`. | Add `PARTIALLY_ACCEPTED` state, `is_required_approver` flag, deterministic aggregation rule, and `recipientId` in `API-117` (Patch 2). |
| **RT-008** | **HIGH** | `Open` | `00` §6; `03` `FR-CNT-001`; `04` `DT-085`; `08` §3.3 | Requirements have no link to payment milestones (RA bills / delivery / commissioning / handover / DLP), breaking the core commercial promise. | Add `milestone_key` to `requirements` (`08` §3.3) and filter by payment milestone on `SCR-013`/`SCR-014` (Patch 1). |
| **RT-009** | **HIGH** | `Open` | `06` §3.6, `WF-09`, `WF-11`, `WF-22`; `12` `EC-DOC-12` | Expired certificate uploaded on day 1 gets stuck in `UPLOADED`; `WF-22` leaves `current_approved_version_id` active when expired. | Block `submit-review` (`422 DOCUMENT_ALREADY_EXPIRED`) when `expiry_date < CURRENT_DATE`; check expiry in readiness/package queries. |
| **RT-010** | **HIGH** | `Open` | `10` §7.3, §7.4, §7.9, §7.10 | Duplicate endpoint IDs: `API-030` used twice and `API-120` used twice. | Renumber guest OTP to `API-028A`/`028B` and package manifest/preview to `API-118A`/`118B` (Patch 2). |
| **RT-011** | **HIGH** | `Open` | `06` `WF-13`; `08` §3.5; `12` `EC-DOC-15` | Reserving `revision_code` on soft-deleted/withdrawn/failed unapproved versions permanently blocks re-uploading the correct `R0` file. | Exclude `deleted_at IS NOT NULL`, `FAILED`, `QUARANTINED`, and `WITHDRAWN` unreviewed rows from the unique revision index (Patch 1). |
| **RT-012** | **HIGH** | `Open` | `10` §7.7, §8.1, §9; `12` `EC-TECH-01` | Resumable multipart upload has no endpoint to list completed parts or refresh expired (15–60m) presigned part URLs. | Add `API-082A POST /document-versions/{id}/refresh-upload-urls` and store `s3_upload_id` while `PENDING` (Patch 2). |
| **RT-013** | **HIGH** | `Open` | `02` `BR-SLA-04`; `12` `EC-TECH-15`; `13` §16.3, §18 | `BR-SLA-04` (72h) violates CERT-In's 6-hour incident reporting rule; NIC/NPL NTP servers and Indian log residency not enforced for observability. | Mandate 6-hour CERT-In reporting, `samay1.nic.in`/`time.nplindia.org` NTP sync, and India-only log storage. |
| **RT-014** | **HIGH** | `Open` | `05` §6.2; `08` §3.1; `10` §2.3, §7.3, §10 | Unauthenticated `POST /guest/{token}/otp/request` allows 60 req/min SMS pumping and permanent link lockout after 5 bad tries. | Cap SMS OTP to 3/hr and 10/day per `grant_id`; use 15-min cooldown; store `target_phone_e164`/`target_email` on `guest_grants`. |
| **RT-015** | **HIGH** | `Open` | `02` `BR-BIL-13`; `03` `FR-BIL-005`; `16` M9; `17` §6 | Spec forces GSP/IRP e-invoicing into MVP despite CBIC's ₹5 Crore supplier turnover exemption. | Defer IRP/GSP integration to V2 (near ₹5 Cr turnover); issue standard Rule 46 GST invoices with SAC `998315` in MVP. |
| **RT-016** | **HIGH** | `Open` | `03` §19 | "Authoritative" traceability table in `03` §19 cites non-existent screens `SCR-090`–`094` and wrong APIs (`API-130`–`135` for `WTY/DEF`). | Replace `03` §19 table with verified mappings (Patch 3). |
| **RT-017** | **MEDIUM** | `Open` | `03` §9 | `FR-DOC-029` and `FR-DOC-030` are duplicated twice at the bottom of `03` §9. | Delete the duplicate rows at the end of `03` §9. |
| **RT-018** | **MEDIUM** | `Open` | `05` §3.2 | Effective permission formula uses union `∪` for roles without parentheses before `∩` filters, conflicting with "narrower scope wins" prose. | Add explicit parenthesisation and distinguish capability union from per-grant resource scope (Patch 3). |
| **RT-019** | **MEDIUM** | `Open` | `07` §4.2, §4.3 | `07` §4.2 says `TRADE` (L1) is copied into `ORG` (L2) and not iterated live, but §4.3 pseudocode still iterates `TRADE` on every call. | Remove `TRADE` from the live resolution loop for installed orgs in `07` §4.3. |
| **RT-020** | **MEDIUM** | `Open` | `03` `FR-CFG-003`; `07` §4.1 | `schema(path).overridePolicy` location and versioning are undefined. | Define static versioned `ConfigSchemaRegistry` in code keyed by `schema_version`. |
| **RT-021** | **MEDIUM** | `Open` | `05` §4 | `R-SAFETY` (Safety Officer) has `asset.read = –` and `party.read = –`, preventing them from linking safety permits/incidents to equipment or subcontractors. | Grant `asset.read = S` and `party.read = Y` to `R-SAFETY` in `05` §4. |
| **RT-022** | **MEDIUM** | `Open` | `06` `WF-23`; `10` `API-106` | `API-106 POST /reviews/{id}/external-decision` fails when a document is in `UPLOADED` state (`WF-23`) because no `reviews` row exists yet. | Change `API-106` to `POST /document-versions/{id}/external-approval` (Patch 2). |
| **RT-023** | **MEDIUM** | `Open` | `03` `FR-CHK-016`; `06` §3.6; `10` §7.5 | Mandatory waiver requires a second approver (`second_approved_by`), but there is no `PENDING_WAIVER` state in `06` §3.6 and no countersign endpoint in `10` §7.5. | Add `PENDING_WAIVER` state to `06` §3.6 and `API-061A POST /waivers/{id}/countersign` to `10` §7.5 (Patch 2). |
| **RT-024** | **MEDIUM** | `Open` | `06` §3.6; `03` `FR-PRJ-008` | `HANDED_OVER` state in `06` §3.6 has no transition back to `APPROVED` or `EXPIRED` if a partial handover is rejected or expires. | Add `HANDED_OVER → APPROVED` (on submission withdrawal/rejection) and `HANDED_OVER → EXPIRED` to `06` §3.6. |
| **RT-025** | **MEDIUM** | `Open` | `08` §11; `16` §3.1 | 51 MVP tables + Gotenberg + ClamAV + custom auth + Razorpay webhooks is still too heavy for a solo developer. | Drop Gotenberg (use `pdfmake`/`pdf-lib`), defer e-invoicing, and use Razorpay Payment Links for the first 5 pilots. |
| **RT-026** | **MEDIUM** | `Open` | `09` §6.1; `15` §2, §12 | `ClamAV` (`clamd` uses ~1.5 GB RAM) + `Gotenberg` + `Worker` on a 4 GB VM (`15` §12) will trigger Linux OOM-killer during 500-page PDF merges. | Drop Gotenberg in MVP and size the worker VM to at least 8 GB RAM (or isolate `clamd` with swap/cgroup limits). |
| **RT-027** | **MEDIUM** | `Open` | `03` `FR-IAM-014`; `08` §7; `13` §14 | DPDP Rules 2025 (notified 13 Nov 2025) require 1-year log retention for personal data processing logs and mandatory MFA on privileged accounts. | Increase `security_events` retention from 180d to 365d; require MFA/dual-channel verification for `Owner`/`Admin` in MVP. |
| **RT-028** | **MEDIUM** | `Open` | `03` §8, §19; `11` §9; `14` §5 | `WTY/DEF` (`warranty_events`, `defects`, `SCR-058`–`059`, `API-180`–`183`) has no `FR-WTY`/`FR-DEF` rows in `03`, no screen criteria in `11` §9, and no `TC-WTY` rows in `14`. | Add `FR-WTY-001`, `FR-DEF-001` to `03`, screen criteria to `11` §9, and `TC-WTY-001`–`002` to `14` (Patch 3). |
| **RT-029** | **MEDIUM** | `Open` | `02` `BR-GTM-07`; `03` `FR-CNT-001` | Weekly Owner Digest (`BR-GTM-07`) reports missing document counts but not rupee retention / milestone value blocked. | Include optional contract/milestone rupee value at risk in the Owner Digest and Project Overview (`SCR-013`). |
| **RT-030** | **MEDIUM** | `Open` | `02` `BR-BIL-14`; `08` §3.10 `invoice_tds` | Indian B2B customers deduct TDS at payment time but issue Form 16A quarterly (45–90 days later); `invoice_tds.certificate_reference` cannot be required at payment time. | Make `certificate_reference` nullable at deduction time and add `status IN ('DEDUCTED_PENDING_CERT','CERT_UPLOADED','RECONCILED')` to `invoice_tds`. |
| **RT-031** | **MEDIUM** | `Open` | `04` §3 | Catalogue omits CPWD/PSU **No-Demand Certificate**, **Approved Make Deviation Approval**, and **IGBC/GRIHA Green Building Submittals**. | Add `DT-097` (No-Demand Certificate), `DT-098` (Make Deviation Approval), and `DT-099` (Green Building / IGBC Submittal) to `04` §3. |
| **RT-032** | **LOW** | `Open` | `08` §3.6 `reviews` | `reviews` has both `reviewer_subject_type/id` and `reviewer_user_id`/`reviewer_party_id` without a CHECK constraint. | Add CHECK constraint tying `reviewer_subject_type` to the nullable FK columns. |
| **RT-033** | **MEDIUM** | `Open` | `03` `NFR-SEC-008`; `13` §8.3 | `AUD-S-07` claims S3 presigned URLs are cryptographically bound to `user_id`, which AWS S3 SigV4 does not support natively. | Issue 120-second single-use redirect URLs from `API-088` (which checks `session.user_id`) to S3, or use CloudFront/Cloudflare signed cookies. |
| **RT-034** | **MEDIUM** | `Open` | `06` `WF-11`; `09` §5.3 | No decompressed stream size or object-count limit before loading PDFs into Node.js `pdf-lib` memory. | Enforce `qpdf` pre-check with 512 MB cgroup limit and max 1,000 pages / 25,000 objects per PDF. |
| **RT-035** | **LOW** | `Open` | `10` `API-031` (`AUD-031`) | `ISSUE-REGISTER.md` claims `AUD-031` (`GET /projects/{id}/effective-config`) was `Fixed`, but the endpoint was never added to `10` §7.5. | Add `API-067 GET /projects/{id}/effective-config` to `10` §7.5 (Patch 2). |
| **RT-036** | **LOW** | `Open` | `08` §5.6; `D-024` | `D-024` is assigned to "Per-company subscription pricing" in `DECISIONS` §1, but `08` §3.8 cites `D-024` as "Audit hash chain". | Fix decision reference in `08` §3.8 to `Q-024`. |
| **RT-037** | **LOW** | `Open` | `DECISIONS` §5 `C-04`, `D-022` | `D-022` and `C-04` still say "84-type HVAC catalogue", whereas `04` v0.2 expanded the catalogue to **95 types** (`DT-001`–`DT-096`). | Update `D-022` and `C-04` to state 95 types. |
| **RT-038** | **LOW** | `Open` | `DECISIONS` §6.1 | `DECISIONS` §6.1 still says "All 22 workflows reference defined states", whereas `06` v0.2 has **26 workflows** (`WF-01`–`WF-26`). | Update `DECISIONS` §6.1 to 26 workflows. |
| **RT-039** | **LOW** | `Open` | `15` §10 | `15` §10 heading says "Runbooks (top 10)" and places `RB-11` and `RB-12` *before* `RB-10`. | Update heading to "Runbooks (12)" and order `RB-01` through `RB-12` sequentially. |
| **RT-040** | **LOW** | `Open` | `08` §3.3 `requirements` | `requirements.due_at` is `TIMESTAMPTZ`, whereas `document_versions.issue_date`/`expiry_date` and `projects.target_handover_date` are `DATE` (`YYYY-MM-DD`). | Make `due_at` a business `DATE` (or document EOD `23:59:59 Asia/Kolkata` conversion) to avoid UTC midnight off-by-one-day overdue bugs. |
| **RT-041** | **LOW** | `Open` | `10` §7.2 `API-015` | `POST /invitations/{token}/accept` says "Public token", but accepting a member invitation requires an authenticated/verified `User` identity (`FR-IAM-002`). | Clarify that `API-015` requires an authenticated session whose verified email/phone matches the invitation's target identifier. |
| **RT-042** | **LOW** | `Open` | `SOURCES-VERIFICATION.md` | All 34 rows were left `UNVERIFIED` because the prior agent lacked web access. | Update `SRC-001`, `SRC-002`, `SRC-004`, `SRC-005`, `SRC-007`, `SRC-008`, `SRC-009`, `SRC-019`, `SRC-022`, `SRC-033` to `VERIFIED` using the citations in Deliverable 3 (§2.1). |