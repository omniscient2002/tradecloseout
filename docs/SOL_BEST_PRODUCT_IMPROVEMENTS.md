# SOL — Best Product Improvements

**Scope:** recommendations only. No code. Evidence tags as in `SOL_FINAL_PRODUCT_ANALYSIS.md`: **[V]** verified in repo, **[R]** researched, **[P]** practitioner knowledge to validate, **[H]** hypothesis.

Every item answers: *what, why, who feels it, better solution, how it improves the product, difficulty, prerequisites, success metric.* Difficulty: S (days), M (2-4 weeks), L (1-3 months), XL (>3 months) for one small team.

Classification key: **MUST** / **DIFF** (high-value differentiator) / **FUTURE** / **VALIDATE** (customer validation required) / **NO** (do not build).

---

## Part A. Make the existing core honest (prerequisite to everything)

### A1. Remove every simulated success from user-facing paths — **MUST**, S-M
- **What:** (a) upload failure must show failure and keep the draft (`upload-sheet.tsx:166-175` currently fakes `demo_ver_123` and deletes the draft); (b) OTP/email/notification providers must either deliver or fail loudly (`identity.module.ts:56-78`, `notifications.service.ts:36-56`); (c) preview must read through the storage adapter, not `/tmp/tradecloseout-sim` (`documents.service.ts:721-727`); (d) remove client-controlled "EICAR" flags from the production path (`documents.service.ts:471-476`) and keep only the worker's ClamAV result; (e) bulk-import dry-run returning canned data (`~890-910`) must be disabled until real.
- **Why:** the product's value proposition is *"this evidence is filed and provable."* One silent loss destroys it.
- **Who feels it:** site engineers (believe a certificate was filed), QC leads (rely on the status), MDs (rely on the dossier).
- **Better solution:** a single "upload receipt" concept: the UI only shows "Filed" after server returns version id + SHA-256 and the worker marks it READY; "Pending sync / Failed - retry" states are explicit and visible in a persistent outbox.
- **Metric:** zero occurrences of success-without-persistence (automated test per path); upload success rate and median time-to-READY on a real 3G/4G throttle.

### A2. Real delivery channels: WhatsApp-first, SMS/e-mail second — **MUST**, M
- **Problem:** Notifications and OTP are rows with no sender **[V]**. In India, site staff and suppliers live on WhatsApp **[P]**.
- **Solution:** one outbound adapter (provider-agnostic, with delivery receipts) and one inbound path (see B2). OTP via DLT SMS (regulatory registration required) with e-mail fallback; reminders via WhatsApp Business templates. Add per-user quiet hours (already modelled).
- **Prereq:** choose provider; DLT template registration for SMS; WhatsApp Business template approval (lead time to be confirmed with the provider).
- **Metric:** % reminders delivered and read; median supplier response time before/after.

### A3. Collapse duplicate/competing implementations — **MUST**, M
`TRADECLOSEOUT_PRODUCT_SIMPLIFICATION.md` §3 is right: two review paths, two guest mechanisms, duplicate status vocabulary (`IN_REVIEW`/`UNDER_REVIEW`), a patch bucket (`perfect-10-patches`). Choose one each, delete the other. Reconcile `schema.ts` with SQL migrations (three tables exist only in SQL **[V]**) by picking SQL migrations as the source of truth and generating types from the database, or the reverse; not both.
- **Metric:** one status enum per entity; one schema source; CI check that fails on drift.

### A4. Quarantine unsound modules — **MUST**, S
Hide `signatures` (stores caller-supplied hashes, no chain verification **[V]**), `billing` (SaaS invoicing/e-invoice) and the "customisation engine" behind feature flags or remove from the pilot build. Re-introduce only when a customer asks and a licensed provider (eSign ASP, billing platform) is chosen.

---

## Part B. The new spine: from "closeout documents" to "equipment x deliverable lifecycle"

