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