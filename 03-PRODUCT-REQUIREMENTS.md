# 03 — Product Requirements

**Status:** Draft v0.2 — authoritative for behaviour
**Change history:** v0.2 applies remediation of `TRADECLOSEOUT-AUDIT` findings (SMS/OTP, external approval, bulk import, evidence model, permission scoping, e-invoice/TDS, vague-requirement rewrites).
**Change control:** see `README.md` §6
**Companion documents:** `05` permissions, `06` states, `07` configuration, `08` data, `10` API, `11` UI, `14` tests

---

## 1. Purpose and scope

This document defines the functional and non-functional requirements for TradeCloseout. Each requirement has a stable ID, a priority and a phase. Behaviour is defined precisely enough to implement without guessing; unresolved behaviour is marked and linked to `Q-###`.

### 1.1 Priority and phase

| Code | Meaning |
|---|---|
| **M** | Must — MVP cannot ship without it |
| **S** | Should — required for reliable commercial use (V1) |
| **C** | Could — valuable but deferrable (V2 or later) |

Phase values: `MVP`, `V1`, `V2`, `Later`.

### 1.2 Requirement status

`Confirmed` (accepted), `Proposed` (recommended, changeable), `Unresolved` (see open question). Default is Confirmed unless stated.

### 1.3 Out of scope

ERP, payroll, inventory, BIM authoring, structural/civil closeout, payment escrow, Aadhaar identity, native mobile apps, on-premise deployment, full accounting. See `00` §8.4.

## 2. Domain objects

The product operates on these objects. Canonical definitions are in `README.md` §4.5; schema is in `08`.

`Organisation`, `User`, `Membership`, `Invitation`, `Party`, `Project`, `ProjectMember`, `Contract`, `SpecificationRef`, `ChecklistTemplate`, `ChecklistSnapshot`, `Requirement`, `Asset`, `Document`, `DocumentVersion`, `Review`, `Waiver`, `HandoverPackage`, `Submission`, `Notification`, `AuditEvent`, `Plan`, `Subscription`, `Invoice`.

## 3. Organisation and onboarding (`FR-ORG`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ORG-001 | A visitor can register an Organisation with legal name, display name, trade, country (default India), state and an owner user. | M | MVP |
| FR-ORG-002 | Registration accepts email or Indian mobile (+91) as identity; at least one verified channel is required. | M | MVP |
| FR-ORG-003 | On first login the owner is guided through a 4-step setup: company profile → trade pack → first project → invite team. Setup is skippable and resumable. | M | MVP |
| FR-ORG-004 | Company profile supports: legal name, display name, entity type (Proprietorship/Partnership/LLP/Private Limited/Public Limited/Other), GSTIN (optional), PAN (optional), address, state, logo, authorised signatory name/designation, contact email/phone. | M | MVP |
| FR-ORG-005 | GSTIN is validated structurally (15 characters, state code, checksum) when entered; failure blocks save with a specific message. | S | V1 |
| FR-ORG-006 | PAN is validated structurally (10 characters) when entered. | S | V1 |
| FR-ORG-007 | Org can configure branding (logo, accent colour, footer text, signatory) used on generated indexes and package covers. | M | MVP |
| FR-ORG-008 | Org can invite members by email or mobile; invitations expire after 7 days and can be revoked. | M | MVP |
| FR-ORG-009 | Org can be suspended for non-payment or policy violation; suspension blocks writes but preserves read access and exports. | M | MVP |
| FR-ORG-010 | Org can request deletion; an owner must confirm by typing the org name; deletion follows retention policy. | M | MVP |
| FR-ORG-011 | Org supports multiple concurrent projects and multiple legal signatories. | M | MVP |
| FR-ORG-012 | Org can set default time zone (IST), date format, language and notification preferences. | M | MVP |
| FR-ORG-013 | Org can register multiple branches/GSTINs for invoicing; the billing profile is separate from project data. | C | V2 |
| FR-ORG-014 | Org can transfer ownership to another active member; both parties confirm; audit event recorded. | S | V1 |

