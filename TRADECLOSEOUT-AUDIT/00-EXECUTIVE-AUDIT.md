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