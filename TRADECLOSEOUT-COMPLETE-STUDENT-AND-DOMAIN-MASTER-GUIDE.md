# TRADECLOSEOUT — THE COMPLETE ONE-STOP STUDENT & ENGINEER MASTER GUIDE
## Domain Primer, Complete Glossary, UI-to-Code-to-SQL Traceability & The Real-Life Story of Vayuputra HVAC

---

## PART 1: THE DOMAIN EXPLAINED FOR A STUDENT (ZERO PRIOR KNOWLEDGE REQUIRED)

### 1.1 How a Big Commercial Building Is Actually Built in India
When you walk into a massive **Data Center in Bengaluru**, a **Cancer Hospital in Hyderabad**, or an **Underground Metro Station in Chennai**, the air conditioning, ventilation, and smoke-extraction system is not "a few split ACs on the wall." It is an industrial mechanical system called **HVAC (Heating, Ventilation, and Air Conditioning)** worth **₹10 Crore to ₹50 Crore**.

Four different companies are involved in building it:
1. **The Client / Owner (The Payer):** The organization paying for the building—for example, **Yotta Data Services** (building a Data Center), **Basavatarakam Cancer Hospital** (building a Bone Marrow Transplant wing), or **Chennai Metro Rail Ltd (CMRL)**.
2. **The Main Contractor / General Contractor (`MC`):** A giant civil/EPC construction company like **Shapoorji Pallonji**, **L&T**, or **NCC Limited** that wins the ₹300 Crore contract to build the whole structure.
3. **The MEP Consultant / Project Management Consultant (`PMC`):** A specialized engineering firm like **WSP India**, **Meinhardt**, or **Spectral (AECOM)** hired by the Client to act as the "strict referee." Nothing gets approved or paid unless the Consultant stamps it.
4. **The HVAC Subcontractor (Our Customer!):** A 30-to-120 person engineering company—like **Vayuputra HVAC & Cleanroom Engineers Pvt Ltd**—hired by the Main Contractor to buy, install, test, and hand over all the chillers, air handling units (AHUs), chilled-water pipes, GI air ducts, and motorized fire dampers.

---

### 1.2 Every Piece of HVAC Equipment & Technical Term Explained Simply

When you read the database tables (`assets`, `requirements`, `documents`) or the UI screens, you will see these exact industry terms. Here is what every single one means in plain English:

