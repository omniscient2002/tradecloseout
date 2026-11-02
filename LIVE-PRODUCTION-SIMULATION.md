# `LIVE-PRODUCTION-SIMULATION.md` — INSTRUCTIONS TO THE CODING AGENT

## 1. Objective & Rules of Engagement

You must execute a full-lifecycle production simulation for a real Indian commercial HVAC subcontractor without using any hardcoded UI mock arrays. Every state transition must:

1. Run inside PostgreSQL 16 under `FORCE ROW LEVEL SECURITY` using `withTenantTransaction` (`SET LOCAL app.current_org` and `SET LOCAL app.current_user`).

2. Write real binary PDF files (`%PDF-1.7`) to local object storage using `pdf-lib`, compute their real SHA-256 hashes, and pass `verifyAndScanUploadedFile` (`WF-11`).

3. Assert that illegal transitions (`DOCUMENT_ALREADY_EXPIRED`, `SELF_APPROVAL_DENIED`, `SELF_COUNTERSIGN_DENIED`, cross-tenant reads, and SVG/malware uploads) fail with the exact error codes specified in `v0.2.1`.

---

## 2. The Real-World Scenario Being Simulated

* **Tenant Organisation (`E-ORGANISATION`):** **Deccan EnviroTech MEP Pvt Ltd** (Hyderabad, Telangana, State Code `36`, GSTIN `36AABCD4512F1Z4` — validated via Modulo-36 checksum, PAN `AABCD4512F`).

* **Internal Team (`E-USER` & `E-MEMBERSHIP`):**
  * **Vikramaditya Reddy** (`R-OWNER`, Managing Director)
  * **Meera Deshmukh** (`R-PM`, Senior Project Manager)
  * **Karthikeya Sharma** (`R-QC`, Lead QA/QC Engineer)
  * **Amit Verma** (`R-SITE`, Site Execution Engineer)
  * **Fatima Shaikh** (`R-DOC`, Document Controller)

* **External Counterparties (`E-PARTY`):**
  * **Client:** **Aurobindo Biologics & Pharma Ltd** (`CLIENT`)
  * **Main Contractor:** **Larsen & Toubro (L&T) Construction** (`MC`)
  * **MEP Consultant / PMC:** **Meinhardt Singapore Pte Ltd (India Branch)** (`CONSULTANT`)
  * **OEM Supplier:** **Blue Star Limited (Commercial Air Conditioning Division)** (`SUPPLIER_OEM`)
  * **Testing Lab:** **Vimta Labs Ltd (NABL Accredited)** (`LAB`)

* **Project & Contract (`E-PROJECT`, `E-CONTRACT`):**
  * **Project Code:** `HYD-BIO-09` (*Genome Valley Sterile Formulation Block-B Cleanroom HVAC*)
  * **Base Contract:** `LT/AUR/HVAC/2026-04` · Contract Value: **₹14,50,00,000** (`1450000000` paise) · Retention: **5.0%** (`500` bps = **₹72,50,000** gated on handover) · DLP: **12 Months**.

---

## 3. Step-by-Step Workflow Execution Matrix (`WF-01` to `WF-26`)

