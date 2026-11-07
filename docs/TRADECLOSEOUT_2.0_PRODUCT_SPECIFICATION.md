# TradeCloseout 2.0 — Product Specification

**Status:** Discovery/design baseline; no application source changes  
**Date:** 4 November 2026  
**Product boundary:** Indian HVAC subcontractor closeout, with an MEP-ready core  
**Rule:** Requirements here are proposed until accepted through the decision register and validated with customers

## 1. Product vision

TradeCloseout should help an Indian HVAC subcontractor answer seven questions without maintaining a second shadow register:

1. What does this contract require?
2. Which equipment, system or location does it apply to?
3. Who must supply, review or accept it next?
4. Which exact evidence revision proves completion?
5. What prevents handover or a commercial milestone?
6. What was submitted, accepted, rejected or excepted?
7. What remains owed during warranty and DLP?

### 1.1 Product promise

**From contractual requirement to defensible acceptance—without duplicate registers, unclear revisions or forced external-portal adoption.**

The product does not guarantee client acceptance, legal compliance, payment release or engineering correctness. It records verified evidence and human decisions, surfaces gaps and produces traceable outputs.

### 1.2 Product boundaries

**In scope:** requirement/checklist management, equipment and system context, evidence/revision lineage, secure file processing, supplier collection, internal/external reviews, inspections and commissioning, issues/defects/warranties, handover/submission/acceptance, RA/retention readiness, activity and exports.

**Out of scope unless separately justified:** general construction ERP, payroll, inventory, procurement accounting, BIM/design authoring, CMMS, native apps before PWA validation, payment escrow, automatic engineering approval, and generic project-task management.

## 2. Personas and jobs-to-be-done

| Persona | Frequent jobs | Success looks like | Do not make them |
|---|---|---|---|
| Owner / projects head | Review portfolio exceptions, approve high-risk waivers, track acceptance and money | Know which projects need intervention and which commercial milestones are blocked | Inspect card-heavy dashboards or technical metadata daily |
| PM / project engineer | Set up requirements, assign work, chase blockers, compile and submit handover | One authoritative queue and no end-stage reconstruction | Re-enter checklist/equipment data or infer current actor from status codes |
| Document controller | Maintain revisions, metadata, transmittals, indexes and submission records | Batch work, exact lineage, exportable register | Correct inconsistent filenames and duplicate links manually |
| QC / commissioning engineer | Execute/review tests, validate instruments, close defects and approve evidence | Structured tests, calibration proof, accountable decisions | Accept a PDF upload as a substitute for measured test results |
| Site engineer | Find assigned work, scan equipment, capture evidence/inspection offline | Minimal forms, reliable sync, no duplicate entry | Understand organisation-wide navigation or commercial fields |
| Procurement | Assign OEM obligations, follow supplier submissions, reconcile warranties | Suppliers upload on mobile with scope and due date | Reveal contract values or other suppliers' information |
| Accounts / commercial | Track RA milestones, deductions, retention instalments, claims and receipts | Separate technical eligibility from actual certified/received amounts | Treat an estimated retention percentage as an accounting balance |
| Supplier / OEM | See assigned requests, upload originals, correct rejected submissions | No account/training, clear request, successful first upload | Access other project data or implement a full portal workflow |
| Consultant / external reviewer | Review exact revisions, comment, approve externally or in-app | Clear submission, low-friction exceptions, no unnecessary account | See internal contractor notes, commercials or unrelated documents |
| Client / MC recipient | Inspect final package, accept or record exceptions | Immutable package, indexed contents, traceable decision | Interpret draft/rejected files or repeated acceptance requests |
| Organisation admin | Manage membership, scopes, reassignments and templates | No orphaned work, least privilege, controlled configuration | Rely on client-side role visibility for security |

## 3. Canonical vocabulary

- **Requirement:** A contractual/configured obligation, independent of any file.
- **Applicability:** Why a requirement applies to a project/system/equipment/location, including not-applicable history.
- **Evidence link:** A deliberate relationship between a requirement and an exact document version, with coverage semantics.
- **Verification:** Server-side checks of file integrity, type, malware and structure. Not technical approval.
- **Review:** A human decision on an exact evidence version.
- **Satisfaction:** Current proof that a requirement is met by approved evidence, waiver or N/A, including validity.
- **Inspection:** A structured field/test event with items, readings, instruments and participants.
- **Handover package:** Immutable set of pinned evidence versions and metadata, not an acceptance.
- **Submission:** A package transmitted to specific recipients.
- **Acceptance:** Recipient decisions on a submission; separate from review and generation.
- **Commercial readiness:** Eligibility evidence for a milestone; not certification, payment or receipt.
- **Current actor:** The person/party expected to take the next action.