| Term / Acronym | Full Name | What It Actually Is & Why It Matters |
|---|---|---|
| **MEP** | Mechanical, Electrical, and Plumbing | The three "arteries and lungs" of a building (HVAC, Electrical power, Plumbing/Fire-fighting). |
| **Chiller (`CHLR`)** | Water-Cooled or Air-Cooled Chiller | A massive ₹80 Lakh to ₹1.5 Crore machine in the basement that chills water down to `6.7°C` and pumps it through pipes across the building. Capacity is measured in **TR (Tons of Refrigeration)**—e.g., `650 TR`. |
| **AHU / CRAH** | Air Handling Unit / Computer Room Air Handler | Large metal room-sized boxes on each floor containing cooling coils, fans, and **HEPA filters** that blow cold, purified air through ducts into hospital operating theatres or server rooms. |
| **FCU & VAV** | Fan Coil Unit & Variable Air Volume Box | Smaller ceiling-mounted units (`FCU`) or motorized dampers (`VAV`) that control the temperature in individual rooms or cabins. |
| **Fire & Smoke Damper (`FD`)** | Motorized Fire Damper (`DT-039`) | A steel shutter inside an air duct connected to the building's Fire Alarm Panel. If a fire breaks out, an electric actuator (`Belimo 24V`) or a `72°C` melting link slams the shutter closed in `<8 seconds` so smoke doesn't spread to other floors. |
| **BOQ** | Bill of Quantities (`DT-002`) | The itemized price list in the contract (e.g., "Supply & install 4 Nos. 650 TR Chillers @ ₹1.10 Cr each"). |
| **RA Bill** | Running Account Bill | Monthly progress invoices submitted by the HVAC contractor as work progresses (e.g., `RA-BILL-06`). In construction, you don't get paid all at once; you bill monthly based on milestones. |
| **Retention Money** | Contractual Retention Holdback (`retention_bps`) | To make sure the subcontractor doesn't run away before finishing the paperwork or fixing leaks, the Main Contractor holds back **5% to 10% of every bill**. On Vayuputra HVAC's three projects (`₹58.70 Crore`), **₹2,93,50,000 (₹2.93 Crore)** is locked up as Retention Money! |
| **DLP** | Defect Liability Period (`dlp_months`) | A 12-to-24 month "free guarantee period" after the building opens. If a pump leaks or a damper fails during DLP, the contractor must fix it (`WF-25`). Often, half the retention money is released at Handover (`HANDOVER`) and the other half at the end of DLP (`DLP_END`). |
| **PBG & CAR** | Performance Bank Guarantee (`DT-003`) & Contractor All-Risk Insurance (`DT-004`) | Financial bank guarantees and site insurance policies. If their expiry date lapses during the project (`WF-22`), the Main Contractor stops all payments immediately. |
| **GFC vs. As-Built Drawings** | Good For Construction (`DT-010`) vs. As-Built (`DT-011`) | **Shop/GFC Drawings** are drawn *before* installation showing where ducts/pipes *should* go. During construction, beams or pipes get in the way, so engineers re-route the ducts. **As-Built Drawings** are the final drawings updated at the end to show where the ducts *actually* were installed above the false ceiling. |
| **MAS / MIR / MTC** | Material Approval Submittal (`DT-014`), Material Inspection Report (`DT-021`), Material Test Cert (`DT-024`) | 1. Before buying pipes, you ask the consultant for approval (`MAS`).<br>2. The steel mill certifies the metal quality (`MTC`).<br>3. When the truck arrives at the site gate, the QC engineer inspects it and signs a receipt (`MIR`). Without the `MIR`, the Main Contractor won't pay the 70% Delivery RA Bill! |
| **FAT** | Factory Acceptance Test (`DT-022`) | Before a ₹1.2 Crore Chiller leaves the **Trane** or **Blue Star** factory, it is run on a test bench in the factory to prove it produces `650 TR` of cooling. |
| **Hydrostatic Pressure Test** | Chilled Water Pipe Pressure Test (`DT-033`) | Before covering chilled water pipes with insulation, engineers pump water into the pipes at **1.5× working pressure (`10.5 Bar`)** and hold it for **4 to 24 hours**. If the pressure gauge drops by `0.00 Bar`, there are no leaks. |
| **NABL Calibration (`DT-025`)** | National Accreditation Board for Testing and Calibration Laboratories | How does the consultant know the pressure gauge wasn't broken or rigged during the `10.5 Bar` test? Every test gauge must have a valid 12-month certificate from an **NABL-accredited lab** (like *Vimta Labs*). If the gauge calibration expired yesterday, the consultant rejects the entire pressure test! |
| **TAB** | Testing, Adjusting, and Balancing (`DT-050`) | Measuring the exact cubic feet per minute (`CFM`) of air coming out of every ceiling diffuser and adjusting dampers so Room A doesn't freeze while Room B sweats. |
| **IST** | Integrated Systems Test (`DT-056`) | The ultimate "black-building" test before opening: engineers pull the fire alarm and cut main grid power to prove that AHUs trip, fire dampers close, smoke exhaust fans start on DG power, and the BMS (Building Management System) logs the alarm. |
| **O&M Manual & TOC/NDC** | Operation & Maintenance Manual (`DT-058`), Taking Over Cert (`DT-062`), No-Demand Cert (`DT-097`) | The final manuals handed to the client's maintenance team, the formal completion certificate (`TOC`), and the legal letter (`NDC`) stating the contractor has no further financial claims so final retention can be released. |

---

## PART 2: THE COMPLETE SOFTWARE & DATABASE GLOSSARY (HOW CODE & SQL MODEL THE DOMAIN)

Every concept in the codebase maps 1-to-1 to a PostgreSQL 16 table in `packages/db/migrations/0001_complete_v021_schema_and_rls.sql` and a service in `apps/api/src/modules/`:

1. **`organisations` & `org_profiles` (The Tenant):**
   * Represents the contracting company subscribing to TradeCloseout (e.g., `Vayuputra HVAC & Cleanroom Engineers Pvt Ltd`, `org_id = 0192e000-0000-7000-9000-000000000002`).
   * **Security Invariant (`AUD-014` & `RT-005`):** Every single table has `org_id UUID NOT NULL` with PostgreSQL `FORCE ROW LEVEL SECURITY`. Every database transaction runs inside `withTenantTransaction(pool, ctx, work)` (`packages/db/src/tenant-tx.ts`), which executes `SELECT set_config('app.current_org', $1, true)`. If `app.current_org` is missing or belongs to another company, PostgreSQL returns `0 rows` automatically.