## 4. Identity, access and membership (`FR-IAM`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-IAM-001 | A User is a global identity that can belong to multiple Organisations with different roles. | M | MVP |
| FR-IAM-002 | Authentication supports email magic link and mobile OTP delivered by an SMS provider (`FR-INT-012`). Password login is not required in MVP. If SMS fails after 2 attempts the system falls back to email magic link; if neither channel is verified, account creation is blocked with a clear message. | M | MVP |
| FR-IAM-003 | Sessions use secure, HttpOnly, SameSite cookies; idle timeout 30 days; revocation on role removal. | M | MVP |
| FR-IAM-004 | Every Org has exactly one active Owner at any time. Ownership transfer is atomic. | M | MVP |
| FR-IAM-005 | Roles are assigned per Organisation and optionally scoped per Project. | M | MVP |
| FR-IAM-006 | A user can hold different project roles on different projects within the same Org. | M | MVP |
| FR-IAM-007 | Members can be suspended or removed; access is revoked within 60 seconds across sessions. | M | MVP |
| FR-IAM-008 | Open work owned by a departing member can be reassigned in bulk by an admin. | M | MVP |
| FR-IAM-009 | Guests (suppliers, client reps, external reviewers) are project-scoped and cannot enumerate other projects, parties or members. | M | MVP |
| FR-IAM-010 | Guest invitations are single-use, expiring, revocable links bound to a verified email or mobile. | M | MVP |
| FR-IAM-011 | Upload-only access is supported for suppliers: they can upload to assigned requirements but cannot browse the project. | M | MVP |
| FR-IAM-012 | Review and approval permissions are separate from upload permissions. | M | MVP |
| FR-IAM-013 | Delegation allows a member to assign review responsibilities temporarily to another eligible member, with start/end and audit. | S | V1 |
| FR-IAM-014 | An org can require MFA for owner/admin roles. | S | V1 |
| FR-IAM-015 | SSO (Google/Microsoft) is supported for member login. | C | V2 |
| FR-IAM-016 | API access uses scoped tokens; tokens are hashed at rest, revocable and expiring. | C | V2 |
| FR-IAM-017 | All permission denials are logged with actor, resource, action and reason. | M | MVP |
| FR-IAM-018 | A member's effective permissions are computed via the positive-only model (`05` §3.2): capabilities are the union of org role and project role, scoped to the target project/resource, and gated by `requirements.reviewer_role` for review decisions (`RT-004`). | M | MVP |

## 5. Parties and suppliers (`FR-PTY`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PTY-001 | Org maintains a Party directory with type(s): Client, Main Contractor, Consultant, Supplier, Manufacturer, Sub-subcontractor, Other. | M | MVP |
| FR-PTY-002 | A Party has name, type, contact person, email, phone, GSTIN (optional), address, notes, status. | M | MVP |
| FR-PTY-003 | The same organisation can appear as multiple Party types and on multiple projects. | M | MVP |
| FR-PTY-004 | Parties can be invited to a Project as Guests with a role and scope. | M | MVP |
| FR-PTY-005 | A Supplier can be assigned to one or more Requirements; they see only those assignments. | M | MVP |
| FR-PTY-006 | Supplier upload links can be generated without the supplier having an account, and can be sent via WhatsApp or email. | M | MVP |
| FR-PTY-007 | Supplier link access expires (default 30 days, configurable), is single-purpose and revocable. | M | MVP |
| FR-PTY-008 | Org can record supplier performance notes (response time, rejection rate) for internal use. | C | V2 |
| FR-PTY-009 | Duplicate Party detection suggests matches on GSTIN, email or normalised name. | S | V1 |
| FR-PTY-010 | Parties are org-owned and never visible to another tenant. | M | MVP |

## 6. Projects and contracts (`FR-PRJ`, `FR-CNT`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRJ-001 | A Project has: code (unique per Org), name, client Party, main contractor Party (optional), consultant Party (optional), site address, city, state, start date, target handover date, contract value (optional), currency (INR default), status. | M | MVP |
| FR-PRJ-002 | Project status follows `06` §3.1. New projects start `DRAFT`. | M | MVP |
| FR-PRJ-003 | A Project becomes `ACTIVE` only when it has a checklist snapshot and at least one project member with a managing role. | M | MVP |
| FR-PRJ-004 | Project code is immutable after activation; name and dates remain editable with audit. | M | MVP |
| FR-PRJ-005 | A Project can be suspended with reason; suspension blocks uploads/reviews but preserves reads and exports. | M | MVP |
| FR-PRJ-006 | A Project can be cancelled with reason; cancellation is terminal except archival and legal hold. | M | MVP |
| FR-PRJ-007 | A Project can be reopened from `CLOSED` to `ACTIVE` with reason, incrementing a reopen counter and preserving history. | S | V1 |
| FR-PRJ-008 | A Project supports partial handover: selected assets/requirements are packaged, recorded in a `handover_scope`, and their requirements are marked `HANDED_OVER` while the project remains active. | S | V1 |
| FR-PRJ-009 | Project dashboard shows requirement counts by status, overdue items, unassigned items, expiring certificates and activity from the last 14 days (maximum 20 items). | M | MVP |
| FR-PRJ-010 | Project settings include default reviewer, reminder schedule, naming convention and package layout. | M | MVP |
| FR-PRJ-011 | Project access is granted per member; org admins and owners have access to all projects by default. | M | MVP |
| FR-PRJ-012 | A project can reference multiple contracts/work orders (e.g., original + variation). | S | V1 |
| FR-PRJ-013 | A project can be duplicated as a template for a new project, copying checklist structure, assets (optional) and settings, never documents. | S | V1 |
| FR-PRJ-014 | Archival makes a project read-only and excludes it from active limits, retaining all data. | M | MVP |
| FR-CNT-001 | A Contract records: reference, type (Item rate/Percentage rate/Lump sum/EPC/Other), date, value, retention %, defect liability period (months), warranty terms, payment milestones, client, main contractor. | M | MVP |
| FR-CNT-002 | A Contract can link Specification References that drive requirements. | M | MVP |
| FR-CNT-003 | Contract value and retention are informational; the product does not compute payments. | M | MVP |
| FR-CNT-004 | Contract documents can be uploaded and linked, with versioning. | M | MVP |
| FR-CNT-005 | A Specification Reference records title, issuer, revision, date, file (optional) and notes. | M | MVP |
| FR-CNT-006 | Multiple contracts can be active on one project; the project shows a contract register. | S | V1 |