## 4. End-to-end workflows

### WF-01 — Project mobilisation and requirement setup

1. PM creates project and contract baseline, selecting private/government/client profile as appropriate.
2. System imports the consultant checklist and equipment register; parser preserves source row, sheet and original file hash.
3. User maps columns, applicability, mandatory status, milestones, owners and reviewer roles.
4. System displays matched, custom, duplicate and unresolved rows before any commit.
5. PM confirms a versioned checklist snapshot and assigns project members.
6. System instantiates project/system/equipment-scoped requirements and opens the work inbox.

**Rules:** No silent replacement of existing requirements. Existing evidence and history survive template changes. Mandatory removal/N/A requires an authorised change record.

**Outcome:** An approved, traceable project-specific requirement register within a measured onboarding time.

### WF-02 — Evidence collection from staff and suppliers

1. Requirement shows the accepted evidence type, owner, due date, equipment and reviewer.
2. Staff capture original file/photo or supplier receives a scoped link.
3. Server creates a tenant-scoped upload intent and returns a real constrained upload URL.
4. Client uploads bytes; completion moves the object to `PROCESSING`.
5. Worker verifies hash/size, magic type, malware and structural safety while preserving original bytes.
6. A derived preview may be generated and labelled; original remains unchanged.
7. User links the exact version to selected requirements/equipment and submits for review.
8. Supplier uploads remain in contractor screening until accepted into project evidence.

**Rules:** No upload, PIN entry or API completion response is success. Only verified `READY` evidence can enter review. No client-supplied “virus” flag is a security control.

### WF-03 — Review, revisions and external approval

1. Authorised reviewer sees exact version, requirements, equipment, previous comments and metadata.
2. Reviewer adds page/general comments, resolves prior comments, and approves, requests changes or rejects.
3. System locks relevant records, checks row version, current submission, role, self-approval policy and verified file state.
4. Approval records review and satisfaction atomically; it does not alter file processing state.
5. Changes/rejection returns ownership to uploader with unresolved comments and due date.
6. A new revision preserves previous approval until replacement is approved.
7. External approval records method, authority, reference, decision date and evidence, labelled `Approved (external)`.

**Rules:** Current approved evidence is version-exact. Shared evidence must have explicit coverage; it cannot approve unrelated requirements automatically.

### WF-04 — Inspection and commissioning

1. QC selects versioned ITP/checklist and equipment/system.
2. Offline-capable form records participants, conditions, readings, units, design ranges, instruments and photos.
3. System checks instrument calibration validity on the actual test date.
4. User submits test attempt; failed items create or link non-conformances.
5. Repeat attempts remain separate and are never overwritten.
6. Witness/reviewer signs off according to the ITP.
7. Approved record may satisfy linked requirements and appear in equipment passport/handover.

### WF-05 — Handover and acceptance

1. PM chooses full/partial/milestone package.
2. System shows missing/expired/wrong-revision blockers, open mandatory defects and acceptance prerequisites.
3. PM previews exact versions, sections, exceptions and estimated pages.
4. System creates immutable package, manifest and derived PDF/ZIP outputs.
5. PM transmits to recipients or records external transmittal.
6. Recipients accept, accept with exceptions or reject through their scoped access or an external record.
7. Exceptions become owned, dated follow-up items.
8. Required-recipient aggregation determines submission status; accepted package can gate project closure.
9. Any regeneration creates a new version, leaving issued package and acceptance history intact.

### WF-06 — Commercial closeout and DLP

1. Contract defines RA/final milestones, retention deductions and release conditions.
2. Each RA bill records gross, certified, deductions, retention withheld, other deductions and net payable in paise.
3. Evidence readiness is evaluated per milestone without altering accounting values.
4. Actual certification, claim, receipt and retention release are separate dated events.
5. Project closure sets warranty start only according to contractual basis and acceptance evidence.
6. Defects, rectification evidence, warranty claims and DLP closure remain searchable and affect final release readiness.