2. **`users`, `user_identities`, `memberships` & `sessions` (Identity & Access):**
   * A human logs in via passwordless 6-digit OTP (`POST /api/v1/auth/otp/request` → `/verify`).
   * Instead of stateless JWTs (which cannot be revoked immediately if a site engineer quits), the server sets an `HttpOnly` cookie (`tc_session`) containing a 256-bit random token whose SHA-256 hash is stored in `sessions.token_hash` alongside `active_org_id` and `csrf_token_hash`.
   * Every unsafe request (`POST`, `PATCH`, `DELETE`) must also send `X-CSRF-Token` (verified by `SessionCsrfGuard`) and `Idempotency-Key` (verified by `IdempotencyInterceptor`).
3. **`checklist_snapshots` & `requirements` (The Immutable Rulebook):**
   * When a project is activated (`WF-06`), the 5-level configuration resolver (`L0 Platform` → `L1 Trade Template TPL-HVAC-IN-001` → `L2 Org Defaults` → `L3 Client Profile` → `L4 Project Overrides`) resolves all applicable items and freezes them into `checklist_snapshots` with a SHA-256 `checksum`.
   * Each item becomes a row in `requirements` with:
     * `scope_key`: Either `'project'` (once for the whole project, like `DT-004` CAR Insurance) or `'asset:{asset_id}'` (once per machine, like `DT-033` Hydrostatic Test for `CHLR-01`, `CHLR-02`, `CHLR-03`, `CHLR-04`).
     * `milestone_key`: Which payment stage this document gates (`MOBILISATION`, `SUBMISSION`, `DELIVERY`, `INSTALLATION`, `COMMISSIONING`, `HANDOVER`, `FINAL_BILL`, `DLP_END`).
     * `reviewer_role`: Which role is authorized to approve it (`R-QC`, `R-PM`, `R-CONSULT`, `R-OWNER`).
4. **`storage_objects`, `documents`, `document_versions` & `document_requirements` (Immutable Evidence Lineage):**
   * **`documents`** is the logical folder (e.g., *"CHLR-04 Hydrostatic Pressure Test Report"*).
   * **`document_versions`** is a specific uploaded file revision (`version_no = 1`, `revision_code = 'R0'`). It has **two independent state machines**:
     1. **`file_status` (`06` §3.7):** `PENDING_UPLOAD → UPLOADING → PROCESSING → READY | QUARANTINED | FAILED`. The background worker (`file.processor.ts` + `pdf-stream-compiler.ts`) sniffs magic bytes (banning `.svg` and `.exe`), checks `qpdf` for password locks and decompression bombs (`<= 1,000 pages`, `<= 25,000 objects`), and scans with ClamAV before marking `READY`.
     2. **`review_status` (`06` §3.8):** `NOT_SUBMITTED → IN_REVIEW → APPROVED | CHANGES_REQUESTED | REJECTED → SUPERSEDED`.
   * **`document_requirements`** is a many-to-many join table. This is how **1 uploaded Floor-1 Fire Damper Batch Test PDF (`batchDocId`) satisfies all 12 Fire Damper requirements (`FD-F1-01`..`FD-F1-12`) simultaneously**!
5. **`audit_events` (The Tamper-Evident Cryptographic Ledger):**
   * Every action inserts a row into `audit_events`.
   * Before the row is written to disk, the PostgreSQL `BEFORE INSERT` trigger `compute_audit_event_hash_chain()` acquires a transaction-scoped advisory lock (`pg_advisory_xact_lock`), reads the previous row's `hash` (`ORDER BY chain_seq DESC LIMIT 1`), sets `NEW.prev_hash`, and computes `NEW.hash = sha256(prev_hash || '||' || canonical_json)`.
   * A second trigger (`forbid_audit_mutation`) blocks any `UPDATE` or `DELETE` on `audit_events`—even by the application database user!

---

## PART 3: HOW THE SEED SCRIPT (`seed-vayuputra-story.ts`) POPULATES THE SYSTEM

When you run `pnpm tsx packages/db/src/seed-vayuputra-story.ts`, here is what the code actually builds inside PostgreSQL and `/tmp/tradecloseout-sim/`:

