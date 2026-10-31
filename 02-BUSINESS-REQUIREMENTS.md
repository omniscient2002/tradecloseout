# 02 — Business Requirements

**Status:** Draft v0.2
**Change history:** v0.2 adds BR-BIL-12/13/14 (TDS and e-invoice), BR-DAT-09 (DSR owner), BR-SLA-03 assumptions and BR-GTM-07 owner digest.
**Audience:** Founder, product, finance, operations
**Note:** Commercial figures are hypotheses unless marked VO. See `17`.

---

## 1. Business context

TradeCloseout is a bootstrapped, India-first SaaS product. The initial operating constraint is a solo developer/founder, so the business model and product scope must minimise operational load while preserving trust, security and billing correctness.

The business succeeds if a small contractor can self-serve onboarding, run a project, and generate a handover package without vendor involvement, while paying a predictable subscription.

## 2. Business objectives

| ID | Objective | Measure | Horizon |
|---|---|---|---|
| BO-01 | Reach 10 paying HVAC contractor companies | Active paid orgs | 12 months post-launch |
| BO-02 | Prove willingness to pay | ≥3 paid pilots at ≥₹5,000/month equivalent | 6 months |
| BO-03 | Keep gross support load low | <0.5 tickets/active project/month | 12 months |
| BO-04 | Achieve reliable handover output | ≥95% package generation success | Launch + 3 months |
| BO-05 | Protect cash and trust | Zero cross-tenant incidents; <1% failed payments unresolved >7 days | Continuous |
| BO-06 | Establish expansion path | ≥2 trade packs adopted by existing customers | 18–24 months |

## 3. Customer segments and packaging

### 3.1 Legal forms to support

Indian contractors may be:

- sole proprietorship,
- partnership firm,
- LLP,
- private limited company,
- public limited company (rare in ICP),
- branch of a foreign company (out of scope initially).

The product must not assume a company has a CIN or GSTIN. It must support optional legal identifiers and a display/trade name distinct from the legal name.

### 3.2 Plan structure (Hypothesis H2)

| Plan | Target | Projects | Seats | Storage | Guest users | Indicative price/month |
|---|---|---|---|---|---|---|
| Starter | Proprietor / small firm | 3 active | 5 | 20 GB | Unlimited scoped | ₹4,999 |
| Growth | Regional contractor | 15 active | 20 | 100 GB | Unlimited scoped | ₹9,999 |
| Scale | Multi-project MEP | 50 active | 50 | 400 GB | Unlimited scoped | ₹19,999 |

- Annual billing at ~2 months free.
- Overage: per additional active project and per 50 GB storage, or upgrade prompt.
- **No charge per supplier.** Supplier participation is a product requirement.
- Prices exclude GST (18% assumed; verify).
- All prices are hypotheses to be tested; see `17` §5.

### 3.3 Trial and pilot

- 14-day self-serve trial with 1 project and 2 GB, no card required (proposed).
- Paid pilot: 8–12 weeks, fixed fee, includes onboarding and a success review. Pilot fee credited to first year if converted (proposed).
- No free forever plan except a read-only archived state after cancellation.

## 4. Revenue, billing and invoicing requirements

| ID | Requirement | Status |
|---|---|---|
| BR-BIL-01 | Bill in INR; display prices inclusive and exclusive of GST clearly | Confirmed |
| BR-BIL-02 | Collect GSTIN, legal name, billing address and place of supply | Confirmed |
| BR-BIL-03 | Issue GST-compliant tax invoices with sequential numbering and HSN/SAC | Confirmed (verify code/format with CA) |
| BR-BIL-04 | Support monthly and annual subscriptions; proration on plan change | Confirmed |
| BR-BIL-05 | Integrate a licensed payment aggregator (Razorpay proposed); never store card data | Confirmed |
| BR-BIL-06 | Handle payment failure with dunning and grace period | Confirmed |
| BR-BIL-07 | Provide downloadable invoices and a billing history | Confirmed |
| BR-BIL-08 | Support credit notes/refunds for service failures | Proposed |
| BR-BIL-09 | Do not hardcode tax rates or thresholds; make them configurable | Confirmed |
| BR-BIL-10 | Support purchase-order references and buyer GSTIN for B2B invoices | Proposed |
| BR-BIL-11 | Provide an annual GST summary export | Proposed |
| BR-BIL-12 | TDS handling: record TDS deducted by customer, do not compute tax liability automatically | Confirmed |
| BR-BIL-13 | GST invoice generation: In MVP, generate Rule 46 compliant GST tax invoices (SAC 998315) with GSTIN, PAN, and CGST/SGST/IGST breakdown. Per CBIC Notification 10/2023-CT, mandatory e-invoicing applies only to entities with turnover exceeding ₹5 Crore; MVP SaaS is exempt. Direct IRP e-invoicing via licensed GSP/ASP is deferred to V2 (RT-015). | Confirmed |
| BR-BIL-14 | Customer TDS deductions: Support two Indian corporate payment workflows: (a) Pay Full & Reimburse TDS, and (b) Net Payment with Asynchronous Form 16A Reconciliation (RT-030). Since Form 16A is issued quarterly (45–90 days post-payment), TDS certificate_reference is optional at payment deduction time and reconciled asynchronously upon quarterly certificate upload. | Confirmed |