## 7. Configuration and checklists (`FR-CFG`, `FR-CHK`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-CFG-001 | Configuration resolves in order: Platform → Trade template → Org → Client/Contract profile → Project. | M | MVP |
| FR-CFG-002 | More-specific levels override less-specific levels; locked values cannot be overridden. | M | MVP |
| FR-CFG-003 | Array items merge by stable key; scalar values use most-specific non-null. **Additive** fields are declared in the schema with `overridePolicy: additive` and union without duplicates; unkeyed arrays replace unless marked additive. | M | MVP |
| FR-CFG-004 | Every configuration set is versioned; changes create a new version with author and timestamp. | M | MVP |
| FR-CFG-005 | Org admins can create custom document types, categories, custom fields, requirement groups and naming rules. | S | V1 |
| FR-CFG-006 | Trade templates can be installed, previewed and customised without affecting existing projects. | M | MVP |
| FR-CFG-007 | Project-level overrides are allowed only before activation, or through a change request after activation. | M | MVP |
| FR-CFG-008 | Configuration resolution is previewable before applying. | S | V1 |
| FR-CFG-009 | Configuration changes that affect active projects require a change request with impact analysis. | M | MVP |
| FR-CFG-010 | Approval workflows (sequential/parallel stages, approver roles, SLAs) are configurable. | S | V1 |
| FR-CFG-011 | Reminder schedules, escalation, naming conventions, folder structure and package layout are configurable. | M | MVP (subset), S (full) |
| FR-CFG-012 | Language packs are data, not code; English is default, Hindi is V1. | S | V1 |
| FR-CHK-001 | A Checklist Template contains groups, requirements, applicability rules and default owners. | M | MVP |
| FR-CHK-002 | Requirement fields include: title, description, document type, category, mandatory flag, evidence count, asset scope (project/asset/asset-category), default owner role, reviewer role, due offset, validity period, naming rule, reuse policy. | M | MVP |
| FR-CHK-003 | Applicability rules can depend on trade, project type, client type, equipment category, contract clause and custom fields. | S | V1 |
| FR-CHK-004 | On project activation, a Checklist Snapshot is created and bound to the project; it is immutable. | M | MVP |
| FR-CHK-005 | The snapshot records template version, resolved configuration, rule evaluations and item-level provenance. | M | MVP |
| FR-CHK-006 | Users can mark a requirement `NOT_APPLICABLE` with a reason; mandatory items require an approver role. | M | MVP |
| FR-CHK-007 | Users can `WAIVE` a requirement with reason, evidence and approver; waived items appear in the handover package as waived. | M | MVP |
| FR-CHK-008 | Changing a snapshot after activation requires a Change Request with reason, affected items, approver and effective date. | M | MVP |
| FR-CHK-009 | Approved change requests create a new snapshot version; prior versions remain retrievable. | M | MVP |
| FR-CHK-010 | Requirements can be assigned to a member, a Party, or left unassigned. A requirement with `due_at IS NULL` is never `MISSING`; it appears as `NOT_STARTED` and is excluded from overdue reminders. | M | MVP |
| FR-CHK-011 | **(MVP: one evidence document per requirement.)** A requirement is satisfied by exactly one approved document version of the matching `doc_type_key`, or by a waiver. Multi-evidence needs are modelled as separate requirements. A future `requirement_evidence_slots` model generalises this in V1. | C | V2 |
| FR-CHK-012 | A requirement can be satisfied by a document reused from another project only if reuse is permitted and the user confirms project/asset applicability. | S | V1 |
| FR-CHK-013 | Checklist progress is computed from applicable, non-waived requirements with an approved evidence set. | M | MVP |
| FR-CHK-014 | Templates can be exported/imported as structured JSON/CSV for authoring. | S | V1 |
| FR-CHK-015 | The system ships a curated HVAC template pack (see `04`). **The default item set is a hypothesis pending validation against five real consultant/contractor checklists** and must not be marketed as comprehensive. | M | MVP |
| FR-CHK-016 | Waiving or marking `NOT_APPLICABLE` a **mandatory** requirement requires a second approver and a reason; the decision is recorded in the handover package as waived. | M | MVP |