1. **Creates 6 Role-Scoped Employees at Vayuputra HVAC (`orgId = ...0002`):**
   * `surya@vayuputrahvac.in` (`R-OWNER` — Managing Director Surya Prakash Rao)
   * `ananya@vayuputrahvac.in` (`R-PM` — Senior Project Manager Ananya Kulkarni)
   * `deepika@vayuputrahvac.in` (`R-QC` — Lead QA/QC Engineer Deepika Nair)
   * `rohan@vayuputrahvac.in` (`R-SITE` — Senior Site Engineer Rohan Deshpande)
   * `farhan@vayuputrahvac.in` (`R-DOC` — Lead Document Controller Farhan Siddiqui)
   * `lakshmi@vayuputrahvac.in` (`R-PROC` — Procurement Manager Lakshmi Narayanan)
2. **Creates 10 External Counterparties (`parties` table):**
   * Clients (`Yotta Data Services`, `Basavatarakam Cancer Hospital`, `CMRL`), Main Contractors (`Shapoorji Pallonji`, `NCC Limited`), PMCs (`WSP India`, `Spectral AECOM`), OEMs (`Trane Technologies`, `Caryaire Equipments`), and NABL Lab (`Vimta Labs`).
3. **Creates 3 Commercial Projects Totaling ₹58.70 Crore (`projects` table):**
   * **`BLR-DC-01` (Yotta Data Center):** `₹28.50 Cr` contract, `₹1,42,50,000` retention, status `HANDOVER`.
   * **`HYD-ONCO-03` (Basavatarakam Hospital BMT Cleanroom):** `₹11.20 Cr` contract, `₹56,00,000` retention, status `ACTIVE`.
   * **`CHE-METRO-07` (Chennai Metro Underground Station):** `₹19.00 Cr` contract, `₹95,00,000` retention, status `CLOSED`.
4. **Registers 84 Tagged HVAC Equipment Units (`assets` table — 28 per project):**
   * `CHLR-01` to `CHLR-04` (4 × 650 TR Trane Centrifugal Chillers)
   * `AHU-01` to `AHU-06` (6 × Cleanroom AHUs / Data Hall CRAHs)
   * `PUMP-CHW-01` to `PUMP-CHW-04` (4 × Grundfos VFD Hydronic Pumps)
   * `FD-F1-01` to `FD-F1-12` (12 × Caryaire UL-555S Motorized Fire Dampers)
   * `INST-PG-01` & `INST-hood-02` (2 × NABL Calibrated Master Test Instruments)
5. **Generates 120+ Requirements & Real Multi-Page `%PDF-1.7` Files on Disk:**
   * For every project-wide requirement, every Chiller requirement (`FAT`, `HYDRO`, `WARRANTY`), and the 12-unit Fire Damper batch test, `generateMultiPageEngineeringPdf()` uses `pdf-lib` to draw a real 3-to-4 page A4 engineering PDF on disk (`/tmp/tradecloseout-sim/*.pdf`), computes its real `SHA-256` hash and byte size, and inserts the linked rows into `storage_objects`, `documents`, `document_versions`, and `document_requirements`.

---

## PART 4: STEP-BY-STEP WALKTHROUGH — HOW VAYUPUTRA HVAC USES EVERY SCREEN & BUTTON IN REAL LIFE

Follow this chronological story to understand how each employee uses the UI, what buttons they click, and what happens inside the code and database at every step.

---

### SCENE 1: Monday 9:00 AM — Managing Director Surya Signs In & Checks Retention Money at Risk
1. **What Surya Does in the Browser:**
   * Surya opens `http://localhost:3002/`.
   * **What Happens in Code:** Next.js middleware (`apps/web/src/middleware.ts`) checks for the `tc_session` cookie. Because Surya is not logged in yet, it immediately redirects his browser to `http://localhost:3002/login` (`SCR-002`).
2. **Passwordless OTP Sign-In (`/login`):**
   * Surya types `surya@vayuputrahvac.in` and clicks **"Send Verification Code"**.
   * **What Happens in Code:** `apiFetch('/api/v1/auth/otp/request')` calls the backend, which generates a 6-digit code, hashes it with SHA-256 (`sha256("surya@vayuputrahvac.in:482910")`), stores it in Redis for 300 seconds, and sends it via SMS/email.
   * Surya enters the 6-digit code and clicks **"Verify & Open Company Dashboard"**.
   * **What Happens in Code:** `POST /api/v1/auth/otp/verify` looks up `user_identities`, finds Surya's active membership (`R-OWNER`) in **Vayuputra HVAC**, inserts a session row into `sessions`, sets the `HttpOnly` `tc_session` cookie, and returns `csrfToken` (saved in `window.sessionStorage.getItem('tc_csrf_token')`).
