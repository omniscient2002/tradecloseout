# 00 — Product Vision

**Status:** Draft v0.2
**Change history:** v0.2 reconciles the ICP (AUD-B-01), sharpens positioning (AUD-B-03) and adds a Why-now section (AUD-B-12).
**Owner:** Product
**Depends on:** none
**Referenced by:** all documents

---

## 1. One-line definition

> **TradeCloseout is the handover file for Indian MEP subcontractors: every required document, for every asset, reviewed and approved, packaged for the client without a last-minute scramble.**

## 2. The problem

An HVAC subcontractor finishes installation, then discovers that final payment and defect-liability release depend on a document bundle that was never tracked:

- The O&M manual for the imported chiller arrived as a 300-page PDF in English from the manufacturer, but the consultant wants a project-specific manual with local service contacts and as-built equipment tags.
- The pressure-test report exists on a site engineer's phone as three photos.
- The warranty certificate is in the procurement manager's email, addressed to the main contractor, with the wrong serial number.
- The as-built drawing is revision C, but the approved shop drawing is revision B and nobody knows which one the consultant signed.
- The client's document controller has a 47-row Excel checklist with different column names from the main contractor's 62-row checklist.

The work is not hard in principle. It is hard because **requirements are fragmented, evidence is scattered, approvals are informal, and the final package is assembled under payment pressure.** Small contractors absorb this with a project manager's memory, WhatsApp, Excel and a junior engineer working nights.

Existing tools do not fit:

- Enterprise construction platforms (Aconex, Asite, Autodesk Docs) are priced and designed for large main contractors, consultants and PMCs.
- Generic project tools (Zoho, Trello, SharePoint) have no concept of a requirement, an equipment tag, a revision or a handover register.
- Document-management tools store files but do not answer "what is still missing for the chiller, and who must approve it?"
- Accounting tools (Tally, Zoho Books, Vyapar) know invoices, not technical closeout.

## 3. Product thesis

**Proposed thesis (H1):** Small and medium HVAC subcontractors will pay for a narrow, mobile-first system that (a) tells them exactly what is missing, (b) collects evidence from site staff and suppliers with minimal friction, and (c) produces a client-ready handover package with a defensible audit trail.

The wedge is not "project management". It is **closeout and payment enablement**. Contractors tolerate project tools; they *need* to get paid and to close defects.

**Positioning (`AUD-B-03`):** *TradeCloseout produces the file your main contractor will accept.* Aconex and Asite are priced for the main contractor; TradeCloseout is priced and designed for the subcontractor who has to feed them. Closeout is not novel — **price, simplicity and subcontractor-first design** are.

**Corollary:** The product must start at the end of the project, not the beginning. A contractor who adopts it three weeks before handover must still get value. Full lifecycle project management is a later expansion, not the entry point.

## 3b. Why now

Digital invoicing and e-invoicing raise the bar for structured records; main contractors are standardising on document-control platforms that subcontractors must feed; WhatsApp Business API makes low-friction supplier collection practical; retention and DLP disputes are getting more expensive; cheap mobile data makes site capture viable. These are **timing hypotheses** and must be validated in discovery interviews (`17` §2b).

## 4. Target customer

### 4.1 Ideal Customer Profile (ICP v1)

| Attribute | Target |
|---|---|
| Trade | HVAC installation and contracting (VRF/VRV, chillers, AHUs, ducting, ventilation) |
| Size | 20–120 employees; ₹5–80 crore annual turnover; **≤20 active commercial projects** |
| Project mix | Commercial offices, hospitals, hotels, malls, industrial facilities, institutional buildings; private developers and government/PSU |
| Geography | Tier-1 and Tier-2 Indian cities; **initially one city (Pune or NCR) to prove the model**, then Mumbai, Bengaluru, Hyderabad, Chennai, Ahmedabad |
| Current tooling | Excel registers, WhatsApp, email, shared drives, paper files; perhaps Tally for accounts |
| Trigger | Final bill, retention release, defect-liability period, client audit, or a rejected handover |
| Buyer | Owner/proprietor or a senior projects head |
| Daily user | Project manager, site engineer, document controller |

### 4.2 Secondary users

- Main contractors who need subcontractor closeout evidence (future buyer).
- HVAC consultants/PMCs who review submissions (future reviewer seats).
- Other MEP trades — electrical, plumbing, fire-fighting — as template packs only, not as a v1 market.

### 4.3 Explicit non-customers for MVP