## 5. Feature specifications and value assessment

Each feature includes its problem, required behaviour, success measure and relative cost. **S/M/L** indicates relative effort after the P0 foundation, not an estimate promise.

### A. Evidence Intelligence — P1, L

**Problem:** Files and requirements exist, but current document-level links do not prove which revision satisfies which obligation.

**Required:** Version-exact links, primary/supporting coverage, verified file status, review history, satisfaction validity, expiry, lineage, duplicate detection, and requirement-centric gap calculation.

**Not allowed:** Automatic approval of every requirement linked to a document; replacing original evidence with generated placeholders; deriving approval from upload status.

**Success:** Every approved requirement can be traced to one exact approved version/waiver; every gap links to an owner and next action.

### B. Equipment Passport — P1/P2, M

**Problem:** Equipment facts are split across POs, serial lists, test PDFs, warranties and defect records.

**Required:** A read model covering identity, approved make/model, PO/FAT/dispatch, delivery/MIR, installation, inspections, commissioning, current evidence, warranty, defects, replacement and DLP. Use related records, not a duplicated mega-JSON record.

**Success:** A new engineer can explain an equipment's current state and retrieve exact supporting evidence without searching external folders.

### C. Universal Work Inbox — P1, M

**Problem:** Dashboards show statuses but not who must act or why work is waiting.

**Required:** My actions, awaiting my review, supplier screening, returned changes, pending waivers, failed uploads, inspections, handover exceptions, defects and commercial blockers. Every row has current actor, action, age, due date, blocker and deep link.

**Success:** Reduced time spent waiting without an identified actor; PM can run the weekly coordination meeting from the inbox without a separate action register.

### D. Intelligent Checklist Management — P1, L

**Problem:** Consultant formats vary; current browser import does not use persisted configuration layers and can replace scope accidentally.

**Required:** Original-file provenance, source-row mapping, deterministic rules first, optional AI suggestions later, human confirmation, template versions, controlled change requests and impact preview.

**Success:** High mapping accuracy after correction, low setup time, no lost historical requirements, reuse on the next project for the same client.

### E. Document Review Workbench — P1/P2, L

**Problem:** Current UI has basic comments but inconsistent live review services and no full response lifecycle.

**Required:** PDF/image preview, original/derived label, version selector, comparison, page anchors, comment assignment/resolution, internal/external visibility, decision history, metadata completeness and external approvals.

**Success:** Fewer “which revision?” queries, all decision comments resolved or consciously carried forward, and external decisions linked to evidence.

**Boundary:** Do not recreate all Bluebeam functionality. Complex CAD/BIM compare is out of scope.

### F. Supplier Collaboration — P1, M

**Problem:** Supplier link concepts exist, but real authentication, scope and upload paths are incomplete.

**Required:** Token exchange, scoped sessions, requirement validation on every operation, OTP/PIN policy, expiry/revocation, mobile upload, screening, safe retry, due reminders and feedback.

**Success:** Supplier completion rate, time-to-first-upload, failed upload rate and support contacts measured by link. No cross-supplier leakage.

### G. Inspection and Commissioning — P2, L

**Problem:** PDF records do not support structured readings, repeated tests, calibration dependency or failed-item workflows.

**Required:** Versioned forms, hold/witness points, readings/units/ranges, instruments, attempts, witnesses, results, issues and offline submission.

**Success:** Increased percentage of tests with complete structured evidence; zero approvals where calibration expired on the test date.

### H. Handover Intelligence — P1, L

**Problem:** Package readiness is not equivalent to accepted evidence and real worker payload is incomplete.

**Required:** Deterministic readiness, version-pinned manifest, package preview, real PDF/ZIP/manifest, exclusions with reason, submissions, recipient aggregation and exception actions.

**Success:** Successful real artefacts, fewer manual assembly hours, no accepted package containing unapproved/wrong evidence, all exceptions owned.

### I. Commercial Readiness — P2, L

**Problem:** Current retention is a contract-value estimate and does not reflect actual RA deductions or releases.

**Required:** Contract/variations, milestone rules, RA certified/deduction ledgers, retention instalments, release eligibility, claims, actual receipts and audit.

**Success:** Technical eligibility reconciles to commercial events; estimated and actual amounts are visually distinct; owner can explain each outstanding instalment.

### J. AI Assistance — P2/P3, M–L per use case