3. **Viewing the Company Portfolio (`/dashboard` — `SCR-010`):**
   * Surya lands on `/dashboard`. At the top, he sees **`Vayuputra HVAC & Cleanroom Engineers Pvt Ltd · GSTIN: 29AABCV8821K1Z5`**.
   * The 4 KPI cards show him the exact health of his business:
     * **Active Projects:** `2 Active` (`1 Closed`)
     * **Total Retention Gated:** `₹2,93,50,000` (₹2.93 Crore)
     * **Missing / Expired Blockers:** `3`
     * **Awaiting Review:** `5`
   * Below the KPIs, he sees the 3 project cards: **`BLR-DC-01` (Yotta Data Center)**, **`HYD-ONCO-03` (Basavatarakam Hospital)**, and **`CHE-METRO-07` (Chennai Metro)**. He clicks **"Open Project"** on **`BLR-DC-01`**.

---

### SCENE 2: Monday 9:20 AM — Project Manager Ananya Imports the Consultant's Excel Checklist & Manages Equipment
1. **Switching Persona (`R-PM`):**
   * Using the top Persona Bar in `(contractor)/layout.tsx`, we switch to **Ananya Kulkarni (`ananya@vayuputrahvac.in`, `R-PM`)**.
2. **Importing WSP's Excel Checklist (`ImportChecklistModal`):**
   * Inside project `BLR-DC-01`, Ananya clicks the **"Import Checklist (.xlsx)"** button in the top header.
   * She selects WSP India's handover Excel sheet (`meinhardt-hvac-closeout-checklist.xlsx`).
   * **What Happens in Code:** `ImportChecklistModal` parses the Excel workbook in the browser using `XLSX.read()`, matches each row title against the `KEYWORD_RULES` regex dictionary (`DT-001`..`DT-099`), shows a dry-run preview (`100% Recognized — Gate Passed >= 70%`), and when Ananya clicks **"Apply Checklist Items"**, sends `POST /api/v1/projects/:id/checklist/import-l3` to persist the L3/L4 requirements into PostgreSQL.
3. **Inspecting the Equipment Matrix (`Reports & Exports` → `2. Equipment Compliance Matrix`):**
   * Ananya clicks the **`Reports & Exports`** tab and selects **`2. Equipment Compliance Matrix`**.
   * **What Happens in Code:** `ProjectsReportsController.getProjectReport('asset-matrix')` queries `assets` and `requirements WHERE asset_id IS NOT NULL` and renders a 2D grid:
     * `CHLR-01`: `DT-022 (APPROVED R0)` | `DT-033 (APPROVED R1)` | `DT-026 (APPROVED R0)` → **3/3 Ready**
     * `CHLR-02`: `DT-022 (APPROVED R0)` | `DT-033 (APPROVED R1)` | `DT-026 (APPROVED R0)` → **3/3 Ready**
     * `CHLR-03`: `DT-022 (APPROVED R0)` | `DT-033 (APPROVED R1)` | `DT-026 (APPROVED R0)` → **3/3 Ready**
     * `CHLR-04`: `DT-022 (APPROVED R0)` | `DT-033 (IN_REVIEW R1)` | `DT-026 (APPROVED R0)` → **2/3 Waiting for QC**

---

### SCENE 3: Monday 11:00 AM — Procurement Manager Lakshmi Chases Trane & Caryaire via WhatsApp Magic Links
1. **Generating a Zero-Friction Supplier Link (`ShareSupplierLinkModal` — `WF-08`):**
   * On the Hospital project (`HYD-ONCO-03`), `CHLR-04` is still missing its **OEM 5-Year Compressor Warranty Certificate (`DT-026`)**.
   * Ananya or Lakshmi clicks the green **"Supplier"** button on the `CHLR-04` Warranty row.
   * In `ShareSupplierLinkModal`, she selects **`Trane Technologies India Pvt Ltd`** from the Party dropdown, enters `+919820112233`, and clicks **"Generate WhatsApp Link"**.
   * **What Happens in Code:** `SupplierGuestService.createScopedSupplierUploadLink` generates a 192-bit cryptographic token, hashes it into `guest_grants.token_hash`, scopes `scope_json` strictly to `{ requirementIds: [reqId] }` (`FR-DOC-032`), generates a 4-digit Project Access PIN, and returns a `https://wa.me/919820112233?text=...` deep link.