## 8. Assets and equipment (`FR-AST`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-AST-001 | An Asset has: tag (unique per project), name, category, make, model, serial number, location, capacity, refrigerant (optional), installation date, warranty start/end, status, notes. | M | MVP |
| FR-AST-002 | Asset categories are configurable and include a curated HVAC set (chiller, AHU, FCU, VRF outdoor/indoor, pump, cooling tower, duct system, VAV, BMS, etc.). | M | MVP |
| FR-AST-003 | Assets can be created manually or imported from CSV/Excel with a validated template and error report. | M | MVP |
| FR-AST-004 | Asset tag uniqueness is enforced per project, case-insensitively after normalisation. | M | MVP |
| FR-AST-005 | Assets can be linked to requirements; asset-scoped requirements are instantiated per asset according to snapshot rules. | M | MVP |
| FR-AST-006 | Assets support replacement: old asset is marked `REPLACED`, linked to successor, and documents remain with the old asset. | S | V1 |
| FR-AST-007 | Asset QR labels can be generated and printed (V1) for site identification. | C | V2 |
| FR-AST-008 | Asset deletion is soft; assets with approved documents cannot be hard-deleted. | M | MVP |
| FR-AST-009 | Asset register is exportable to Excel/CSV. | M | MVP |
| FR-AST-010 | Asset criticality can be recorded to prioritise missing documents. | C | V2 |
| FR-AST-011 | The asset register rendered into a generated package shows replacement lineage (`REPLACED BY` / `REPLACES`). | M | MVP |
| FR-AST-012 | An asset records `warranty_start_basis` ∈ {COMMISSIONING, HANDOVER, ACCEPTANCE, SUPPLY}; the closure workflow sets `warranty_start` only when it is null, and an existing asset value always wins. | M | MVP |

## 8b. Warranty and defect liability (`FR-WTY`, `FR-DEF`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-WTY-001 | Record OEM warranty registration (`DT-090`), start date, end date, and `warranty_start_basis` per asset, flagging conflicts between contract basis and OEM basis (`RT-028`). | M | MVP |
| FR-DEF-001 | Raise, assign, rectify (with closure photo/PDF evidence), and close defects/snags during commissioning and the Defect Liability Period (`WF-25`, `RT-028`). | M | MVP |

## 9. Documents, uploads and metadata (`FR-DOC`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-DOC-001 | A Document is a logical deliverable; it can have multiple Document Versions. | M | MVP |
| FR-DOC-002 | Upload is available from web and mobile browser; supports drag-drop, file picker and camera capture. | M | MVP |
| FR-DOC-003 | Uploads use pre-signed direct-to-storage URLs; the app server does not proxy file bytes. | M | MVP |
| FR-DOC-004 | Resumable/multipart upload is supported for files >10 MB and recovers from network interruption. | M | MVP |
| FR-DOC-005 | Allowed formats: PDF, JPEG, PNG, WebP, DOCX, XLSX, DWG, ZIP. Executables, macros-enabled Office files and unknown types are rejected. | M | MVP |
| FR-DOC-006 | Maximum file size is 100 MB (configurable per plan); maximum package size is 1 GB. | M | MVP |
| FR-DOC-007 | Every version stores SHA-256, size, MIME, original filename, uploader, timestamp and storage key. | M | MVP |
| FR-DOC-008 | Duplicate detection warns when an identical hash exists in the same project and offers link/replace/cancel. | M | MVP |
| FR-DOC-009 | Malware scanning runs before a file becomes downloadable; infected files are quarantined and reported. | M | MVP |
| FR-DOC-010 | PDFs are validated for corruption and password protection; protected files require the password or are rejected. | M | MVP |
| FR-DOC-011 | A Document can link to one Requirement, multiple Requirements, an Asset and a Contract. | M | MVP |
| FR-DOC-012 | Metadata includes title, document type, revision code, issue date, expiry date (optional), issuer, asset, requirement, language, remarks, custom fields. | M | MVP |
| FR-DOC-013 | Required metadata is defined by document type and configuration; missing required metadata blocks submission for review. | M | MVP |
| FR-DOC-014 | Revision upload creates a new version, optionally supersedes the current one; only one version can be the current **approved** version. A newer unapproved upload does not displace an approved version until it is approved. | M | MVP |
| FR-DOC-015 | Approved versions are immutable; edits require a new revision. | M | MVP |
| FR-DOC-016 | Document expiry is tracked; expired documents cease to satisfy a requirement and trigger notifications. | M | MVP |
| FR-DOC-017 | Document preview supports PDF and images in-browser; Office files are converted to PDF for preview (V1) or downloadable only (MVP). | M/S | MVP/V1 |
| FR-DOC-018 | Download uses short-lived signed URLs and is permission-checked and audited. | M | MVP |
| FR-DOC-019 | Bulk download of selected documents is supported as a ZIP with a manifest. | S | V1 |
| FR-DOC-020 | Soft delete moves a document to trash for 30 days; restore is possible by an admin; audit retained. | M | MVP |
| FR-DOC-021 | OCR text extraction is optional and never blocks upload. | C | V1 |
| FR-DOC-022 | Document metadata can be edited before approval; edits are audited, and key fields after approval require a new revision or a metadata correction with reason. | M | MVP |
| FR-DOC-023 | A document can be reused across projects only when the type permits reuse and the user attests applicability; the new project gets its own linked copy record. | S | V1 |
| FR-DOC-024 | Uploaders can add a comment (visible to reviewers and, if `EXTERNAL`, to guests) and an internal-only note (never visible to guests). Both are stored with the version and are immutable after approval. | M | MVP |
| FR-DOC-025 | The system extracts PDF page count and basic properties and displays them. | S | V1 |
| FR-DOC-026 | Unsupported or failed uploads show an actionable error and retain the selected file for retry where the browser allows. | M | MVP |
| FR-DOC-027 | Files are stored with server-side encryption and never served from a public bucket. | M | MVP |
| FR-DOC-028 | Documents can be tagged with a retention class that overrides project defaults. | S | V1 |
| FR-DOC-029 | Users can upload multiple documents in one batch with per-file metadata and a queued progress view. | S | V1 |
| FR-DOC-030 | A PDF containing multiple documents can be split into separate documents with explicit page ranges. | S | V1 |
| FR-DOC-031 | **Bulk document import** from a ZIP/folder plus an optional mapping spreadsheet (filename, revision, issue date, asset tag, requirement key), with a dry-run preview and per-file outcome report. | M | MVP |
| FR-DOC-032 | Supplier uploads must map to one of the supplier's assigned requirements; unassigned uploads are rejected with the list of available requirements. | M | MVP |
| FR-DOC-033 | Org-level duplicate detection warns when an identical SHA-256 already exists anywhere in the organisation, not only in the current project. | S | V1 |

