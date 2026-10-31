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

## 4. Post-Remediation Verification & Current Status (v0.2.1)

# **FINAL AUDIT VERDICT: APPROVED WITH CONDITIONS**

### 4.1 Verification of Technical Remediation
Following the independent red-team audit, **all 42 defects (`RT-001` through `RT-042`) have been authentically resolved** in specification bundle v0.2.1:
1. **Patches 1, 2, and 3 Applied Verbatim:**
   - `08-DATA-MODEL-AND-ERD.md`: Fixed PostgreSQL composite keys, removed circular self-FKs, added `bulk_import_jobs`, nullable `sessions.active_org_id`, `milestone_key`, `asset_id` composite FK, forced RLS with `tc_app` role, and fixed revision code index.
   - `10-API-AND-INTEGRATIONS.md`: Added org switching endpoints (`API-009A/B`), bulk import endpoints (`API-095`–`097`), refresh multipart upload URL (`API-082A`), waiver countersign (`API-061A`), effective config (`API-067`), external approval (`API-106`), renumbered duplicates (`API-028A/B`, `API-118A/B`), and enforced guest rate limiting.
   - `03-PRODUCT-REQUIREMENTS.md`: Rewrote `FR-IAM-018` to positive-only RBAC, added Section 8b (`FR-WTY-001`, `FR-DEF-001`), removed duplicate rows, aligned GST invoices to Rule 46 in MVP, and replaced the Authoritative Traceability Table.
2. **Statutory Alignment Completed:**
   - Mandatory CERT-In 6-hour incident notice and NTP synchronization with NPL/NIC clocks applied across `02`, `12`, `13`, `15`, and `SOURCES-VERIFICATION.md` (`RT-013`).
   - DPDP Rules 2025 365-day log retention and privileged account MFA applied across `08`, `13`, and `SOURCES-VERIFICATION.md` (`RT-027`).
   - Form 16A quarterly reconciliation reflected in `02`, `08`, and `SOURCES-VERIFICATION.md` (`RT-030`).
3. **Workflow & Security Hardening:**
   - SVG uploads strictly banned; Gotenberg replaced in MVP with pure-Node PDF generation (`pdfmake`/`pdf-lib`/`qpdf`) saving 4–5 weeks of effort (`RT-006`, `RT-025`).
   - Multi-recipient submission deadlock broken via `is_required_approver` and `PARTIALLY_ACCEPTED` state aggregation (`RT-007`).
   - Expired certificates blocked on upload and transitioned to `EXPIRED` on validity lapse (`RT-009`, `RT-024`).
   - CPWD/PSU closeout certificates added to catalogue (`DT-097`, `DT-098`, `DT-099`), bringing total catalogue count to 98 types (`RT-031`, `RT-037`).

### 4.2 Mandatory Operational Condition (M3 Gate)
The specification is technically hardened, sound, and ready for codebase implementation. The sole remaining condition before production rollout is:
- **M3 Gate Condition:** Before completing Milestone M3 (Checklist and snapshot engine), the founder must collect and cross-reference **at least 5 real MEP consultant closeout checklists** from live Indian projects to validate the default `TPL-HVAC-IN-001` template items against actual market submittal practices.

Implementation of Milestones **M0 through M2** (Foundations, Auth, Projects, Contracts) can proceed immediately.