2. **What the Supplier Sees (`/guest/[token]` — `SCR-034`):**
   * Trane's dispatch clerk clicks the link on WhatsApp.
   * The page `/guest/[token]` has **zero internal navigation**—it cannot see Vayuputra's contract value (`₹11.20 Cr`), retention money, internal comments, or any other document (`05` §6.4 Visibility Projection).
   * The clerk selects `CHLR-04 Warranty Certificate.pdf`, enters `R0`, and taps **Upload Document**.

---

### SCENE 4: Monday 2:00 PM — Site Engineer Rohan Uploads a Batch Test from Basement-2 (Offline Mode)
1. **Uploading in a Zero-Signal Basement (`UploadEvidenceModal` + `offline-upload-queue.ts`):**
   * Down in Basement-2, Site Engineer **Rohan Deshpande (`R-SITE`)** clicks **"Upload"** on a requirement.
   * He snaps a photo of a signed pressure-test sheet with his Android phone camera (`9.4 MB JPEG`).
   * **What Happens in Code:**
     1. `compressSitePhotoIfNeeded()` (`apps/web/src/lib/image-compressor.ts`) draws the image onto an offscreen HTML5 `<canvas>` (max `2048px`) and compresses it to a `~520 KB` `image/webp` file.
     2. `enqueueFieldUpload()` (`apps/web/src/lib/offline-upload-queue.ts`) computes the Web Crypto `SHA-256` digest of the file and stores the `Blob` + metadata inside the browser's `IndexedDB` (`tc_offline_upload_outbox`).
     3. When Rohan walks back upstairs to 4G signal, `PwaLifecycleManager` (`pwa-register.tsx`) and `sw.js` fire `drainOfflineUploadQueue()`, which calls `POST /api/v1/projects/:id/documents/upload-intents`, uploads each 10 MB chunk directly to S3/MinIO via `PUT`, and calls `POST /api/v1/document-versions/:id/complete`.
     4. In the background worker, `file.processor.ts` and `pdf-stream-compiler.ts` verify magic bytes, run ClamAV, convert the image to a stamped A4 PDF (`format-converter.ts`), check `qpdf` object limits (`RT-034`), and mark `file_status = 'READY'`.

---

### SCENE 5: Monday 4:00 PM — Lead QA/QC Engineer Deepika Reviews the PDF & Rejects Self-Approval
1. **Self-Approval Guard (`FR-REV-009`):**
   * Before switching away from Rohan (`R-SITE`), suppose Rohan tries to click **"Approve"** on his own uploaded Hydrostatic Pressure Test (`CHLR-04`).
   * **What Happens in Code:** `ReviewDecisionService.executeReviewDecision` checks:
     1. Does `R-SITE` match `requirements.reviewer_role` (`R-QC`)? **No (`403 REVIEWER_ROLE_MISMATCH`, `AUD-005`)**.
     2. Even if Rohan had `R-QC`, is `version.uploaded_by === ctx.userId`? **Yes (`403 SELF_APPROVAL_DENIED`, `FR-REV-009`)**!
2. **Opening the Split-Screen PDF Review Workbench (`/projects/[projectId]/review/[versionId]` — `SCR-025`):**
   * We switch persona to **Deepika Nair (`deepika@vayuputrahvac.in`, `R-QC`)** and click **"Inspect"** on `CHLR-04` Hydrostatic Pressure Test (`R1`).
   * **What Happens in Code:**
     * The left 70% dark pane streams the real 4-page binary PDF from `GET /api/v1/projects/:projectId/document-versions/:versionId/stream`, which verifies tenant RLS and `file_status === 'READY'`, writes a `DOCUMENT_VERSION_PREVIEWED` audit event, and pipes the PDF stream with `Content-Security-Policy: sandbox`.
     * In the right 30% pane, Deepika adds a page-pinned comment on `Page 2` (*"Verified WIKA Master Gauge NABL certificate attached on Page 4"*) and clicks the green **"Approve"** button.
     * `ReviewDecisionService.executeReviewDecision` locks the parent `documents` row (`SELECT ... FOR UPDATE`), verifies that `If-Match` matches `row_version`, marks `document_versions.review_status = 'APPROVED'`, updates `documents.current_approved_version_id`, and updates all linked `requirements` rows to `'APPROVED'` in a single atomic transaction.