## 10. Review, approval, rejection and revisions (`FR-REV`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-REV-001 | A Document Version can be submitted for review when required metadata and links are valid. | M | MVP |
| FR-REV-002 | Review is performed by an authorised reviewer (internal or guest) with project scope. **Approval authority is per document type / `requirements.reviewer_role`, not a blanket permission**; a reviewer may decide only where their role matches the requirement's configured reviewer role. | M | MVP |
| FR-REV-003 | Decisions are `APPROVE`, `REQUEST_CHANGES` or `REJECT`; `REQUEST_CHANGES` and `REJECT` require a comment. | M | MVP |
| FR-REV-004 | Review comments can be general or page-specific (page number + note). | S | V1 |
| FR-REV-005 | An approval can require one or more sequential/parallel stages per configuration. | S | V1 (MVP: single-stage) |
| FR-REV-006 | A requirement is satisfied only when all required evidence versions are approved or waived. | M | MVP |
| FR-REV-007 | Rejection returns the requirement to `CHANGES_REQUESTED`; the uploader is notified with reasons. | M | MVP |
| FR-REV-008 | A resubmission creates a new version linked to the prior version and review history. | M | MVP |
| FR-REV-009 | Reviewers cannot approve their own uploaded document unless an org setting explicitly allows self-approval and records it. | M | MVP |
| FR-REV-010 | Org admins can override a review decision with a mandatory reason; the override is explicitly labelled in the UI and package. **Waiving a mandatory requirement requires a second approver (`Owner` or `Admin`) with reason.** | S | V1 |
| FR-REV-011 | Review SLA is configurable; overdue reviews appear on dashboards and trigger reminders. | S | V1 |
| FR-REV-012 | Reviewers can delegate an active review to another eligible reviewer. | S | V1 |
| FR-REV-013 | The system prevents two conflicting terminal decisions on the same version; the first committed decision wins unless an override is recorded. | M | MVP |
| FR-REV-014 | Review history is immutable and exportable. | M | MVP |
| FR-REV-015 | Guest reviewers can approve only if granted `REVIEW` and their Party type is Consultant/Client/Main Contractor. | M | MVP |
| FR-REV-016 | An authorised member can record an **external approval** with: decision, approver name/role, date, method (`STAMPED_PDF` / `EMAIL` / `PORTAL` / `PHYSICAL`), reference and evidence file. This satisfies the requirement and is marked `EXTERNAL_APPROVAL` in the audit trail and package index. | M | MVP |
| FR-REV-017 | Reviewers can perform bulk decisions (approve / request changes) on a selected set of versions, with a single reason applied where required. | S | V1 |

## 11. Missing documents, reminders and notifications (`FR-NOT`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-NOT-001 | A requirement is `MISSING` when its due date has passed and it is not approved/waived/not-applicable/handed-over. A requirement with `due_at IS NULL` is never `MISSING`. | M | MVP |
| FR-NOT-002 | Dashboard and project view filter by missing, overdue, unassigned, awaiting review, expiring and rejected. | M | MVP |
| FR-NOT-003 | Reminder schedules are configurable per project (e.g., 7/3/1 days before due, then daily/weekly after). | M | MVP |
| FR-NOT-004 | Notifications are delivered in-app and by email; WhatsApp deep links are generated for manual sending in MVP. | M | MVP |
| FR-NOT-005 | WhatsApp Business API sending is supported in V1 with template approval and opt-in. | S | V1 |
| FR-NOT-006 | Notifications are deduplicated per event/recipient/channel within a configurable window. | M | MVP |
| FR-NOT-007 | Users can configure digest vs immediate notifications per category. | S | V1 |
| FR-NOT-008 | A daily/weekly digest summarises missing items by project and owner. | M | MVP |
| FR-NOT-009 | Escalation rules can notify a manager after N days of no action. | S | V1 |
| FR-NOT-010 | A notification failure never blocks the underlying business action; failures are retried and logged. | M | MVP |
| FR-NOT-011 | Unsubscribe applies only to non-essential notifications; transactional/security notices cannot be disabled. | M | MVP |
| FR-NOT-012 | Suppliers receive a request with a clear list, deadline, upload link and contact for help. | M | MVP |
| FR-NOT-013 | Reminder content is templated and localisable. Message bodies must never contain: document file content, remarks, contract value, pricing, internal comments or full requirement descriptions. Requirement titles are truncated to 60 characters. | M | MVP |
| FR-NOT-014 | Warranty and defect-liability expiry dates generate scheduled reminders to the project manager and asset owner (30/14/7/1 days before expiry). | M | MVP |