**Open (Q):** whether to invoice from an Indian entity or a foreign entity; this affects GST, place of supply and customer perception. Must be decided before first paid invoice.

## 5. Data ownership and commercial terms

| ID | Requirement | Status |
|---|---|---|
| BR-DAT-01 | The customer owns its project data and uploaded documents | Confirmed |
| BR-DAT-02 | Customer can export projects, documents and audit logs in open formats | Confirmed |
| BR-DAT-03 | On cancellation, data is retained read-only for a stated period, then deleted per policy | Confirmed |
| BR-DAT-04 | TradeCloseout does not use customer project content to train AI models without explicit opt-in | Confirmed |
| BR-DAT-05 | No cross-tenant analytics that expose identifiable customer documents | Confirmed |
| BR-DAT-06 | Subprocessors are listed publicly with purpose and region | Proposed |
| BR-DAT-07 | A data-processing agreement is available for customers who need one | Proposed |
| BR-DAT-08 | Exit assistance: bulk ZIP export including metadata manifest | Confirmed (MVP: per-project export; full-org export V1) |
| BR-DAT-09 | A designated privacy contact owns inbound data-subject requests; acknowledge within 3 business days and complete within 30 days or the legally required period. | Confirmed |

## 6. Service levels and support

| ID | Requirement | Target |
|---|---|---|
| BR-SLA-01 | Core web app availability | 99.5% monthly (MVP), 99.9% (V1) |
| BR-SLA-02 | Upload success (excluding client network) | ≥99% |
| BR-SLA-03 | Handover package generation (≤500 pages, ≤500 MB, ≤20 converted files) | p95 <10 minutes |
| BR-SLA-04 | Critical cybersecurity incident notification to CERT-In and affected customers | Statutory mandatory reporting to CERT-In within 6 hours of incident detection (CERT-In Directions 2022, No. 20(3)/2022-CERT-In, RT-013); notification to affected customers and Data Protection Board without undue delay per DPDP Rules 2025 |
| BR-SLA-05 | Support channels | Email + WhatsApp link + in-app help (MVP); no phone SLA |
| BR-SLA-06 | Support hours | 10:00–19:00 IST, Mon–Sat (proposed) |
| BR-SLA-07 | Response target | Critical 4 business hours; normal 1 business day |
| BR-SLA-08 | Status page for incidents | Required before paid launch |

SLA credits are **not** offered in MVP; enterprise SLAs are out of scope.

## 7. Operational requirements

| ID | Requirement | Status |
|---|---|---|
| BR-OPS-01 | Onboarding must be self-serve for a new org | Confirmed |
| BR-OPS-02 | No manual document processing by TradeCloseout staff | Confirmed |
| BR-OPS-03 | Platform admin access is break-glass, logged and minimal | Confirmed |
| BR-OPS-04 | Billing and plan enforcement must be automated | Confirmed |
| BR-OPS-05 | Support impersonation requires customer consent or admin break-glass with audit | Confirmed |
| BR-OPS-06 | Refunds and credits require a documented approval | Proposed |
| BR-OPS-07 | Deletion requests must be executable within a defined SLA | Confirmed |
| BR-OPS-08 | The product must operate in IST with Indian date/number formats | Confirmed |

## 8. Go-to-market requirements

| ID | Requirement | Status |
|---|---|---|
| BR-GTM-01 | Product can be demonstrated with a seeded sample project in <5 minutes | Confirmed |
| BR-GTM-02 | Sales collateral must distinguish verified facts from claims | Confirmed |
| BR-GTM-03 | Onboarding includes an importable sample HVAC checklist | Confirmed |
| BR-GTM-04 | Referral/partner model for consultants is deferred to V2 | Proposed |
| BR-GTM-05 | Pricing page must show INR, GST treatment and plan limits | Confirmed |
| BR-GTM-06 | No mandatory sales call to start a trial | Confirmed |
| BR-GTM-07 | Provide a weekly owner digest (PDF/email) summarising missing documents, expiring items, and the contract/milestone rupee retention value at risk (RT-029), so a proprietor who never logs in immediately sees commercial risk and cash-flow impact. | Confirmed |

