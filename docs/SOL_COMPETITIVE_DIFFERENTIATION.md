# SOL — Competitive Differentiation

**Evidence discipline.** Competitor facts below come from pages I could actually fetch in this session:
- Procore pricing page: https://www.procore.com/pricing **[R]**
- Procore inspections page: https://www.procore.com/quality-safety/inspections **[R]**
- Oracle Aconex product page: https://www.oracle.com/in/construction-engineering/aconex/ **[R]**
- ISHRAE site: https://www.ishrae.in/ **[R]**

I **could not** fetch Autodesk Build (HTTP 403). The Indian-specialist sites I tried returned either nothing (`powerplay.in`) or a domain-for-sale page (`buildesk.com`). I therefore state **nothing factual** about Autodesk's feature set, nor about the pricing or capability of Indian construction-software vendors. Treat those as **open research tasks** (see §8). I give no market-size, adoption or willingness-to-pay statistics, because I have none that are sourced.

---

## 1. What the incumbents sell (from their own pages)

### Procore **[R]**
- Pricing is an **annual fee by product, based on Annual Construction Volume (ACV)**; "unlimited users, unlimited data, 24/7 support"; custom quote; there is no public price. Collaborators (subs, vendors, clients) are included with no seat charges.
- Offers inspections software (customisable inspection templates, issue tracking, real-time data, reporting), cost management, resource management, project execution, 500+ integrations.
- Implication: Procore's model is attractive to a **general contractor or owner** with substantial volume. A 20-person HVAC subcontractor is a poor fit for an ACV-priced enterprise contract, and mostly meets Procore as a *guest* in the GC's account. **[H]** (I have no data on Indian Procore penetration.)

### Oracle Aconex **[R]**
- Positioned as the **contractual system of record** across organisations; "each organisation owns its data"; unalterable audit trail; document register with versioning; review matrix and comment management; RFIs; ITPs (inspection and test plans); work packaging; supplier document management; contract/cost/change management; mobile "Aconex Field" for inspections/punch lists/daily reports; project archives (online, on-prem, scheduled); "Project closeout and archiving" listed explicitly.
- Implication: Aconex already covers *closeout in principle* but as one module of a heavyweight platform for large, complex projects (their own words: "particularly well suited to large, complex projects"). The subcontractor usually does not buy it; the owner or main contractor does, and the subcontractor is a participant.

### Autodesk Build, Indian ecosystem
Not researched (blocked). **Do this before positioning copy is finalised.**

### ISHRAE **[R]**
- 25,000+ members, 51 chapters/sub-chapters, events including ACREX India 2027 (Greater Noida, 11-13 Feb 2027) and an Annual Conference (July 2026). Useful as a **distribution channel** (chapter events, technical talks) and as a legitimacy partner. Not a competitor.

---

## 2. Where incumbents leave a gap for a *subcontractor-owned* product **[H], to validate**

| Gap | Why it exists | TradeCloseout opportunity |
|---|---|---|
| The subcontractor's records live in someone else's tenant | Aconex's model is per-organisation workspaces, which helps, but only if the subcontractor is invited and the invitation lasts; Procore subs are guests of the GC | Offer a **contractor-owned record** that ingests decisions via e-mail/WhatsApp from *any* upstream system |
| Heavy ACV/enterprise pricing and implementation | Procore's pricing page emphasises custom quotes and implementation services | **Per-active-project pricing for specialty contractors**, self-serve onboarding from Excel |
| General-purpose templates | Inspection and doc modules are industry-agnostic | **HVAC-specific**: equipment passport, test templates (hydro, duct leakage, flushing, TAB), approved-make guard, ISHRAE/ASHRAE/SMACNA/BSRIA-aware checklists |
| Closeout as a late module | Aconex lists closeout among many features | **Closeout as the primary job**, with money gates and DLP tail |
| English-only, desktop-oriented | Typical of enterprise tools **[H]** | WhatsApp-first, vernacular field screens, offline capture |
| No view of "money held by documents" | Cost modules track budgets, not "what document releases which retention" | **Money Gates** |
| Data leaves with the project | Archives exist (Aconex offers three) but are separate products | **Self-verifying archive** with equipment passports kept alive for FM |

