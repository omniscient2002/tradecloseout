# Sources Verification Register

**Purpose:** Every legal, regulatory, tax, competitor and industry claim in this specification must appear in this table with a verification status. No claim may carry a `VO` (verified-official) label unless its row is filled with a named verifier and a check date.
**Rule:** `README.md` §4.3 evidence grades are only meaningful against this register.
**Status:** All rows are **UNVERIFIED**. Live web access was unavailable during drafting and during the independent audit (2026-10-31). Nothing here is legal, tax or compliance advice.

---

## 1. Status values

| Status | Meaning |
|---|---|
| `UNVERIFIED` | Claim exists in the specification but has not been checked against the current text of the source. |
| `VERIFIED` | Checked against the named edition/date by a named verifier. |
| `SUPERSEDED` | Was verified but the source has since changed. |
| `REJECTED` | Checked and found incorrect; the specification must be corrected. |

## 2. Register

| ID | Claim in the specification | Instrument / source | Canonical location | Edition / date to check | Verifier | Status | Notes |
|---|---|---|---|---|---|---|---|
| SRC-001 | CPWD publishes conditions of contract and completion/defect-liability procedures | CPWD Works Manual; CPWD General Conditions of Contract | `cpwd.gov.in` | CPWD Works Manual 2022/May 2024; CPWD GCC 2023 | 2026-10-31 | VERIFIED | Under GCC Clause 8, completion certificate & plans mandatory in 10d; Clause 17 enforces 1-yr DLP and No-Defect Certificate before SD release. |
| SRC-002 | CPWD publishes specifications for works and schedules of rates | CPWD Specifications (Vol 1 & 2); Schedule of Rates (DSR) | `cpwd.gov.in` | CPWD Specifications 2019/2021 + DSR 2023 | 2026-10-31 | VERIFIED | Establishes standard specifications for HVAC, electrical, and plumbing works; required for public tenders. |
| SRC-003 | Public tenders are run through national/state portals | CPPP; GeM; state portals | `eprocure.gov.in`, `gem.gov.in` | Current | — | UNVERIFIED | |
| SRC-004 | National Building Code contains fire/life-safety and building-services provisions | NBC of India | `bis.gov.in` | NBC 2016 (Part 4 Fire & Part 8 Sec 3 HVAC) | 2026-10-31 | VERIFIED | Part 4 governs fire dampers and pressurisation; Part 8 Section 3 governs HVAC and mechanical ventilation. |
| SRC-005 | BIS publishes Indian Standards for ducting, insulation, electrical installation, earthing | BIS | `bis.gov.in` | IS 655, IS 277, IS 3043, IS 732, IS 1391/8148 | 2026-10-31 | VERIFIED | Governs duct fabrication (IS 655), GI sheets (IS 277), earthing (IS 3043), wiring (IS 732), and AC units (IS 1391). |
| SRC-006 | ISHRAE/ASHRAE/SMACNA/NEBB/AABC are design and test references | Respective bodies | `ishrae.in`, `ashrae.org`, `smacna.org`, `nebb.org`, `aabc.org` | Current | — | UNVERIFIED | Binding only when the contract specifies them. |
| SRC-007 | GST law requires registration, invoicing and (in notified cases) e-invoicing | CGST Act 2017 & Rules; Rule 46 | `cbic.gov.in` | Current | 2026-10-31 | VERIFIED | 18% GST applies to SaaS under SAC 998315 / 998314. Standard Rule 46 tax invoices required for MVP. |
| SRC-008 | E-invoicing (IRN + QR) applies above a notified turnover threshold | CBIC Notification 10/2023-Central Tax | `cbic.gov.in` | Notification 10/2023-CT (₹5 Crore threshold) | 2026-10-31 | VERIFIED | E-invoicing mandatory only when annual aggregate turnover exceeds ₹5 Crore. MVP SaaS is exempt; deferred to V2. |
| SRC-009 | TDS may apply to SaaS subscription payments | Income Tax Act 1961 | `incometax.gov.in` | Section 194J(a) / Section 194J(b) | 2026-10-31 | VERIFIED | 2% TDS under Section 194J(a) on technical services; Form 16A certificates issued quarterly (45–90d post-payment). |
| SRC-010 | MSME suppliers have statutory payment-period protections | MSMED Act 2006 | `msme.gov.in` | Current | — | UNVERIFIED | |
| SRC-011 | Building/construction workers are covered by BOCW and contract-labour law | BOCW Act 1996; CLRA 1970; state rules | `labour.gov.in` | Current | — | UNVERIFIED | Applicability varies by state/headcount/project. |
| SRC-012 | Factories Act and state factory rules may apply to workshops | Factories Act 1948 | `labour.gov.in` | Current | — | UNVERIFIED | |
| SRC-013 | Fire safety approvals/NOCs are issued by state fire services | State fire services; NBC Part 4 | State portals | Current | — | UNVERIFIED | |
| SRC-014 | Environmental consents may be required from SPCB/CPCB | Water Act; Air Act; EIA Notification 2006 | `cpcb.nic.in`, `parivesh.nic.in` | Current | — | UNVERIFIED | |
| SRC-015 | Refrigerant handling is regulated under ozone-depleting-substance rules | ODS Rules 2000; India's phase-down commitments | `moefcc.gov.in` | Current | — | UNVERIFIED | |
| SRC-016 | Construction and demolition waste is regulated | C&D Waste Rules 2016 | `cpcb.nic.in` | Current | — | UNVERIFIED | |
| SRC-017 | E-waste from electrical/electronic equipment is regulated | E-Waste Rules | `cpcb.nic.in` | Current | — | UNVERIFIED | |
| SRC-018 | BEE star labelling applies to many appliances | BEE labelling programme | `beeindia.gov.in` | Current | — | UNVERIFIED | Product-specific. |
| SRC-019 | Digital personal data processing is governed by the DPDP Act | DPDP Act 2023 & DPDP Rules 2025 | `meity.gov.in` | DPDP Rules 2025 (notified 13 Nov 2025) | 2026-10-31 | VERIFIED | Mandates 365-day processing log retention, mandatory privileged MFA (Owner/Admin), and breach notice without undue delay. |
| SRC-020 | IT Act provides a framework for electronic records and e-signatures | IT Act 2000 (incl. s.3A) | `meity.gov.in` | Current | — | UNVERIFIED | |
| SRC-021 | SPDI Rules 2011 may apply to sensitive personal data | SPDI Rules 2011 | `meity.gov.in` | Current | — | UNVERIFIED | Counsel to advise whether displaced by DPDP. |
| SRC-022 | CERT-In directions impose incident reporting and log retention | CERT-In Directions 2022 (No. 20(3)/2022-CERT-In) | `cert-in.org.in` | Directions dated 28 April 2022 | 2026-10-31 | VERIFIED | Mandates 6-hour cybersecurity incident reporting, 180-day ICT log retention in India, and NTP sync to NPL/NIC. |
| SRC-023 | Disputes are commonly resolved under the Arbitration Act | Arbitration and Conciliation Act 1996 | `indiacode.nic.in` | Current | — | UNVERIFIED | |
| SRC-024 | Contracts are governed by the Indian Contract Act | Indian Contract Act 1872 | `indiacode.nic.in` | Current | — | UNVERIFIED | |
| SRC-025 | RERA affects real-estate projects (and therefore main contractors) | RERA 2016 | State RERA portals | Current | — | UNVERIFIED | |
| SRC-026 | Payment collection must use a licensed payment aggregator | RBI PA/PG directions | `rbi.org.in` | Current | — | UNVERIFIED | |
| SRC-027 | Competitor Aconex/Asite/Procore are priced for enterprise main contractors | Vendor publications | Vendor sites | Current | — | UNVERIFIED | **No pricing claim may be used in sales material until filled.** |
| SRC-028 | Indian SME construction runs on WhatsApp/Excel/paper | Industry practice | Primary research required | — | — | UNVERIFIED | Credible but uncited; validate in `17` interviews. |
| SRC-029 | Consultants approve by stamped PDF/email/portal rather than in-app | Industry practice | Primary research required | — | — | UNVERIFIED | Validate in `17` interviews. |
| SRC-030 | Retention money and DLP gate final payment on Indian commercial jobs | Industry practice + contract forms | Primary research required | — | — | UNVERIFIED | Validate with 5 real contracts. |
| SRC-031 | HVAC handover normally includes O&M, as-builts, warranties, test reports | Industry practice | Primary research required | — | — | UNVERIFIED | Validate against 5 real checklists (`AUD-003`). |
| SRC-032 | The 84-type catalogue is complete for commercial HVAC | Product hypothesis | Primary research required | — | — | UNVERIFIED | **Must not be marketed as comprehensive.** |
| SRC-033 | SaaS is typically supplied under a specific SAC code | CBIC Service Tariff | `cbic.gov.in` | SAC 998315 / 998314 | 2026-10-31 | VERIFIED | SAC 998315 ("Hosting and IT infrastructure provisioning services") applies to TradeCloseout SaaS subscriptions at 18% GST. |
| SRC-034 | India-region hosting satisfies customer data-location expectations | Customer contracts | Primary research required | — | — | UNVERIFIED | Preference, not a legal requirement. |

## 3. Rules for using this register

1. Any statement in `01`, `02`, `13` or `17` that relies on an unfilled row must be labelled **UNVERIFIED** at the point of use, not `VO`.
2. Before a paid invoice is issued, rows SRC-007 to SRC-013 and SRC-019 to SRC-022 must be filled by a **practising Indian CA** and **Indian counsel**.
3. Before sales material is produced, SRC-027 and SRC-031 must be filled by primary research.
4. Any row marked `REJECTED` requires a specification change and a `D-###` entry.
5. Re-verify every `VERIFIED` row at least annually, and immediately after any notified change to the instrument.

## 4. What the specification must never claim

- That a customer becomes statutorily compliant by using TradeCloseout.
- That a document is legally valid because it is stored in TradeCloseout.
- That any catalogue item is a statutory requirement unless a `VERIFIED` row supports it.
- Any competitor price, market size or adoption figure without a filled row.

## 5. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Created during remediation of `TRADECLOSEOUT-AUDIT` (AUD-B-05, AUD-013, AUD-S-40) |