## 12. Handover packages and submissions (`FR-HND`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-HND-001 | A user with permission can generate a Handover Package for selected scope (whole project, asset category, selected assets, selected requirements). | M | MVP |
| FR-HND-002 | Package generation includes: cover page, company/client details, index with statuses, asset register, requirement-to-document mapping, approval summary, waiver list, revision history, and merged documents. The approval summary columns are: requirement, asset, document type, revision, decision, decided-by, decided-at and decision method (in-app / external). | M | MVP |
| FR-HND-003 | The index includes document title, type, asset tag, revision, approval date, approver and page range. | M | MVP |
| FR-HND-004 | Outputs: a merged PDF with bookmarks and a ZIP containing individual files plus a machine-readable manifest (CSV/JSON). | M | MVP |
| FR-HND-005 | Generation is asynchronous with progress, cancellation and clear failure reasons. | M | MVP |
| FR-HND-006 | The package is versioned and immutable once `READY`; a new generation creates a new version. | M | MVP |
| FR-HND-007 | A package is generated from a consistent snapshot of document versions at job start. | M | MVP |
| FR-HND-008 | The system blocks or warns on package generation when mandatory requirements are missing, **expired** or merely expiring; expired evidence is reported separately from expiring evidence. Override requires a reason and is recorded. | M | MVP |
| FR-HND-009 | Generated files are stored privately, downloadable via signed URL, and retained per policy. | M | MVP |
| FR-HND-010 | A Submission records recipient Party, date/time, method (portal/email/physical), reference, notes and acknowledgement file. | M | MVP |
| FR-HND-011 | Submission status follows `06` §3.7; acceptance/rejection requires a recorded decision and optional evidence. | M | MVP |
| FR-HND-012 | Rejection reasons are captured and can create follow-up tasks/requirements. | S | V1 |
| FR-HND-013 | A package can be regenerated after corrections, producing a new version linked to the prior one. | M | MVP |
| FR-HND-014 | Package layout, cover text, ordering and inclusion rules are configurable. | S | V1 |
| FR-HND-015 | Partial handover packages can be generated and tracked separately. | S | V1 |
| FR-HND-016 | A package never includes documents from another project or tenant. Enforced by composite foreign keys `(org_id, project_id, document_version_id)` on `package_items`, not only by application checks. | M | MVP |
| FR-HND-017 | Generation failure is retryable without duplicating submissions. | M | MVP |
| FR-HND-018 | Package manifest includes checksums for integrity verification. | M | MVP |
| FR-HND-019 | A submission may have multiple recipients (client, main contractor, consultant), each with their own status and decision. | M | MVP |
| FR-HND-020 | A package preview lists every included document, section and estimated page count before generation. | M | MVP |
| FR-HND-021 | The package index records the checklist snapshot checksum used at generation time, so the package can be reconciled against the requirement set. | M | MVP |

## 13. Search, reporting and exports (`FR-SRCH`, `FR-RPT`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SRCH-001 | Global search finds projects, parties, assets, documents and requirements within the user's access. | M | MVP |
| FR-SRCH-002 | Search results are permission-filtered at query time, never post-filtered. | M | MVP |
| FR-SRCH-003 | Filters include project, asset, document type, status, reviewer, owner, due date and expiry. | M | MVP |
| FR-SRCH-004 | Full-text search within extracted document text is V1; MVP searches metadata and filenames. | M/S | MVP/V1 |
| FR-SRCH-005 | Saved views/filters are supported per user. | S | V1 |
| FR-RPT-001 | Project closeout report: completion %, missing, rejected, expiring, waivers, approvals by reviewer. | M | MVP |
| FR-RPT-002 | Asset-wise document matrix is available and exportable. | M | MVP |
| FR-RPT-003 | Requirement register is exportable to Excel/CSV. | M | MVP |
| FR-RPT-004 | Audit report is exportable for a project/date range. | M | MVP |
| FR-RPT-005 | Cross-project dashboard shows active projects and risk indicators. | S | V1 |
| FR-RPT-006 | Reports are always scoped to the user's tenant and permissions. | M | MVP |