- Large EPC contractors with existing Aconex/Asite deployments.
- Pure facility-management companies (they receive handover, not produce it).
- Residential-only small AC dealers doing split-unit installations.
- Contractors who need ERP, payroll, inventory or full accounting.

## 5. Jobs to be done

| # | Job | Current workaround | Desired outcome |
|---|---|---|---|
| J1 | "Tell me what documents this project needs." | Interpret contract, consultant checklist, past project | A project-specific checklist in minutes |
| J2 | "Collect a certificate from a supplier who barely uses email." | WhatsApp, phone calls, physical pickup | A no-login upload link that works on a phone |
| J3 | "Know what is missing before the client meeting." | Manually reconcile Excel | One missing-items view by asset and requirement |
| J4 | "Get the consultant to approve revision C." | Email threads, site meetings | A review with comments, decision and timestamp |
| J5 | "Prove what was submitted and when." | Sent-mail search | Immutable submission record and audit trail |
| J6 | "Produce the final handover file." | Junior engineer merges PDFs for days | Generated index + bookmarks + merged PDF/ZIP |
| J7 | "Survive staff turnover." | Files on someone's laptop | Company-owned, permissioned, searchable record |

## 6. Value proposition

For the contractor:

1. **Never lose retention to a missing document.** A live gap register tied to payment milestones.
2. **Stop chasing paper.** One link per supplier per requirement; uploads land in the right place.
3. **Pass the consultant's review faster.** Structured comments, revisions and approval history.
4. **Generate the handover package once.** Not a three-night PDF merge.
5. **Protect the company from employee turnover.** Company-owned evidence, not personal WhatsApp history.
6. **Look professional to main contractors.** Branded index, consistent naming, traceable approvals.

Quantified benefit is **unproven** and must be measured in pilots (see `17`). Do not claim specific hour or rupee savings in sales material until measured.

## 7. Product principles

1. **Completion over configuration.** A new org can create a project and see a usable checklist in under 10 minutes.
2. **Mobile capture, desktop control.** Upload from a phone in two taps; review and package from a laptop.
3. **Every requirement has an owner and a state.** No orphan documents, no implicit approvals.
4. **Evidence is immutable, corrections are versioned.** Files are never silently replaced.
5. **Configuration, not code.** New checklist items, fields, approval steps and package layouts are data.
6. **Snapshot, don't mutate.** A project's requirements do not change when a template is edited.
7. **The audit trail is a product feature**, not a database side effect.
8. **Low bandwidth is the default.** Compress previews, resumable uploads, no heavy dashboards.
9. **English first, translation-ready.** No text baked into images; all labels externalised.
10. **Do not collect data you do not need.** No Aadhaar, no personal IDs, no employee biometrics.

## 8. Scope

### 8.1 MVP (must ship)

- Organisation onboarding, members, roles, invitations.
- Parties: client, main contractor, consultant, suppliers.
- Projects, contracts and specification references.
- HVAC checklist template + project-level customisation.
- Assets/equipment register with tags.
- Document upload (mobile, resumable), revisions, metadata, linking to requirement/asset.
- Review/approve/request-changes with comments; waiver with reason.
- Missing-document dashboard, reminders (email + WhatsApp deep link), supplier upload links.
- Handover package generation (index PDF + merged PDF/ZIP).
- Audit log, export, basic search.
- Subscription billing in INR (Razorpay) with GST invoice data.

### 8.2 V1 (reliable commercial use)

- Custom fields, custom document types, configurable approval chains.
- Client/main-contractor guest review portal.
- Package submission and acceptance tracking.
- Email ingestion, bulk upload, ZIP import.
- OCR-assisted metadata suggestions.
- Retention/expiry automation, reminders escalation.
- API tokens and webhooks (limited).
- Regional language UI (Hindi first).

### 8.3 V2

- Electrical, plumbing, fire-fighting template packs.
- Main-contractor multi-subcontractor workspace.
- E-signature integration.
- Accounting/ERP connectors (Tally, Zoho Books).
- Advanced analytics, benchmark checklists, AI classification.

### 8.4 Out of scope (all phases unless revisited)

- Full project ERP: procurement, inventory, payroll, costing, billing.
- Design/BIM authoring.
- Structural, architectural or civil closeout.
- Payment escrow.
- Aadhaar-based identity, biometric attendance.
- On-premise deployment for individual customers.
- Native iOS/Android apps before PWA evidence.

## 9. North-star and guardrail metrics