### B1. Equipment Passport as the entry point — **DIFF**, M-L
- **Problem:** the same equipment is re-keyed into ~6 artefacts across a project **[P]**. TradeCloseout already has `assets` with identity revisions **[V]** but uses assets only as a filter on documents.
- **Solution:** import the equipment schedule (BOQ/design schedule/Excel) once; each tag (CH-01, AHU-L3-04) becomes a **passport page** that accumulates: approved make/model, submittal status, PO and delivery, MIR, factory test, installation inspection, pre-comm, commissioning, warranty start/end, O&M link, service contact, QR code. Checklist requirements are *generated from* equipment type x template instead of typed.
- **Who:** QC engineer and site engineer (daily), document controller, later the client FM team.
- **Why better:** removes re-keying; creates a daily-use object; powers post-handover value.
- **Metric:** minutes to create a project's full requirement set (target < 1 hour from an Excel schedule); % of equipment with complete passports at handover; FM scans per passport after handover.
- **Prereq:** A1, import-quality work (B4).

### B2. Decision Register fed by e-mail forward and WhatsApp - **DIFF**, M-L
- **Problem:** consultant/client decisions happen *outside* the contractor's system (stamped PDF by e-mail, WhatsApp photo, verbal) **[P]**. The repo's "external approval" flow exists but requires manual data entry **[V]** (`external-approval-modal.tsx`).
- **Solution:** give each project a unique inbound e-mail address and a WhatsApp number. The user forwards the consultant's mail or sends a photo; the system stores the original, extracts sender/date/subject, suggests the matching submittal/requirement (deterministic match on document number / equipment tag / revision first; human confirms), and records the decision (Approved / Approved-as-noted / Revise-resubmit / Rejected) plus comments.
- **Why:** meets users where they are; closes the loop without forcing the main contractor to adopt our tool; yields a contractor-owned proof of "what was sent and when".
- **Metric:** % decisions captured within 24h of receipt; manual-keying time per decision (< 30 s with suggestion).
- **Risk:** parsing quality; privacy of forwarded content; must always show original.

### B3. Waiting Ledger and Delay Evidence Pack - **DIFF**, M
- **Problem:** subcontractors can't show "consultant held MAR-114 for 31 days" when claiming extension of time, or when pushing for payment **[P]**.
- **Solution:** every submittal/inspection/decision is a timestamped hand-off ("sent to X at T", "returned at T"). The ledger shows days-with-party. One click produces a dated, hash-chained PDF listing all items where the *other party* exceeded the contractual response period (period entered per project).
- **Who:** project manager, commercial head, MD.
- **Metric:** claims/escalations backed by ledger; average overdue days per reviewer; recovered EOT days or payments (self-reported in pilots).
- **Prereq:** B2 (or manual entry), per-project response-time setting.
- **Note:** the repo already has a hash-chained audit log and review timestamps **[V]**; this is mostly a new read model and PDF.