## 14. Audit and history (`FR-AUD`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-AUD-001 | Audit events are append-only and cannot be edited or deleted by customers. | M | MVP |
| FR-AUD-002 | Events capture actor, org, project, action, entity type/id, before/after summary, timestamp, IP, user agent, request ID. | M | MVP |
| FR-AUD-003 | Audited actions include authentication, membership, permission changes, uploads, downloads, metadata edits, reviews, waivers, snapshot changes, package generation, submissions and deletions. | M | MVP |
| FR-AUD-004 | Audit log is visible to owners/admins and filtered per project; guests see only their own actions if exposed. | M | MVP |
| FR-AUD-005 | Audit retention is at least the life of the project plus the retention period (default 8 years, configurable). | M | MVP |
| FR-AUD-006 | Integrity protection: hash chain or append-only storage with periodic verification. | S | V1 |
| FR-AUD-007 | Audit export is available in CSV/JSON with checksums. | S | V1 |
| FR-AUD-008 | Retention policies and legal holds can be configured; purge jobs respect holds and record completion. | S | V1 |

## 15. Billing and plans (`FR-BIL`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-BIL-001 | Plans define limits: active projects, seats, storage, package generations. | M | MVP |
| FR-BIL-002 | The system enforces limits with clear upgrade prompts; read access is never blocked by limits. | M | MVP |
| FR-BIL-003 | Subscription lifecycle: `TRIAL` → `ACTIVE` → `PAST_DUE` → `SUSPENDED` → `CANCELLED`. | M | MVP |
| FR-BIL-004 | Integration with Razorpay (proposed) for subscriptions, mandates and webhooks; verify provider. | M | MVP |
| FR-BIL-005 | Invoices are generated with GST details (Rule 46 tax invoice, SAC `998315`, buyer GSTIN, place of supply) and are downloadable. Standard Rule 46 invoices apply in MVP under the ₹5 Crore turnover exemption threshold; enable IRP e-invoicing (`irn`/`qr_payload`) via configuration when supplier turnover approaches the ₹5 Crore CBIC threshold (`RT-015`). | M | MVP |
| FR-BIL-006 | Failed payments trigger retries and dunning emails; suspension occurs after grace period. | M | MVP |
| FR-BIL-007 | Plan changes are prorated; downgrades that exceed limits require the org to archive projects first. | S | V1 |
| FR-BIL-008 | All monetary values stored in paise as integers; no floating point. | M | MVP |
| FR-BIL-009 | Tax rates and SAC are configuration, not code. | M | MVP |
| FR-BIL-010 | Refunds/credit notes are recorded with approver and reason. | S | V1 |
| FR-BIL-011 | The system records customer TDS deductions against invoices, with section, rate, amount and certificate reference, and reports them in the annual summary. | M | MVP |
| FR-BIL-012 | All tax rates, SAC codes, e-invoice applicability and TDS treatment are configuration, never hard-coded. | M | MVP |

## 16. Platform administration (`FR-ADM`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-ADM-001 | Platform admins can view orgs, plans, usage and status, but not project document content by default. | M | MVP |
| FR-ADM-002 | Break-glass access to customer content requires a reason, time limit, customer notification and full audit. | S | V1 |
| FR-ADM-003 | Platform admins can suspend/reactivate orgs and adjust plans with audit. | M | MVP |
| FR-ADM-004 | Platform admins can manage trade template packs and platform defaults. | M | MVP |
| FR-ADM-005 | Platform admins can trigger jobs, retry failed notifications and inspect job status. | S | V1 |
| FR-ADM-006 | Platform admins cannot impersonate a user without an audited break-glass session. | M | MVP |
| FR-ADM-007 | Admin actions are logged in a separate immutable admin audit stream. | M | MVP |

## 17. Integrations (`FR-INT`)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-INT-001 | Transactional email via a reputable provider with bounce/complaint handling. | M | MVP |
| FR-INT-012 | **Transactional SMS** via a DLT-compliant Indian provider (e.g. MSG91, 2factor, Plivo, Twilio India) with registered sender ID and template, delivery receipts, per-identifier rate limits, and automatic fallback to email magic link after 2 failed attempts. | M | MVP |
| FR-INT-002 | WhatsApp deep links (`wa.me`) with pre-filled messages. | M | MVP |
| FR-INT-003 | WhatsApp Business API integration (template messages, delivery status). | S | V1 |
| FR-INT-004 | S3-compatible object storage; provider abstracted behind an interface. | M | MVP |
| FR-INT-005 | Payment gateway webhooks with signature verification and idempotency. | M | MVP |
| FR-INT-006 | E-signature integration (Aadhaar eSign/DSC provider) for completion certificates. | C | V2 |
| FR-INT-007 | Accounting export (Tally/Zoho Books) for invoices. | C | V2 |
| FR-INT-008 | Outbound webhooks for package/submission/review events. | C | V2 |
| FR-INT-009 | Public API with scoped tokens. | C | V2 |
| FR-INT-010 | CSV/Excel import for assets, parties and checklist registers. | M | MVP (assets/parties), S (checklists) |
| FR-INT-011 | Email ingestion to a project inbox (forward documents into a project). | C | V2 |

## 18. Non-functional requirements

### 18.1 Performance and capacity (`NFR-PERF`)