**Problem:** Manual mapping and extraction consume time but current deterministic workflows are not yet trustworthy.

**Required later:** Human-confirmed checklist mapping, metadata extraction, equipment matching, revision differences, missing-evidence suggestions and permission-filtered search with citations.

**Success:** Time saved after corrections, precision/recall by document family, false-link rate and cost/project. No AI approval, waiver, acceptance or commercial calculation.

## 6. Screen-by-screen product requirements

### 6.1 Global behaviour required on every screen

- **Loading:** Preserve layout; use meaningful skeletons or progress stages, not fake data.
- **Empty:** Explain what is absent and give one safe next action; differentiate “none exist” from “filtered to zero.”
- **Error:** Human explanation, request/correlation reference, retry where safe, preserved form data.
- **Success:** Confirm the server-observed state and next action; never simulate an approval/upload.
- **Permissions:** Server decides access; UI only hides/disables unsupported actions. Read-only states explain why.
- **Navigation:** URLs preserve project, tab, filters, selected version and page where practical.
- **Mobile:** Task-first single column, 44px targets, bottom primary action, no desktop table squeezed onto a phone.
- **Data freshness:** Show last refreshed time for readiness, commercial and work queues.

### 6.2 Company screens

| Screen | Purpose and information hierarchy | Actions and states | Permissions, dependencies and mobile |
|---|---|---|---|
| **C01 — Work Inbox** | Default home. “My overdue/today/upcoming” first, then waiting-on-others and blockers. Rows show project, requirement/equipment, action, actor, age, due date, blocker | Open action, reassign within permission, request reminder. Empty = no assigned actions; error retains filters | All internal roles see only authorised scope. Query work items + project/equipment. Mobile = inbox, filters, central capture action |
| **C02 — Portfolio Health** | Projects ordered by risk, not card vanity metrics. Columns: handover date, readiness, current blocker, waiting actor, commercial exposure | Open project, filter status/PM/client/risk, export. Zero projects = create/import first | Owner/PM/portfolio roles; commercial fields restricted. Mobile = ranked project list, not dense table |
| **C03 — Management Overview** | Exception digest: acceptance delays, supplier ageing, open mandatory defects, waiver queue, commercial instalments due | Drill to evidence, countersign eligible items, send digest | Owner/admin; aggregated authorised queries. Avoid unverified KPIs or estimated money labelled actual |
| **C04 — Projects Directory** | Searchable project register with code, client, PM, status and target handover | Create/import, archive according to permission | PM/admin; POST/list projects. Mobile card/list rows with code and next action |
| **C05 — Parties & Suppliers** | Directory with types, contacts, active obligations and grants | Create/edit party, invite supplier, revoke link | Party manager/procurement; contacts scoped. Mobile supports call/WhatsApp deep link without sending automatically |
| **C06 — Reports & Exports** | Saved operational registers and asynchronous export history | Generate requirement/equipment/review/handover/commercial export, download result | Export permission, audit. No spreadsheet formula execution; sanitise exported cell values |
| **C07 — Team & Responsibilities** | Members, project roles, assigned work, availability/status | Invite, change scope, offboard with gap report/reassign | Admin; membership and work-gap APIs. Last owner protected |
| **C08 — Organisation Settings & Billing** | Legal/profile, security/defaults, subscription, actual usage and invoices | Edit new config version, manage plan/invoices | Owner/admin/billing only. No demo GSTIN/persona switcher |

### 6.3 Project screens

