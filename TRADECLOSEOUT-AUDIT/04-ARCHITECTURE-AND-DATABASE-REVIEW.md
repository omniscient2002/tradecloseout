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