### B4. Import-first onboarding - **MUST**, M
- **Problem:** nobody will type 300 requirements. The repo has Excel ingestion scripts (`scripts/test-real-excel-ingestion.ts`, `reconcile-consultant-checklist.ts`) and a 24-row fixture.
- **Solution:** a guided import for three inputs: consultant closeout checklist (Excel/PDF), equipment schedule (Excel), existing document folder (zip). Column mapping UI with remembered mappings per consultant; dry-run showing matched / ambiguous / unmatched rows; no bulk creation until confirmed.
- **Metric:** time-to-first-populated-project; % rows auto-mapped without manual edit (track per consultant template).
- **Prereq:** collect 5+ real consultant checklists (the repo's own M3 gate; not yet met).

### B5. Approved-Make Guard - **DIFF**, S-M
- **Problem:** ordering/delivering a make not on the approved list is a common avoidable rejection **[P]**.
- **Solution:** per project, per item, store the contract's approved make list. At PO creation, at MIR, and at passport level: deterministic check ("Make not in approved list; approval via MAR-xx? Y/N"). No AI.
- **Metric:** count of off-list deliveries caught before dispatch; reduced re-supplies (self-reported).
- **Prereq:** equipment schedule import; PO capture (D1).

---

## Part C. Site quality workflow: the daily-use loop

### C1. Inspection Request (IR) with hold points - **DIFF**, M
- **Problem:** IRs and hold-point releases (pipe hydrotest, duct leak test, insulation before cladding, pre-commissioning) are typically paper or WhatsApp, and the *absence* of a signed IR before concealment becomes a closeout failure **[P]**.
- **Solution:** a mobile-first form: select equipment/area -> checklist from ITP template -> photos -> request to consultant/main-contractor inspector by link (no login) -> response (approve / comment) captured with timestamp, plus the *notice period* clock. Block "next activity" is not necessary; show warning only.
- **Who:** site engineer, QC engineer, client/consultant inspector.
- **Metric:** IR cycle time; % completed hold points with signed IR at closeout; reduction in "missing record" requirements.
- **Prereq:** B1, B2/A2, mobile shell (UX doc).

### C2. Test results as data (pressure, leakage, flushing, TAB, electrical) - **DIFF**, M-L
- **Problem:** results are in PDFs; pass/fail is read by eye; instrument calibration validity vs test date is rechecked manually **[P]** (the fixture's row 4.4 states this requirement).
- **Solution:** structured test templates (value fields, acceptance criteria, instrument ID, duration, witness). Pass/fail computed deterministically; instrument calibration validity auto-checked against test date; the PDF report is *generated from* data and attached. OCR-based extraction is optional, later.
- **Metric:** % tests with computed pass/fail; # of calibration-validity rejections prevented; time to compile test pack.
- **Prereq:** B1; template library for 8-10 HVAC test types (validate with 2-3 QC engineers).

### C3. Material submittals (MAR) and delivery/MIR in the same chain - **MUST (VALIDATE scope)**, M
The repo's requirement/review model fits MAR well, but there is no MAR concept. Add MAR as a requirement type with revisions, the approval code from the consultant, and a link to equipment + PO + delivery (MIR). This turns closeout into the *natural end* of a continuing chain.
- **Metric:** % deliverables created at the right stage (not retroactively); closeout documents that existed before completion.

### C4. Snag list and DLP callback in one object — **MUST**, M
- Defects tables exist **[V]** but UI is a tab. Make snags/DLP calls first-class: photo + location + equipment tag + owner + due date; WhatsApp link to the technician; auto-attach warranty status from the passport; closure with photo; ageing view.
- **Metric:** snag closure time; % DLP calls answered within contractual response time.

---

## Part D. Commercial intelligence (what makes the MD pay)

### D1. Money Gates view — **DIFF**, M
- **Problem:** the current "retention at risk" = value x retention% (`organisations.service.ts:74`) is not actionable **[V]**.
- **Solution:** a ledger per contract of money held (retention, BG, final bill, disputed variation) with *release conditions* mapped to specific requirements/snags/DLP dates. The dashboard states "₹X lakh is blocked by 7 items: 3 with consultant (avg 18 days), 2 supplier docs, 2 internal". Click-through to the items.
- **Who:** MD, commercial head, project manager.
- **Metric:** days-to-release of retention/BG vs baseline; % of money gates with named blocker.
- **Prereq:** contract terms captured (retention %, release stages, DLP, BG); item-to-gate mapping.
- **Caveat:** money values are sensitive; per-role visibility is required (UX doc).

### D2. RA bill support pack (not an accounting module) — **VALIDATE**, M
- **Problem:** RA bills typically require quantity measurements, certified work, and statutory/QC attachments **[P - validate]**. TradeCloseout should *not* become an accounting tool.
- **Solution:** for each RA bill, generate a supporting dossier from existing records (approved IRs, MIRs, delivery proofs, test certificates, manpower/compliance attachments) indexed by BOQ line. Keep amounts/measurements out unless validated as essential.
- **Metric:** time to assemble bill attachments; first-time acceptance rate by main contractor.
- **Validation:** shadow 3 billing cycles before building.

### D3. Variation/instruction evidence trail — **VALIDATE**, M
- The repo has a create-only variation endpoint **[V]**. Real value is linking *an instruction/RFI/e-mail* to the affected equipment/quantity and proving "executed at client's instruction" with dated evidence. Build only after B2 exists (the evidence source).

### D4. Portfolio view across projects — **DIFF**, S-M after data exists
- Which projects are closest to money release; which consultants/suppliers are slowest; which requirement types are rejected most. Deterministic aggregation, not "AI insights".

---

## Part E. Supplier collaboration

### E1. Supplier portal with *no login by default* - **MUST**, M
- Link-based requests (the guest grant exists **[V]**) but redesigned as a **document request checklist per PO**: "send these 7 documents for PO-2231 by 12 Dec". Upload via phone, WhatsApp forward, or e-mail. Automatic reminders. Show supplier their own rejection reasons with examples.
- **Metric:** supplier first-pass acceptance rate; days from PO to complete documentation.

### E2. Supplier scorecard from facts — **FUTURE**, S
- Cycle time, first-pass acceptance, rejection reasons by supplier. Facts only; no opaque scores. Shared with the supplier optionally.

---

## Part F. Handover, acceptance and after

### F1. Handover builder with completeness gate - **MUST (exists, improve)**, M
- Keep the compiler. Add: pre-flight completeness report with *why blocked* per item and who holds it; client-specific index templates; stamped cover with verification QR; version-frozen output; acceptance capture (client e-sign or stamped PDF through B2).
- **Metric:** time from "last item approved" to "package delivered" (target < 1 day); client first-pass acceptance of dossier.

### F2. Equipment QR for FM team — **DIFF**, M
- Printed QR on each unit opens a *read-only* public/limited page: tag, make, serial, commissioning date, warranty end, service contact, last service, "report a problem" form -> creates a DLP/defect call. Free for client FM teams; the supplier of the *contractor's* brand presence.
- **Why:** extends life of the product past handover and creates a viral loop to the client's other contractors.
- **Metric:** scans/passport; defect calls via QR; clients asking for the same on other projects.

### F3. Warranty & DLP timeline with expiry reminders — **MUST**, S-M
- Warranty start = date of commissioning/acceptance (not invoice date) per contract; automatically computed end; reminders at 90/30/7 days to the *contractor* ("claim the OEM's warranty before it lapses", "DLP ends in 60 days: close snags to release retention").

### F4. Long-term archive export — **FUTURE**, S
- A self-contained ZIP + index + hash manifest (Top-25 #7). Cheap and a trust feature; build once, later.

---

## Part G. AI and automation (deterministic first)

| # | Idea | Value | Feasibility | Accuracy need | Privacy | Human check | Deterministic alternative? | Verdict |
|---|---|---|---|---|---|---|---|---|
| G1 | Auto-classify an uploaded file to a requirement (filename + text + tag) | High at onboarding/bulk | Medium | Suggest only; >90% top-3 | Document text leaves tenant if cloud LLM | Always confirm | Rules on tag/doc-number/regex cover most | **DIFF**: rules first, ML later |
| G2 | OCR key fields from test/warranty certificates (serial, dates, values) | High if C2 exists | Medium (scanned Indian PDFs vary) | High for dates/serials; show crop for check | Moderate | Mandatory confirm | None for scans | **VALIDATE**: after C2 |
| G3 | Cross-check serial/model across docs (FAT vs nameplate vs warranty) | High (catches classic mismatches) | Medium | Flag, never auto-reject | Low | Yes | Exact string compare once extracted | **DIFF** (needs G2) |
| G4 | Compare revisions of drawings/reports and highlight changes | Medium | Hard for scanned | n/a | n/a | Yes | Metadata-only diff is enough at first | **FUTURE** |
| G5 | Draft rejection-reason responses to suppliers | Low | Easy | Low risk | Low | Yes | Coded reasons library does 80% | **NO** (use coded reasons) |
| G6 | Predict "this project will miss handover" | Medium | Needs data from many projects | n/a | n/a | n/a | Simple rules on open money gates + ageing | **NO** until 20+ projects |
| G7 | Natural-language search over all project evidence | Medium | Medium | Cite sources always | Moderate | n/a | Metadata + full-text search first | **FUTURE** |
| G8 | Extract contract obligations (retention, DLP, response periods) from the PDF contract | Medium-high | Medium | Must show clause text | High sensitivity | Mandatory | Manual 10-field form takes 5 minutes | **VALIDATE** — manual form first |

Principle: *do not ship AI where a structured form, regex, or an exact-match comparison is more reliable.* The product's trust claim depends on determinism.

---

## Part H. Mobile & offline field operations

- **Problem:** the offline outbox exists, but the service worker caches only `/login` and a manifest **[V]**, so a site engineer in a basement plant room cannot open the app or the checklist.
- **Solution (S-M):** cache the app shell and the assigned project's *requirements, equipment list and IR templates* locally (read), queue writes (photos, IRs, test entries) with visible sync state; camera-first capture with compression; minimal text entry; voice note attachment. Hindi/Telugu/Tamil/Marathi labels on the field screens (validate which languages with real users).
- **Metric:** % captures done offline that sync without conflicts; median taps to file an inspection photo (target <= 5).

---

## Part I. Features to deliberately NOT build now (**NO**)

| Item | Why not |
|---|---|
| Own DSC/eSign engine | Needs licensed ASP/DSC verification; integrate Aadhaar-eSign/DSC providers later or accept stamped PDFs. |
| In-house e-invoicing, GSP integration for TradeCloseout's own invoicing | Use an off-the-shelf billing/invoicing service. Threshold applicability must be confirmed by a CA (I could not verify) and has no customer benefit. |
| Multi-layer "customisation engine" (`07`) | No evidence of need; templates + per-project overrides cover it. |
| Full construction ERP: payroll, accounting, inventory | Competes with existing tools; low differentiation. |
| BIM/clash detection | Aconex/Autodesk territory; irrelevant to a subcontractor's closeout. |
| Marketplace / contractor matching | Different business. |
| Legal-hold and deletion-request subsystems before a customer asks | Compliance theatre at pilot scale. |
| AI "project health score" | No data; invites distrust. |

---

## Part J. Features to simplify or consolidate

- **Statuses:** 14 requirement states -> 7 user-facing (Not started, Awaiting supplier, In review, Needs revision, Approved, Waived/NA, Expired) with the rest as internal sub-states.
- **Waivers:** keep, but as "Approved with exception" on the requirement, with named approver, reason, and expiry. Today's waiver + countersign + override tables are three concepts.
- **Parties vs organisations vs memberships vs guests vs project members:** five identity concepts for what users see as "my team", "supplier", "consultant". Unify the user-facing model; keep the structure internal.

---

## Part K. Validation required before building (**VALIDATE**)

1. Is the *subcontractor* or the *main contractor* the buyer? (Main contractors pay for sub-contractor closeout compliance on large jobs. Both could pay.)
2. How often do consultants insist on their own portal/format, making the "contractor-owned record" duplicate work?
3. Are RA bill support packs a pain or a distraction?
4. Do clients accept hosted QR/FM pages, or do they insist on their CAFM?
5. Which language(s) do site engineers and supplier staff prefer?
6. Real price sensitivity per project vs per month.

See `SOL_PRIORITISED_PRODUCT_ROADMAP.md` for the interview/pilot plan.