These are hypotheses until 10+ contractor interviews confirm that (a) they do not already get what they need from the GC's tool, and (b) they would pay on their own.

---

## 3. The real competitors (what customers do today) **[P]**

1. **Excel + WhatsApp + e-mail + Google Drive/Windows folders.** Free, universal, flexible; weak on audit trail, ownership and expiry. This is the competitor to beat and the one to **import from**.
2. **The main contractor's or PMC's CDE** (Aconex, Procore, SharePoint, in-house).
3. **A dedicated document controller** (human) producing binders.
4. **ERP/accounting packages** (Tally and similar) for billing, not closeout.
5. **Indian construction-management SaaS vendors**: unknown features and pricing to me; **must be surveyed** before launch.

Hence: the buying decision is "replace a spreadsheet and a binder-making person," not "replace Procore". The value story must be measured against hours of document-controller time, days of retention release delay, and rework cost of rejected submittals.

---

## 4. Positioning

**Category:** closeout & handover operations for MEP specialty contractors (starting with HVAC).
**One-line promise:** *"Know exactly what is blocking your money, and prove the work was done: for every piece of equipment, on every project."*

Avoid: "construction ERP," "AI-powered," "document management" (all crowded and undifferentiated).

Positioning statements by audience:
- **MD/owner:** "See the rupees held by missing paperwork, and who is holding them."
- **Project manager:** "Stop chasing. The system chases suppliers, tells you which consultant is overdue, and builds the handover."
- **QC/site engineer:** "Take the photo, tag the equipment, done. Works with no signal."
- **Document controller:** "Everything the consultant sent, matched to the right item, with proof of when."
- **Main contractor / PMC (secondary buyer):** "Get complete, indexed subcontractor closeouts on time."

---

## 5. Defensible advantages (and honest durability)

| Advantage | Durability | Why |
|---|---|---|
| **Equipment-centric HVAC data model & templates** | Medium | Competitors can add templates; a deep HVAC library plus customer data is slower to copy. |
| **Contractor-owned record across upstream systems** (decision register via e-mail/WhatsApp) | Medium-High | Requires channel integrations and matching quality; incumbents are architecturally tied to "everyone on our platform". |
| **Cross-project history per consultant/supplier** (cycle times, rejection reasons) | High over time | Data network effect within a contractor; switching cost grows with every project. |
| **Money Gates linked to evidence** | Medium | Needs contract terms + item mapping; simple conceptually, hard to get right; strong emotional hook for owners. |
| **Post-handover equipment QR for client FM** | Medium | Creates a client-side pull and viral spread to other contractors on the client's sites. |
| **Evidence integrity** (hashes, hash-chained audit, immutable versions, RLS isolation) | Low-Medium alone | Table stakes for Aconex-class buyers; valuable to *mention* but not a headline for subcontractors. |
| **Price/onboarding** | Low | Can be copied; still decisive early. |

**Not defensible alone:** PDF compilation, checklists, role-based access, "AI", dashboards.

---

## 6. Why customers would adopt, reject or pay **[P/H]**

**Adopt if:**
- They can start in a day by importing the consultant's Excel and a folder of PDFs.
- The first project shows a **specific rupee amount unblocked** or **hours saved** at the next handover.
- Suppliers can respond from WhatsApp without learning a new tool.
- The main contractor/consultant accepts the output (indexed dossier, IR records) without friction.

**Reject if:**
- It adds a second system to feed (double entry) with no obvious payoff.
- Site staff must type on a phone.
- Upstream parties refuse the format or insist on their own portal.
- It "loses" a document once (see `upload-sheet.tsx:166-175` fake success **[V]**).
- Price is perceived as per-user or per-GB.

**Pay if:** the MD sees blocked-money visibility, fewer rejected submissions, faster retention release, and a defensible record for disputes. Prices in the repo (₹4,999-19,999/month, `02-BUSINESS-REQUIREMENTS.md:46-48`) are unvalidated.

---

## 7. Go-to-market, pricing and economics