| ID | Requirement |
|---|---|
| NFR-PERF-001 | p95 page load <2.5 s on a 4G connection for core screens, excluding file downloads. |
| NFR-PERF-002 | p95 API response <500 ms for list/detail endpoints at 100k documents per org. |
| NFR-PERF-003 | Upload initiation <1 s; throughput limited by client network, not server. |
| NFR-PERF-004 | Handover package ≤500 pages / ≤500 MB generated in p95 <10 minutes. |
| NFR-PERF-005 | The architecture must not require re-platforming below **1,000 orgs / 20,000 projects / 5 million document versions** (a design ceiling, not a forecast; derived from 250 orgs × 50 projects × 200 documents × 2 versions). |
| NFR-PERF-006 | Background jobs are queued and rate-limited per org to prevent noisy-neighbour effects. |

### 18.2 Availability and recovery (`NFR-AVL`)

| ID | Requirement |
|---|---|
| NFR-AVL-001 | 99.5% monthly availability for MVP; 99.9% target for V1. |
| NFR-AVL-002 | RPO ≤15 minutes for database; ≤1 hour for object storage via versioning/replication. |
| NFR-AVL-003 | RTO ≤4 hours for full service restoration. |
| NFR-AVL-004 | Graceful degradation: if notifications or previews fail, upload/review still work. |
| NFR-AVL-005 | Maintenance windows communicated 48 hours in advance except emergencies. |

### 18.3 Security (`NFR-SEC`)

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Tenant isolation enforced at application and database layers (RLS). |
| NFR-SEC-002 | All traffic TLS 1.2+; HSTS enabled. |
| NFR-SEC-003 | Data encrypted at rest (DB, object storage, backups). |
| NFR-SEC-004 | Passwords are not used in MVP; OTP/magic-link tokens are single-use, hashed, short-lived. |
| NFR-SEC-005 | Rate limiting on auth, upload, search and public endpoints. |
| NFR-SEC-006 | File type validation by content sniffing, not extension alone. |
| NFR-SEC-007 | Malware scanning before download availability. |
| NFR-SEC-008 | Signed URLs expire ≤15 minutes and are bound to the requesting user/session where feasible. |
| NFR-SEC-009 | No secrets in source control; secrets managed via environment/secret manager. |
| NFR-SEC-010 | Dependency scanning and patching cadence. |
| NFR-SEC-011 | Security headers (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors). |
| NFR-SEC-012 | Admin actions and permission denials are audited. |

### 18.4 Privacy (`NFR-PRV`)

| ID | Requirement |
|---|---|
| NFR-PRV-001 | Collect minimum personal data: name, business email, mobile, role. No Aadhaar/PAN of individuals. |
| NFR-PRV-002 | Privacy notice at signup; purpose-limited processing. |
| NFR-PRV-003 | Data subject requests (access/correction/deletion) supported within a defined workflow. |
| NFR-PRV-004 | Customer content is not used for model training without opt-in. |
| NFR-PRV-005 | Subprocessors listed; data residency documented. |
| NFR-PRV-006 | Retention and deletion schedules enforced by jobs and verified. |

### 18.5 Usability and accessibility (`NFR-UX`)

| ID | Requirement |
|---|---|
| NFR-UX-001 | Opening the upload sheet from a requirement takes ≤3 taps from project home. Completing an upload additionally requires file selection, ≤3 metadata fields and one confirm. |
| NFR-UX-002 | Works on Chrome/Safari/Firefox current and previous major versions; Android 9+; iOS 15+. |
| NFR-UX-003 | Responsive at 360 px width; touch targets ≥44 px. |
| NFR-UX-004 | WCAG 2.1 AA target for core flows. |
| NFR-UX-005 | Every destructive action has confirmation and undo where feasible. |
| NFR-UX-006 | Empty, loading, error and offline states are defined for every screen (`11`). |
| NFR-UX-007 | English UI is clear to a non-native speaker; avoid idioms; support Hindi in V1. |

### 18.6 Maintainability and operability (`NFR-MNT`)

| ID | Requirement |
|---|---|
| NFR-MNT-001 | Modular monolith with explicit module boundaries; no cross-module database access except through services. |
| NFR-MNT-002 | All schema changes via migrations; no manual production SQL. |
| NFR-MNT-003 | Structured logs with request IDs; no sensitive content in logs. |
| NFR-MNT-004 | Error tracking with release tagging and PII scrubbing. |
| NFR-MNT-005 | Health/readiness endpoints and synthetic checks. |
| NFR-MNT-006 | Backup restore tested at least quarterly. |
| NFR-MNT-007 | Runbooks for top 10 failure scenarios (`15`). |

## 19. Requirement-to-document traceability

| Area | Permissions | States | Data entities | API | Screens | Tests |
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

## 20. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial product requirements |
| 0.2 | 2026-10-31 | Remediation: SMS/OTP (`FR-INT-012`), external approval (`FR-REV-016/017`), bulk import (`FR-DOC-031`), one-evidence model (`FR-CHK-011`), waiver second approver, e-invoice/TDS (`FR-BIL-005/011/012`), warranty/defect/DLP (`FR-AST-011/012`, `FR-NOT-014`), multi-recipient submission and package preview (`FR-HND-019/020/021`), vague-requirement rewrites, traceability table corrected |
