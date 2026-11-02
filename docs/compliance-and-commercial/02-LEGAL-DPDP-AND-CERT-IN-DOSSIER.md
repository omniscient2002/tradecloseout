# INDIAN LEGAL, DPDP ACT 2023 & CERT-IN 2022 COMPLIANCE DOSSIER
**Purpose:** Counsel review for `BR-REG-01`, `BR-REG-02`, `BR-REG-07`, `BR-SLA-04`, and `RT-013`.

## 1. Digital Personal Data Protection Act, 2023 (DPDP Act) Posture
- **Data Fiduciary vs. Data Processor:**
  - For **Customer Account & Billing Data** (`users`, `user_identities`, `organisations`), TradeCloseout acts as a **Data Fiduciary**.
  - For **Project Handover Documents** uploaded by the contractor (`documents`, `document_versions`, `parties`), the Contractor Organisation is the **Data Fiduciary** and TradeCloseout acts as the **Data Processor** under the Data Processing Agreement (DPA).
- **Strict Data Minimisation (`NFR-PRV-001`):** TradeCloseout collects **only** business name, business email, `+91` mobile number, and company role. It strictly prohibits collecting individual government biometric IDs or personal tax IDs of site workers.
- **Data Principal Rights (`BR-DAT-09`, `API-143`):** Inbound access, correction, and erasure requests (`deletion_requests`) are acknowledged within **3 business days** and completed within **30 days**, subject to statutory retention and `legal_holds`.

## 2. CERT-In Directions 2022 (`No. 20(3)/2022-CERT-In` / `RT-013`)
1. **Mandatory 6-Hour Reporting (`BR-SLA-04`):** Any confirmed reportable cybersecurity incident (`security_events.cert_in_reportable = true`, such as unauthorised cross-tenant data access or malware outbreak) sets `report_due_at = detected_at + interval '6 hours'` and pages the founder immediately for reporting to `incident@cert-in.org.in`.
2. **NPL / NIC NTP Clock Synchronisation (`15` §3):** Production host VMs run `chrony` synced exclusively to `time.nplindia.org` (National Physical Laboratory) and `samay1.nic.in` (NIC).
3. **365-Day Log Retention:** Security and authentication logs (`security_events` and `audit_events`) are retained in India (`ap-south-1` Mumbai) for a minimum of **365 days**.