| Screen | Purpose and exact contents | Actions and states | Permissions, dependencies and mobile |
|---|---|---|---|
| **P01 — Project Overview** | Header: code/name/client/stage/target. Next actions and blockers first; then requirement/equipment readiness, current actor, recent accepted/submitted/commercial events | Start handover if eligible, open blockers, create package. Draft/suspended/closed banners with allowed actions | `project.read`; dashboard/readiness projections. Mobile = next-action list and key blockers, no four-card grid |
| **P02 — Contract & Milestones** | Contract baseline, approved variations, milestone obligations, retention/warranty terms, specification references | Create controlled variation, map milestone requirements | Contract permission; values hidden from guests/site if restricted. Mobile read-first, edits desktop-preferred |
| **P03 — Requirement Register** | Dense grouped rows: title/type, equipment/system, mandatory, owner, reviewer, current evidence/status, actor, due | Filter/search/save view, assign, upload, supplier request, submit, waiver/N/A, export | `document.read`, mutations by role/scope; server-side filters for large lists. Mobile = requirement cards with one primary action |
| **P04 — Requirement Detail** | Why/applicability, current satisfaction, evidence versions, review comments/history, validity, linked inspections, commercial dependencies | Link/unlink with permission, upload, request, submit, reassign, waiver change request | Exact requirement scope enforced. Mobile = stacked current action, evidence, history |
| **P05 — Equipment Register** | Tag, category, make/model/serial/location, readiness, open issues, warranty end | Import, create, scan QR, filter, export | Equipment read/manage scope. Mobile search/scan-first with tag and next missing item |
| **P06 — Equipment Passport** | Identity header then lifecycle: approved procurement → FAT → delivery → install → tests/Cx → handover → warranty/defects/DLP; current evidence and full timeline | Add authorised lifecycle record, open exact evidence, register warranty/defect/replacement | Equipment scope; aggregated passport read model. Mobile = current status, scan, capture, chronological sections |
| **P07 — Document Centre** | Search by title/type/equipment/requirement/review/file state/uploader; current approved vs latest | Upload, link, replace revision, preview, export register | Document read/upload scopes; list endpoint supports filters/page. Mobile = search and upload, limited metadata editing |
| **P08 — Document Version & Review** | Preview with original/rendition label, metadata, revision history, requirement/equipment links, comments and decision | Comment/assign/resolve, compare, approve/request changes/reject, record external approval | `document.read` plus review.decide; server checks READY, latest submission and self-approval. Mobile = preview full-screen and bottom-sheet decision |
| **P09 — Review Queue** | Assigned/current reviews with age, SLA, version, equipment, unresolved comments and current actor | Claim/open, return for correction, bulk only when all invariants pass | Review scope. Do not show other reviewers' private comments. Mobile = queue and open |
| **P10 — Supplier Requests** | Request batches, scoped requirements, grant expiry/status, submissions and screening queue | Create/revoke/resend, screen into evidence, request correction | Procurement/PM; supplier-grant endpoints. No commercial fields. Mobile create/share via WhatsApp deep link |
| **P11 — Inspection Plans & Records** | ITP/template, scheduled equipment/tests, attempts, readings, calibration, results and witnesses | Create from versioned template, execute offline, submit, create issue, review | QC/site/reviewer; structured inspection APIs. Mobile is primary: numeric keypad, camera, offline draft |
| **P12 — Defects & Warranties** | Open/rectified/verified defects, owner/due/evidence, warranty basis/start/end/conflicts/claims | Raise/assign/rectify/verify/reopen, record warranty event/claim | Defect/warranty permissions; no close without evidence and reviewer |
| **P13 — Handover Builder** | Scope selection then readiness, blockers, item/version preview, layout, exclusions, pages/size | Generate, inspect failure, regenerate new version | Package generate permission. Readiness is recomputed server-side. Mobile review only by default |
| **P14 — Package & Submission Detail** | Package version, manifest, real artefacts, recipients, delivery, decisions and exceptions | Download, submit, record transmittal/decision, convert exception to action | Package read/submit/accept scopes. Only package-specific guests see shared content |
| **P15 — Commercial Closeout** | RA list, milestone readiness, certified/deductions/retention/releases/receipts, actual vs estimated labels | Add RA/certification/receipt, resolve eligibility, export | Commercial permission only. Integer paise, never JS float for ledger |
| **P16 — Project Activity** | Filterable chronological audit/business timeline with actor, event, related entity and correlation | Filter by equipment/requirement/document/package, export | Audit read; tenant/project scoped. Avoid leaking hidden comments/commercial data |
| **P17 — Project Settings** | Parties, team roles, template/config versions, notification and status controls | Edit through new version, suspend/reopen with guardrails | PM/admin; status write restrictions and audit |

### 6.4 External screens