---

### SCENE 6: Tuesday 10:00 AM — Two-Person Waiver Sign-Off (`RT-023`) & External Consultant Stamp (`WF-23`)
1. **Two-Person Mandatory Waiver (`FR-CHK-016` / `RT-023`):**
   * On `BLR-DC-01`, requirement `REQ-HVAC-052` (*Acoustic Noise Report*) is marked `mandatory = true`, and PM Ananya has requested a waiver because the chillers are on an isolated roof deck. Its status is **`PENDING_WAIVER`**.
   * If Ananya (`R-PM`) tries to countersign her own waiver request, `V021WorkflowsService.countersignMandatoryWaiver` blocks her with `403 SEPARATION_OF_DUTIES_VIOLATION` (*"The second approver must be a different user from the first approver"*).
   * Managing Director **Surya Prakash Rao (`R-OWNER`)** switches in, clicks **"Countersign Waiver"**, and the requirement transitions from `PENDING_WAIVER → WAIVED`.
2. **Recording a Physical Consultant Stamp (`WF-23` / `SCR-027`):**
   * For the Cleanroom As-Built Drawing (`DT-011`), WSP India's Resident Engineer stamped the physical blueprint on site with Transmittal Ref `TRN-WSP-BLR-2026-089`.
   * Document Controller **Farhan Siddiqui (`R-DOC`)** opens the review modal, selects the **"External Approval"** tab, chooses `Stamped PDF`, enters `Er. Vikram Sengupta (WSP India)`, enters `TRN-WSP-BLR-2026-089`, and clicks **"Record External Approval"**.
   * The requirement is satisfied and badged as **`Approved (external)`** so the handover dossier index transparently distinguishes in-app approvals from physical/external stamps.

---

### SCENE 7: Tuesday 3:00 PM — Compiling the Monthly RA-Bill Pack & Final 480-Page Handover Dossier (`WF-16`)
1. **Unlocking Monthly Cash Flow (`Monthly RA-Bill Pack` in `CompileHandoverModal`):**
   * On `HYD-ONCO-03` (Hospital project), PM Ananya needs to submit **RA Bill #06 (`₹1.65 Crore`)** for the `COMMISSIONING` milestone.
   * She clicks **"Compile Dossier"** → selects **"Monthly RA-Bill Pack"** → chooses **`COMMISSIONING`** → enters `RA-BILL-06` and clicks **"Compile RA-Bill Pack"**.
   * TradeCloseout gathers only the approved `COMMISSIONING` documents (`Flushing`, `Fire Damper Batch Drop-Test`, `Chiller Hydro Tests`) and compiles a focused PDF annexure for NCC's billing engineer.
2. **Compiling the Full Bookmarked Handover Dossier (`Full Handover Dossier` in `CompileHandoverModal`):**
   * On `BLR-DC-01` (Data Center project), Ananya selects **"Full Handover Dossier"** and clicks **"Compile Handover Dossier"**.
   * **What Happens in Code (`pdf-stream-compiler.ts`):**
     1. `pdf-lib` generates only the lightweight A4 Cover Page (with Vayuputra's branding, Contract Ref, and the 64-character `Snapshot Checksum SHA-256`), the 3-column **CPWD / PMC Signature & Stamp Grid**, and the **Master Requirement & Approval Register** with pre-computed page ranges (`pp. 001–084`).
     2. Out-of-process C++ `qpdf --linearize --empty --pages ...` streams all approved PDFs together in `<60 MB` of RAM without loading 500 MB of PDFs into the Node.js V8 heap!
3. **Multi-Recipient Acceptance & Releasing ₹1.42 Crore Retention (`WF-17` & `WF-18`):**
   * Ananya records a formal submission to **WSP India (`CONSULTANT`)**, **Shapoorji Pallonji (`MC`)**, and **Yotta Data Services (`CLIENT`)**.
   * When WSP accepts first, `recordRecipientDecision` (`RT-007`) sets the package status to **`PARTIALLY_ACCEPTED`**.
   * Once Shapoorji Pallonji and Yotta Data Services also click **Accept**, the status automatically transitions to **`ACCEPTED`**, Ananya closes the project (`HANDOVER → CLOSED`), and Vayuputra HVAC collects its **₹1,42,50,000 retention payment**!