| Step | Workflow / Spec ID | Action Executed Against Live DB & Storage | Expected Database & File Outcome |
| --- | --- | --- | --- |
| **01** | `WF-01`, `WF-02`, `FR-ORG-005` | Bootstrap Platform Plans (`STARTER`, `GROWTH`, `SCALE`), Trade Pack `TPL-HVAC-IN-001`, register **Deccan EnviroTech MEP Pvt Ltd**, validate GSTIN `36AABCD4512F1Z4`, and onboard 5 team members. | `organisations`, `org_profiles`, `users`, `user_identities`, `memberships`, and `subscriptions` (`GROWTH` plan) committed. |
| **02** | `WF-03`, `WF-04`, `WF-05` | Create 5 external `parties`, create Draft Project `HYD-BIO-09`, attach Contract (`1450000000` paise, `500` bps retention) and Specification Ref (`ISHRAE Cleanroom Standard 2026`). | `projects` in `DRAFT`; attempting `activateProject` before snapshot creation fails with `422 MISSING_CHECKLIST_SNAPSHOT` (`FR-PRJ-003`). |
| **03** | `WF-06`, `RT-019`, `RT-020` | Resolve `PLATFORM → ORG → CLIENT_CONTRACT → PROJECT` hierarchy via `resolveConfigV021` and create immutable `checklist_snapshots` `v1`. Then call `activateProject`. | Snapshot `v1` (`ACTIVE`) created; project transitions `DRAFT → ACTIVE`; `usage_counters` (`ACTIVE_PROJECTS`) incremented under `FOR UPDATE` lock (`AUD-A-08`). |
| **04** | `WF-07`, `AUD-002`, `RT-003` | Register 3 HVAC equipment units: `CHLR-01` (Blue Star 500 TR Water-Cooled Screw Chiller), `AHU-CR-01` (Cleanroom Terminal HEPA AHU), and `FD-B2-01` (Motorised Fire Damper). | `assets` rows inserted; asset-scoped requirements (`scope_key = 'asset:{uuid}'`, `asset_id = uuid`) automatically instantiated for each matching unit. |
| **05** | `WF-08`, `RT-014`, `FR-DOC-032` | Issue a scoped Supplier Upload Link (`API-027`) to **Blue Star Limited** for `CHLR-01` Factory Acceptance Test (`DT-022`) and OEM Warranty (`DT-026`). | `guest_grants` row created with `otp_required = true`; attempting to upload to an unassigned requirement (`DT-086` Fire NOC) is rejected with `403 UNASSIGNED_SUPPLIER_REQUIREMENT`. |
| **06** | `WF-09`, `WF-11`, `RT-034`, `RT-009` | Generate real binary PDFs on disk using `pdf-lib`:<br><br>1. `CHLR-01-HYDRO-TEST-R0.pdf` (Valid 10.5 Bar Hydrostatic Test)<br><br>2. `MALICIOUS-DIAGRAM.svg` (Banned SVG)<br><br>3. `EXPIRED-CAR-POLICY.pdf` (`expiry_date = '2026-09-15' < CURRENT_DATE`). | 1. Hydro Test passes magic-byte, `qpdf`, and ClamAV (`file_status = 'READY'`).<br><br>2. SVG fails with `UNSUPPORTED_FILE_TYPE`.<br><br>3. Expired policy is blocked at `submitRequirementForReview` with `422 DOCUMENT_ALREADY_EXPIRED` (`RT-009`). |
| **07** | `WF-12`, `WF-13`, `AUD-005`, `AUD-007`, `RT-011` | Submit `CHLR-01` Hydro Test `R0` for review. Test self-approval by uploader Amit Verma (blocked `403`). Reviewer Karthikeya (`R-QC`) requests changes (`CHANGES_REQUESTED`). Upload `R1` superseding `R0` and approve `R1` under row lock. | `R0` becomes `SUPERSEDED`; `R1` becomes `APPROVED`; `documents.current_approved_version_id` points to `R1`; requirement transitions to `APPROVED`. |
| **08** | `WF-23`, `RT-022` | Record an External Approval (`STAMPED_PDF`, Ref `TRN-MEIN-2026-104`) by Vikram Sengupta (Meinhardt PMC) on Cleanroom As-Built Drawing (`DT-011`) with stamped evidence PDF. | `reviews` row created with `method = 'EXTERNAL'`; requirement satisfied and labelled `Approved (external)`. |
| **09** | `RT-023`, `FR-CHK-016` | PM Meera initiates a waiver on mandatory Acoustic Test (`DT-052`). Verify status enters `PENDING_WAIVER` (`waivers.status = 'PENDING_SECOND_APPROVAL'`). Owner Vikramaditya countersigns via `countersignMandatoryWaiver` (`API-061A`). | Self-countersign by Meera is blocked (`403 SELF_COUNTERSIGN_DENIED`); Owner countersign transitions requirement `PENDING_WAIVER → WAIVED`. |
| **10** | `WF-24`, `WF-25`, `WF-26` | 1. Log OEM Warranty Registration (`DT-090`) with `COMMISSIONING` basis against `HANDOVER` contract basis (`DISPUTED` flagged, then reconciled).<br><br>2. Log Cleanroom HEPA gasket snag (`defects`), upload rectification photo PDF, and close.<br><br>3. Approve Variation Order `VO-01` (`+₹18,50,000`) creating Snapshot `v2` (`WF-20`). | `warranty_events`, `defects` (`CLOSED`), `variations` (`APPROVED`), and `checklist_snapshots` `v2` (`ACTIVE`) recorded with `requirement_revisions` diff history. |
| **11** | `WF-15`, `WF-16`, `RT-025` | Run `evaluateProjectReadiness` (`API-118`), move project to `HANDOVER`, and invoke `compileHandoverDossierPdf` (`pdf.processor.ts`) to merge all approved PDFs with an A4 cover page, CPWD/PMC stamp boxes, and requirement register. | Real merged PDF dossier written to `/tmp/tradecloseout-sim/HYD-BIO-09-HANDOVER-DOSSIER-v1.pdf` with exact page ranges in `package_items` and SHA-256 manifest. |
| **12** | `WF-17`, `WF-18`, `RT-007`, `RT-024`, `AUD-P-16` | Submit package to 3 recipients (`Meinhardt PMC`, `L&T MC`, `Aurobindo Client`).<br><br>• Round 1: PMC accepts (`PARTIALLY_ACCEPTED`), Client accepts with exception (writes `requirement_change_requests` `AUD-P-16`), MC rejects (`REJECTED`, reverting `HANDED_OVER → APPROVED` per `RT-024`).<br><br>• Round 2: All required recipients accept (`ACCEPTED`) → Close Project (`WF-18`). | Submission deterministically aggregates `SENT → PARTIALLY_ACCEPTED → REJECTED → ACCEPTED`; `closeProject` sets `warranty_start` only where null (`AUD-P-08`) and moves project to `CLOSED`. |
| **13** | `WF-21`, `FR-BIL-*`, `RT-029`, `RT-030` | 1. Offboard Site Engineer Amit Verma (verify `409 OPEN_WORK_REQUIRES_REASSIGNMENT` gap report before reassigning to Karthikeya).<br><br>2. Issue Rule 46 GST Invoice (`SAC 998315`) + record Customer TDS deduction under `194J` (`DEDUCTED_PENDING_CERT` per `RT-030`).<br><br>3. Run Weekly Owner Digest (`RT-029`) & Audit Hash-Chain (`08` §5.6). | Sessions revoked, work reassigned, GST invoice & pending Form 16A TDS logged, Owner retention-at-risk digest queued, and `audit_events` cryptographically hash-chained. |