| Screen | Contents and actions | Security, states and mobile |
|---|---|---|
| **X01 — Supplier Request** | Contractor/project/request list/due dates; select original file/photo, revision/date/remarks; upload progress and correction status | Only grant-scoped requirements. Token exchange, optional OTP/PIN, no internal navigation. Expired/revoked/offline/processing/accepted states explicit. Mobile-first |
| **X02 — Consultant Review** | Assigned exact version, requirement context, comments, decisions and external-download option | Grant-scoped, no unrelated comments/commercials. Account/OTP according to risk. Desktop review preferred but mobile readable |
| **X03 — Client Acceptance** | Package summary/index/artefacts and recipient-specific decision: accept, accept with exceptions, reject | Recipient binding, evidence of decision, no other submissions. Exceptions structured and acknowledged with receipt |
| **X04 — Public Verification (future)** | Verification code, target metadata and candidate hash/result | No private evidence by default. Only after real signature/verification implementation; never validates unverified CMS claims |

## 7. User stories and acceptance criteria

### Setup and work management

**US-01 — PM imports a real checklist.**  
Given a workbook with mixed header names, when the PM previews it, then every row shows source location, suggested mapping, mandatory status and unresolved conflicts; no requirement is created before confirmation.

**US-02 — PM adds one requirement safely.**  
Given an active checklist, when a change is approved, then all unaffected requirements/evidence remain, a new snapshot is created and the change reason/provenance is visible.

**US-03 — Site user sees only relevant work.**  
Given two projects in one org, a scoped user sees only assigned projects/actions; direct URLs to the other project return not found/forbidden according to policy.

**US-04 — PM knows who must act.**  
Every open work item shows one current actor, required action, waiting duration and blocking dependency. Status alone never substitutes for actor.

### Evidence and review

**US-05 — Upload cannot bypass verification.**  
Calling complete-upload produces `PROCESSING`; `READY` occurs only after server-side verification succeeds. Missing AV keeps it unavailable.

**US-06 — Original evidence is preserved.**  
Sanitisation/conversion produces a derived object with a new hash. Original hash and bytes remain retrievable by authorised users.

**US-07 — Missing object is explicit.**  
A missing original returns an error and never a generated certified-looking PDF.

**US-08 — Reviewer requests changes.**  
Reviewer must supply a reason; unresolved comments and current actor return to uploader; previous approved version remains current until a replacement is approved.

**US-09 — Approval is atomic and version-exact.**  
Approval writes review, current approved pointer and relevant satisfaction records in one transaction, with row-version/current-submission/role checks and no file-status mutation.

**US-10 — Shared evidence is controlled.**  
A single test report can cover explicitly selected equipment requirements, with coverage evidence and no unrelated automatic approvals.

**US-11 — External approval is honest.**  
Method/authority/reference/date/evidence are stored; display says `Approved (external)`, not “signed in TradeCloseout.”

### Supplier and external access

**US-12 — Supplier uses a scoped link.**  
Supplier sees only assigned requirements, can upload on mobile, and cannot reuse an expired/revoked grant or alter another requirement ID.

**US-13 — Supplier upload is screened.**  
It does not satisfy any requirement until contractor screening and normal verification/review occur.

**US-14 — Grant revocation works.**  
Revoking a grant invalidates existing grant sessions and future upload/download intents within the designed revocation window.

### Inspection and equipment

**US-15 — Calibration is checked on test date.**  
An instrument expired on the inspection date blocks compliant submission even if its calibration is valid today; replacement requires a new attempt or corrected instrument record.

**US-16 — Equipment passport is complete.**  
Passport shows procurement, delivery, installation, test/Cx, handover, warranty and defects, each linking to exact source records rather than duplicated unverifiable text.

**US-17 — Repeat tests retain history.**  
Failed attempt remains immutable; a new attempt has its own readings/instruments/witnesses and does not overwrite the failed record.

### Handover and commercial

**US-18 — Readiness distinguishes blockers and warnings.**  
Missing/expired mandatory evidence blocks normal generation; authorised override requires reason and is printed/audited. Expiring evidence is a warning, not silently failed.

**US-19 — Real package is produced.**  
Worker receives complete versioned input and writes PDF, ZIP and manifest with original version hashes and page ranges; status becomes `READY` only after objects are persisted and verified.

**US-20 — Acceptance aggregates correctly.**  
Required recipients can accept or accept with exceptions; any required rejection rejects; all required acceptance accepts; non-required notes remain visible but do not block. Empty required-recipient sets cannot silently mean accepted.

**US-21 — Exceptions become work.**  
Each exception has owner, action and due date and appears in the work inbox, with a link to original package/recipient decision.

**US-22 — Closure is gated.**  
Project closes only from handover with required acceptance and mandatory defects/requirements resolved or explicitly waived by authority.