### 7.1 Ideal customer profile (ICP) **[H]**
- HVAC (and later fire-fighting/plumbing/electrical) **specialty contractors** with 5-50 concurrent projects, ₹20-300 crore turnover (range is a guess to test), delivering to consultant-reviewed commercial, hospital, data-centre, industrial or government jobs.
- At least one PM or senior QC accountable for handover and a document controller or doc-handling engineer.
- Pain signals: retention released late; repeated consultant rejections; a person assembling binders for weeks; DLP calls handled by phone.

### 7.2 Buyer and users
- **Buyer:** MD/director or commercial head (rupee visibility). **Champion:** project manager/QC head. **Daily users:** QC, site engineers, doc controller, procurement. **External:** suppliers, consultants, clients (free).

### 7.3 Pricing structure (to test, not decide)
- Prefer **per active project per month** (or per project with a closeout fee), unlimited internal users and unlimited external guests, storage included within fair-use. This mirrors the customer's mental model (money per project) and the strategy used by Procore of not charging per collaborator **[R: unlimited users]**, scaled down.
- Tiers by *capability*, not seats: Closeout (checklists, evidence, handover), + Site Quality (IR, tests, snags), + Commercial (Money Gates, portfolio).
- Optional **done-with-you onboarding** fee for importing historical projects.
- Alternative to test: success-linked pilot price tied to first handover.
- Cost of serving: storage is small; the largest variable costs are WhatsApp/SMS messages and support hours. Cap with fair-use and price messaging into the plan. Track cost per active project from day one.

### 7.4 Smallest compelling paid product ("wedge")
**"Closeout Control Tower" for one HVAC project:** import checklist + equipment schedule, supplier request links over WhatsApp, evidence capture on phone, decision register via forward, waiting ledger, money-blocked view, handover dossier. No billing, no signatures, no customisation engine, no AI.
Success test: a pilot contractor finishes a real handover with it, and says they would not go back.

### 7.5 Expansion path
1. Closeout wedge -> 2. Site quality (IR, tests, snags) in-project daily use -> 3. Procurement/MAR chain -> 4. Money Gates & portfolio -> 5. Post-handover FM QR/DLP service desk -> 6. Other MEP trades -> 7. Main-contractor/PMC "subcontractor closeout compliance" module (new buyer).

### 7.6 Integrations to prioritise
| Integration | Priority | Why |
|---|---|---|
| WhatsApp Business API | High | Where suppliers and site staff are **[P]** |
| Inbound e-mail parsing | High | Where consultants reply |
| Excel/CSV import/export | High | Everyone uses it |
| Tally / accounting export (read-only CSV) | Medium **[H]** | RA bill support later |
| Aconex/Procore **export-import** (CSV/PDF packages, not API) | Medium | Avoid API dependence; ingest what the GC gives |
| Google Drive/OneDrive folder import | Medium | Existing evidence |
| Primavera/MS Project | Low | Not needed for closeout |
| BMS/CAFM | Low-Medium later | FM handover |

### 7.7 Retention and expansion levers
- Equipment passports stay live through DLP and AMC (months to years).
- Cross-project history (consultant and supplier analytics).
- Templates tuned to each consultant/client (switching cost).
- Weekly MD digest that reports rupees unblocked.

---

## 8. Open research tasks (do before claiming anything publicly)
1. Autodesk Build/ACC and Indian-vendor feature and price survey (could not fetch).
2. Whether major Indian main contractors/PMCs mandate a specific CDE and whether they accept subcontractor-generated dossiers.
3. Statutory/tax points (GST on SaaS, e-invoice threshold, TDS rates, DPDP Rules timelines, CERT-In incident reporting): all earlier "VERIFIED" rows need a CA/lawyer review; I could not independently confirm.
4. CPWD GCC/Works Manual clauses relevant to completion and DLP for government/PSU customers.
5. Willingness to pay: 10+ interviews, 3 paid pilots.
6. Typical retention and DLP terms in actual subcontracts (collect 10 real subcontract clauses).
7. WhatsApp Business API cost and template-approval constraints.

---

## 9. Summary of competitive stance
TradeCloseout should not try to out-feature Procore or Aconex. It should be the **specialty contractor's own system of record for equipment, evidence and the money that depends on it**, that coexists with whatever upstream platform the project uses, is priced by project, works through WhatsApp and e-mail, and shows the MD what is blocking cash.