**North star (proposed):** *Number of requirements approved per active project per month.* It measures real closeout progress, not seats or uploads.

| Metric | Definition | MVP target (hypothesis) |
|---|---|---|
| Activation | Org creates project + accepts checklist + uploads ≥1 doc within 7 days | ≥60% of signups |
| Time to first checklist | Signup → first project checklist visible | <10 minutes |
| Requirement completion | Approved requirements / applicable requirements at handover | ≥90% on pilot projects |
| Package generation | Handover packages generated successfully | ≥95% attempts |
| Weekly active projects | Projects with ≥1 review/upload per week | ≥50% of active |
| Supplier conversion | Invited suppliers who upload without support | ≥70% |
| Retention | Orgs active after 90 days | ≥70% of paying pilots |
| Support load | Tickets per active project per month | <0.5 |

These are targets, not evidence.

## 10. Commercial model summary

- **SaaS subscription**, INR, GST-compliant invoices, monthly and annual.
- **Per-company plan** with project and storage limits; optional per-project add-on.
- **Paid pilot** (8–12 weeks) before general availability.
- No per-document or per-supplier charges in MVP (suppliers must never be a friction point).
- Pricing hypotheses and validation thresholds are in `17`; pricing is **not confirmed**.

## 11. Differentiators

| Differentiator | Why it matters | Defensibility |
|---|---|---|
| Closeout-first, not project-management-first | Value on day one, even mid-project | Medium; can be copied |
| Equipment-centric requirement model | "Chiller 2 warranty missing" vs "some warranty missing" | Medium |
| Supplier no-login upload links | Reality of Indian supply chains | Low–medium |
| Indian contract/checklist library | CPWD/PWD/private patterns, local formats | Medium if curated |
| Immutable checklist snapshots + audit | Survives disputes and staff turnover | Medium |
| Handover package generator | Directly tied to payment | Medium |
| Price and mobile UX for 10–150 person firms | Enterprise tools ignore this segment | Medium |

The moat, if any, is **curated trade content + workflow data + switching cost of the project record**, not the software alone.

## 12. Key assumptions and risks

| ID | Assumption / risk | Impact if wrong | Validation |
|---|---|---|---|
| A-001 | Contractors, not main contractors, will pay | Buyer changes; GTM changes | 15 buyer interviews; 3 paid pilots |
| A-002 | Closeout is painful enough to buy software, not just Excel | No willingness to pay | Price test in pilots |
| A-003 | Suppliers will use a link without training | Collection still manual | Supplier conversion metric |
| A-004 | Contractors will upload during the project, not only at the end | Value delayed; churn | Activation/usage cohort |
| A-005 | A generic configurable checklist is usable without a consultant | Setup too hard | Time-to-first-checklist test |
| RK-001 | Requirements vary so much that templates are unusable | Heavy onboarding cost | 5 real checklists analysed |
| RK-002 | Low willingness to pay in Tier-2 | Smaller market | Segment pricing test |
| RK-004 | Consultants reject digital approvals | Audit trail incomplete | Reviewer interviews |
| RK-006 | Cross-tenant leak | Existential | Security architecture + tests |
| RK-008 | Legal/tax non-compliance in billing | Financial/legal exposure | CA and counsel review |
| RK-011 | WhatsApp API policy/cost changes | Notification channel breaks | Email fallback mandatory |

## 13. What "done" looks like for v1

A 40-person HVAC contractor in Pune runs a ₹12 crore hospital project on TradeCloseout:

1. PM selects the "Commercial HVAC — Consultant Review" template and adds two client-specific certificates.
2. Site engineer registers 38 assets by tag and uploads test reports from a phone.
3. Procurement invites 6 suppliers; 5 upload warranty and datasheet files without a login.
4. Consultant reviews 71 requirements, requests changes on 9, approves the rest.
5. PM generates a 480-page handover package with index, bookmarks and an approval summary.
6. The main contractor accepts it; the final bill is processed without a document dispute.
7. Six months later, a new engineer finds every approval and revision in under a minute.

If the product cannot deliver this, it has not met its own definition of done.

## 14. Long-term vision (3 years, non-binding)

Become the default closeout layer for Indian MEP subcontractors: a shared requirement graph between contractors, consultants and main contractors, with verified document status at the point of payment. Expansion by trade pack, then by geography (Gulf/South Asia) only after Indian retention is proven.

## 15. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial vision |
| 0.2 | 2026-10-31 | Remediation: ICP size band and geography narrowed; positioning sharpened; Why-now added |
