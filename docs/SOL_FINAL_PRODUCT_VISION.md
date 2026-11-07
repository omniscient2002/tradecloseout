# SOL — Final Product Vision

Analysis only. This is the version of TradeCloseout I would build and fund, given what the repository actually contains and what I could and could not verify. Hypotheses are marked **[H]** and must be tested with customers.

---

## 1. One sentence
**TradeCloseout is the specialty contractor's own system of record for equipment, evidence and the money that depends on it: it shows what is blocking cash, chases the people responsible, and produces the handover.**

## 2. Who it serves

| Person | What they get |
|---|---|
| **MD / owner** (buyer) | "₹X is held by N missing items; here is who holds each." A Monday digest. Cross-project view of slow consultants and suppliers. |
| **Project manager** (champion) | A Work Inbox that tells them whom to chase and what is overdue; a handover that assembles itself. |
| **QC / site engineer** (daily user) | Phone-first capture: scan equipment QR, snap photo, done; works offline; raises inspection requests; logs snags. |
| **Procurement** | Supplier document requests per PO, approved-make check, reminders over WhatsApp. |
| **Document controller** | Every consultant/client decision matched to the right item with the original attached and timestamped. |
| **Supplier** (free, no login) | One page: "send these 7 documents for PO-2231," with examples; respond by phone or WhatsApp. |
| **Consultant / client** (free, link-based) | Review in one click, coded reasons, and a complete indexed dossier at the end. |
| **Client FM team** (free, later) | Scan a unit's QR: warranty, service contact, raise a defect call. |

**Initial segment [H]:** HVAC specialty contractors with consultant-reviewed projects, later other MEP trades; secondary buyer: main contractors/PMCs wanting complete subcontractor closeouts.

## 3. What it is

Five things, in order of importance:

1. **Equipment Passport.** Each tag is the spine: approved make, submittals, PO/delivery, inspections, tests, commissioning, warranty clock, O&M, service history, QR. Requirements are generated from equipment type x template, imported from the consultant's Excel and the equipment schedule.
2. **Decision Register.** Everything decided outside the product (consultant mails, WhatsApp photos, stamped PDFs) enters through forward-to-project-address or WhatsApp, is matched deterministically to the item, confirmed by a human, and timestamped. The contractor owns the record regardless of the upstream platform.
3. **Waiting Ledger and Money Gates.** Every hand-off has a clock. Every held rupee (retention, BG, final bill, disputed variation) has release conditions mapped to specific items. The MD's home screen is *rupees blocked, by whom, for how long*.
4. **Site quality loop.** Material approvals, deliveries, inspection requests with hold points, structured test records with automatic pass/fail and calibration-validity checks, snags: all captured on a phone, offline-capable, in the user's language.
5. **Handover and after-sales.** A completeness gate that says exactly why it is blocked; a frozen, indexed, verifiable dossier; acceptance capture; DLP/warranty clocks and a snag desk that keeps the product alive for 1-5 years after handover.

## 4. What it contains (surface area)

- Home: Work Inbox (site/QC/doc control), Portfolio (MD/PM).
- Projects: Today, Deliverables (matrix + list), Equipment, Submissions (MAR, IR, tests, decisions), Money (role-restricted), Handover, After-sales, Files.
- Cross-project: Equipment search, Parties and scorecards, global Search, saved reports.
- External pages (no account by default): supplier request page, consultant/client review page, FM QR page.
- Settings: team, templates, notifications, billing (low prominence).

## 5. What it is built on (keep, simplify)

- Single Postgres with forced row-level security; SQL migrations as the single schema source.
- Immutable evidence versions with hashes, quarantine states, hash-chained audit log.
- One worker for virus scanning, PDF compilation and notifications; one object store; one outbound adapter (WhatsApp/SMS/e-mail) with delivery receipts; one inbound adapter (e-mail/WhatsApp).
- A small, explicit state machine per deliverable type, with *waiting-on-whom* as a first-class derived field.
- Deterministic automation first (rules, exact matching, calendar maths); AI only where validated and always with human confirmation and visible source.

## 6. What it deliberately avoids

| Avoid | Reason |
|---|---|
| Construction ERP, accounting, payroll, inventory | Crowded, low differentiation, distracts from closeout/cash. |
| Its own e-signature/DSC engine | Needs licensed providers and chain verification; integrate or accept stamped PDFs. |
| In-house e-invoicing and heavy SaaS-billing machinery | Use an off-the-shelf billing service; confirm tax obligations with a CA. |
| A configuration "engine" with layered overrides | Templates plus per-project edits cover real needs. |
| BIM, clash detection, scheduling | Not the subcontractor's closeout problem. |
| Marketplace / contractor matching | Different business. |
| "AI health scores", generated rejection prose | Low trust, low value; coded reasons do the job. |
| Per-seat or per-GB pricing | Contradicts the buyer's mental model and discourages guest adoption. |
| Simulated success anywhere | A compliance product that lies is worth nothing. |

## 7. Principles
1. **Truthful by construction.** "Filed" means stored, scanned and hashed. "Sent" means delivered or visibly failed.
2. **Meet people where they are.** WhatsApp and e-mail in, PDFs and Excel out; no forced logins for externals.
3. **Phone first for site, desktop first for office.**
4. **Show rupees and days.**
5. **Enter once.** Equipment, makes, contract terms and parties are typed once and inferred everywhere after.
6. **Contractor-owned.** Export everything; the record outlives the project and the upstream platform.
7. **Few statuses, plain words, local languages for the field.**
8. **Deterministic before intelligent.**

## 8. The commercial shape [H]
- Priced per active project (unlimited internal users, unlimited external guests), tiered by capability: Closeout, + Site Quality, + Commercial.
- Entry: concierge onboarding from Excel and an existing folder; first handover is the proof.
- Retention: equipment passports live through DLP; cross-project history raises switching cost; the MD's weekly digest keeps the buyer engaged.
- Expansion: other MEP trades, then main-contractor/PMC "subcontractor closeout compliance" as a second buyer, then client FM.

## 9. How we will know it is working
- A pilot contractor completes a real handover and **would not return to spreadsheets**.
- Measured: setup time < 1 day, supplier first-pass acceptance up, doc-control hours down, retention/BG release days down, weekly active users per account, support tickets per active project < 0.5 (the repo's own target).
- Three paid pilots at or above the tested price before scaling features.

## 10. What must be true (assumptions to disprove quickly)
1. The subcontractor (or main contractor) will pay for closeout and cash-release visibility, not just document storage.
2. Upstream parties will accept contractor-generated dossiers and decisions captured via forward/WhatsApp.
3. Site and supplier staff will use WhatsApp-linked flows rather than needing accounts.
4. Retention/BG/DLP terms are regular enough to model as release conditions.
5. Contractors keep consultant-specific checklists that can be imported with high automatic mapping.

If two or more fail in interviews and pilots, the product must be re-scoped (e.g. as a main-contractor/PMC compliance tool, or a lightweight handover compiler only).

## 11. Honest caveats about this analysis
- My code audit was a targeted sample after a planned deeper parallel review failed for lack of credit; modules not read in full are named in `SOL_FINAL_PRODUCT_ANALYSIS.md` §0.
- I did not run the tests or the application, and did not open the screenshots.
- Autodesk, CBIC, CPWD and Indian competitor pages could not be fetched; no statutory or competitor claim beyond Procore, Aconex and ISHRAE public pages is asserted as researched.
- All Indian-industry workflow statements marked **[P]** are practitioner-style knowledge to validate, not statistics or customer quotes. The repository's "executive stories" are fiction and were not used as evidence.