**US-23 — Commercial actuals are not estimates.**  
UI and API distinguish expected retention formula from actual RA withheld/released amounts and receipt events. Paise arithmetic is exact.

**US-24 — Warranty basis is respected.**  
Supply/commissioning/handover/acceptance bases do not overwrite an already confirmed contractual date without a controlled conflict resolution.

### Administration and reliability

**US-25 — Offboarding does not orphan work.**  
Removing a member requires reassignment of open requirements/reviews and revokes relevant sessions.

**US-26 — Mutations are idempotent.**  
Concurrent requests with the same idempotency key produce one business result; different payloads with the same key fail; retry returns the original result.

**US-27 — Jobs are reliable.**  
Duplicate outbox polls and duplicate worker execution create one effective business outcome; failures can be retried/dead-lettered without losing the original event.

**US-28 — Audit is verifiable.**  
Verification recomputes canonical event hashes and detects changed content, broken links and missing sequence entries.

**US-29 — Exports are safe.**  
Spreadsheet values beginning with formula characters are neutralised; no internal comments or unauthorised commercial data are included.

**US-30 — No simulated success exists.**  
Every success banner corresponds to persisted authoritative state. Demo actions are absent from production builds and clearly isolated elsewhere.

## 8. Success metrics and instrumentation

### 8.1 North-star and supporting measures

**North-star:** Number of requirements reaching valid satisfaction on active projects per month, segmented by source and reviewer. This is meaningful only when satisfaction is verified and not inflated by bypasses.

| Area | Metric | Why / guardrail |
|---|---|---|
| Activation | Time to accepted checklist + equipment register; percentage of rows needing correction | Measures onboarding and mapping usefulness, not just account creation |
| Engagement | Weekly active projects by role; next-project activation | Avoids measuring uploads as empty activity |
| Actor accountability | Median age by current actor; items with no owner | Work Inbox effectiveness |
| Supplier | Invite-to-upload conversion, time, OTP abandonment, support contacts | Guest usability and security trade-off |
| Evidence | Verification failure reasons, wrong links, revision corrections, expiry recurrence | Quality of capture, not storage volume |
| Review | Time from submission to decision; returned/reopened rates; unresolved comments | Review efficiency and quality |
| Handover | Package generation success, assembly time, acceptance exceptions | Core closeout value |
| Commercial | Milestones unblocked; actual release/receipt reconciliation; claim ageing | Financial relevance without claiming causation |
| Reliability | Queue age/failure, duplicate effective writes, missing originals, tenant denials | Trust and operations |
| Economics | Support hours, storage/egress/provider cost and gross margin per project | Sustainability |

### 8.2 Definition of 10/10

A 10/10 product for the defined ICP has:

- Live-project use with repeat-project activation, not just demo praise.
- Measured reduction in duplicate administration and final package preparation time.
- Complete evidence lineage accepted by pilot consultants as understandable.
- Reliable supplier/site participation without training-heavy workflows.
- Zero known P0 evidence-integrity or tenant-isolation defects.
- Successful real handover and DLP retrieval with all exceptions owned.
- Transparent pricing and support economics validated by actual invoices and time records.

## 9. Current-versus-target capability summary

| Capability | Current repository | Target |
|---|---|---|
| Domain model | Strong starting concepts but inconsistent implementations/statuses | One canonical domain and state vocabulary |
| File trust | Direct READY possible; AV fail-open; synthetic missing PDF | Enforced original-preserving server verification and explicit failures |
| Requirement evidence | Document-level many-to-many links | Version-exact coverage and satisfaction |
| Review | Multiple divergent services; live path misses hardened checks | One authoritative review decision service |
| Supplier | Two grant paths and incomplete upload/session contract | Scoped grant sessions and screened uploads |
| Handover | Snapshot concept, but worker payload/acceptance incomplete | Real immutable artefacts and recipient decisions |
| Equipment | Asset + warranty + defect foundations | Complete procurement-to-DLP passport |
| Inspections | Mostly documents/status concepts | Structured ITP, readings, attempts and calibration |
| Commercial | Estimated retention from contract value | Actual milestone/RA/retention/receipt ledger |
| UX | Rich but partially simulated and hardcoded | Database-driven task/role workflows, no demo success in production |
| AI | Keyword mappings and future claims | Measured, human-confirmed assistance after deterministic foundation |