## 9. Regulatory and compliance business requirements

| ID | Requirement | Status |
|---|---|---|
| BR-REG-01 | Obtain legal review of terms of service, privacy notice and DPA | Confirmed |
| BR-REG-02 | Confirm DPDP Act 2023 obligations, notices and consent flows | Confirmed |
| BR-REG-03 | Confirm GST invoicing, SAC, TDS and e-invoice obligations with a CA | Confirmed |
| BR-REG-04 | Maintain records sufficient for Indian tax audit | Confirmed |
| BR-REG-05 | Do not claim statutory compliance on behalf of customers | Confirmed |
| BR-REG-06 | Provide configurable retention aligned to contract and legal needs | Confirmed |
| BR-REG-07 | Report cyber incidents per CERT-In directions | Confirmed (verify current timelines) |
| BR-REG-08 | Support electronic records and signatures consistent with IT Act 2000 where used | Proposed |

## 10. Business rules

| ID | Rule |
|---|---|
| BR-R-01 | One Project belongs to exactly one contractor Organisation (tenant). |
| BR-R-02 | A Party (client, main contractor, supplier) is a directory record, not a tenant. A Party may be invited as a Guest but gains no org-wide access. |
| BR-R-03 | Guests can only see projects and requirements explicitly granted to them. |
| BR-R-04 | A project's requirement set is an immutable snapshot; changes require a controlled change request. |
| BR-R-05 | An approved Document Version is never edited; a correction creates a new revision and supersedes the old one. |
| BR-R-06 | A Handover Package is immutable once submitted; corrections create a new package version. |
| BR-R-07 | Deleting a document is a soft delete with audit; hard purge only via retention policy or verified legal request. |
| BR-R-08 | A requirement can be satisfied only by an approved document version, a recorded waiver, or a not-applicable decision. |
| BR-R-09 | Subscription lapses do not delete data; they restrict writes after a grace period. |
| BR-R-10 | The customer's legal entity name and GSTIN on invoices come from billing settings, not project data. |
| BR-R-11 | Supplier upload links are scoped to one requirement or a small request set, expire, and are revocable. |
| BR-R-12 | No feature may expose one tenant's data to another through search, exports, notifications or generated PDFs. |

## 11. Key business metrics and reporting

| Metric | Source | Cadence |
|---|---|---|
| MRR, ARR, churn | Billing | Monthly |
| Active orgs, active projects | Product DB | Weekly |
| Activation rate | Onboarding events | Weekly |
| Requirements approved / applicable | Product DB | Per project |
| Package generation success | Job logs | Weekly |
| Support tickets per project | Helpdesk | Monthly |
| Gross margin (infra + payment fees) | Finance | Monthly |
| Storage cost per org | Storage metrics | Monthly |

## 12. Risks to the business

| ID | Risk | Mitigation |
|---|---|---|
| RK-016 | Contractors will not pay enough to cover support | Self-serve onboarding, templates, paid pilot |
| RK-017 | Requirements vary too much | Configuration engine, import, professional onboarding (paid) |
| RK-018 | Main contractors mandate a specific platform | Position as subcontractor's internal system; export to any format |
| RK-019 | Payment aggregator onboarding rejected | Apply early; alternative PA |
| RK-020 | Legal/tax error | CA/counsel review before launch |
| RK-021 | Data breach destroys trust | Security architecture, tests, incident plan |
| RK-022 | WhatsApp policy/cost changes | Email fallback; provider abstraction |
| RK-023 | Founder bandwidth | Ruthless MVP scope, managed services |

## 13. Decisions required before first paid invoice

1. Billing entity and GST registration (India vs foreign).
2. Payment aggregator and merchant account.
3. Refund/cancellation policy.
4. Terms of service, privacy notice, DPA.
5. Data retention periods by plan.
6. Support channel and hours.
7. Whether pilot fees are credited on conversion.

All are tracked in `DECISIONS-AND-OPEN-QUESTIONS.md`.

## 14. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial business requirements |
| 0.2 | 2026-10-31 | Remediation: BR-BIL-12/13/14, BR-DAT-09, BR-SLA-03 assumptions, BR-GTM-07 owner digest |
