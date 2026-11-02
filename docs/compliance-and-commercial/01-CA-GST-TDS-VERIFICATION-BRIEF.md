# CHARTERED ACCOUNTANT (CA) VERIFICATION BRIEF — TRADECLOSEOUT (v0.2.1)
**Purpose:** Formal sign-off on `SOURCES-VERIFICATION.md` items `SRC-007`, `SRC-008`, `SRC-009`, `SRC-033` before issuing the first paid invoice (`15-DEPLOYMENT-AND-OPERATIONS.md` §16).

## 1. SaaS Classification, SAC Code & GST Rate (`BR-BIL-03`, `FR-BIL-005`)
- **Nature of Supply:** Cloud-hosted B2B SaaS subscription for construction documentation and compliance tracking.
- **Proposed SAC Code:** `998315` (Hosting and information technology infrastructure provisioning services) or `998314` (IT design and development).
- **Proposed GST Rate:** `18%` (`1800` bps stored in `billing_tax_configs`, never hardcoded in application code per `FR-BIL-009`).
- **Place of Supply Rule:**
  - **Intra-State Supply** (Customer GSTIN 2-digit state code == Supplier state code): `9% CGST + 9% SGST`.
  - **Inter-State Supply** (Customer GSTIN 2-digit state code != Supplier state code): `18% IGST`.

## 2. Rule 46 Tax Invoice & E-Invoicing Threshold (`BR-BIL-13`, `RT-015`)
- **Sequential Financial-Year Invoice Numbering:** Generated atomically under a PostgreSQL `FOR UPDATE` lock in `invoice_sequences` in the format `TC/2026-27/00001` (<= 16 characters per CGST Rule 46(b)).
- **E-Invoicing (IRN & QR Code) Applicability:** Under CBIC Notification No. 10/2023–Central Tax, mandatory e-invoicing applies when aggregate annual turnover exceeds **₹5 Crore** in any preceding financial year from 2017–18 onwards.
- **System Posture:** In MVP (turnover < ₹5 Crore), `billing_tax_configs.einvoice_enabled` is set to `false` and the platform issues standard Rule 46 Tax Invoices. The `irn` and `qr_payload` columns on `invoices` and the `GspEinvoiceClient` adapter are built and ready to toggle on via configuration once turnover approaches the threshold.

## 3. Customer TDS Deductions & Form 16A Reconciliation (`BR-BIL-14`, `RT-030`)
- B2B contractor customers may deduct TDS under **Section 194J** (10% / 2% for technical/royalty services) or **Section 194C** when paying subscription invoices.
- Because quarterly **Form 16A** certificates are generated from TRACES 45–90 days after payment, `invoice_tds.certificate_reference` is nullable at deduction time (`status = 'DEDUCTED_PENDING_CERT'`) and transitions to `'RECONCILED'` when the customer uploads the Form 16A PDF (`reconcileForm16aTdsCertificate`).

**CA Sign-Off Block:**
- [ ] Confirmed SAC Code: ______________
- [ ] Confirmed GST Rate (%): __________
- [ ] Confirmed E-Invoice Exemption Status for FY 2026–27: __________
- **Verifier Name & ICAI Membership No.:** ___________________________
