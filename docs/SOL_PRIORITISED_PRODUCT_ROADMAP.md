# SOL — Prioritised Product Roadmap

Analysis only. Ranking is my judgement against: customer pain, frequency, financial impact, time saved, competitive advantage, adoption likelihood, complexity, maintenance cost, technical risk. Scores are **ordinal opinions (H)**, not measurements. Difficulty: S (days) / M (2-4 wk) / L (1-3 mo) / XL (>3 mo), for a small team of 2-3 engineers.

Classification: **MUST** / **DIFF** (high-value differentiator) / **FUTURE** / **VALIDATE** (customer validation required) / **NO** (do not build).

---

## 1. Ranked register

Pain/Freq/₹/Time/Edge/Adopt: 1 (low) - 5 (high). Cx/Maint/Risk: 1 (low) - 5 (high; bad).

| # | Item | Class | Pain | Freq | ₹ | Time | Edge | Adopt | Cx | Maint | Risk | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A1 Remove simulated success (upload, OTP, notifications, preview path, EICAR flag, bulk import stub) | MUST | 5 | 5 | 4 | 2 | 1 | 5 | 1 | 1 | 1 | Credibility prerequisite; trivial vs. damage |
| 2 | A3/A4 Single schema source; collapse duplicates; quarantine DSC/billing/customisation | MUST | 3 | 5 | 2 | 3 | 1 | 4 | 2 | 1 | 1 | Cuts maintenance before growth |
| 3 | A2 Real delivery: DLT SMS/e-mail OTP, WhatsApp reminders | MUST | 5 | 5 | 3 | 4 | 2 | 5 | 2 | 3 | 2 | Without it nobody can log in or be reminded |
| 4 | B4 Import-first onboarding (consultant Excel, equipment schedule, folder) | MUST | 5 | 4 | 3 | 5 | 3 | 5 | 3 | 2 | 2 | Gate: need >=5 real checklists |
| 5 | E1 Supplier request page (link, WhatsApp, phone upload, reminders) | MUST | 5 | 5 | 4 | 5 | 3 | 5 | 2 | 2 | 2 | Biggest daily friction in closeout |
| 6 | Work Inbox + project "Today" + honest status vocabulary | MUST | 4 | 5 | 3 | 5 | 2 | 5 | 2 | 1 | 1 | Daily-use habit |
| 7 | Mobile shell: cached app shell + assigned data + sync state | MUST | 5 | 5 | 3 | 4 | 2 | 5 | 3 | 3 | 3 | Site realities |
| 8 | F1 Handover builder: completeness gate, index templates, acceptance capture | MUST | 4 | 3 | 5 | 4 | 2 | 5 | 2 | 2 | 2 | Existing compiler as base |
| 9 | F3 Warranty/DLP clocks with contractor-side reminders | MUST | 4 | 3 | 4 | 3 | 2 | 4 | 1 | 1 | 1 | Cheap, tangible |
| 10 | B1 Equipment Passport as spine (matrix view) | DIFF | 5 | 5 | 4 | 5 | 4 | 4 | 3 | 3 | 2 | The core experience change |
| 11 | B2 Decision Register via e-mail forward / WhatsApp | DIFF | 5 | 5 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | Key moat; matching quality risk |
| 12 | B3 Waiting Ledger + Delay Evidence Pack | DIFF | 5 | 4 | 5 | 3 | 5 | 4 | 2 | 2 | 2 | Needs B2 or manual entry |
| 13 | D1 Money Gates (retention/BG/final bill with release conditions) | DIFF | 5 | 4 | 5 | 3 | 4 | 5 | 3 | 2 | 2 | Why MDs pay |
| 14 | C1 Inspection Requests with hold points | DIFF | 4 | 5 | 4 | 4 | 4 | 3 | 3 | 3 | 3 | Daily site use; needs consultant buy-in |
| 15 | C3 MAR/delivery/MIR chain (material approvals) | MUST (scope VALIDATE) | 4 | 5 | 4 | 4 | 3 | 4 | 3 | 3 | 2 | Moves capture upstream |
| 16 | B5 Approved-Make Guard | DIFF | 4 | 4 | 4 | 3 | 4 | 4 | 2 | 1 | 1 | Deterministic and cheap |
| 17 | C2 Test results as data + calibration-validity check | DIFF | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 3 | 3 | Template library needs QC input |
| 18 | C4 Snag + DLP service desk | MUST | 4 | 4 | 3 | 3 | 3 | 4 | 2 | 2 | 1 | Extends life of product |
| 19 | F2 Equipment QR for client FM | DIFF | 3 | 4 | 3 | 3 | 5 | 3 | 3 | 2 | 2 | Viral loop; client adoption unknown |
| 20 | D4 Portfolio analytics (consultant/supplier cycle times, rejection reasons) | DIFF | 3 | 4 | 3 | 3 | 4 | 4 | 2 | 1 | 1 | Needs ~10 projects of data |
| 21 | G1 Rules-based file-to-deliverable suggestion | DIFF | 4 | 4 | 2 | 4 | 3 | 4 | 2 | 1 | 1 | Deterministic first |
| 22 | D2 RA bill support pack | VALIDATE | ? | ? | 4 | 3 | 3 | ? | 3 | 3 | 3 | Shadow 3 billing cycles first |
| 23 | D3 Variation / instruction evidence trail | VALIDATE | ? | ? | 4 | 2 | 3 | ? | 3 | 3 | 3 | After B2 |
| 24 | G2/G3 OCR + cross-document serial check | VALIDATE / FUTURE | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | After C2 |
| 25 | G8 Contract clause extraction | VALIDATE | 3 | 1 | 3 | 2 | 2 | 2 | 3 | 3 | 4 | Manual 10-field form first |
| 26 | F4 Archive export | FUTURE | 2 | 1 | 2 | 1 | 3 | 3 | 1 | 1 | 1 | Cheap trust feature |
| 27 | E2 Supplier scorecards (facts only) | FUTURE | 3 | 3 | 3 | 2 | 3 | 3 | 1 | 1 | 1 | After enough data |
| 28 | Multi-language field screens | MUST for field adoption (languages VALIDATE) | 4 | 5 | 2 | 3 | 3 | 5 | 2 | 2 | 1 | Hindi + 1-2 regional |
| 29 | Own DSC/eSign engine | NO | - | - | - | - | - | - | 5 | 5 | 5 | Integrate a licensed provider if ever |
| 30 | SaaS invoicing, e-invoice integration, customisation engine, legal-hold subsystem | NO (now) | - | - | - | - | - | - | 4 | 4 | 3 | Buy/outsource; add only on demand |
| 31 | AI project-health score, AI rejection-reason drafts, BIM/ERP/marketplace | NO | - | - | - | - | - | - | 4 | 4 | 4 | |

---

## 2. Dependency graph

```text
A1 (honest core) ───────────────┬──────────────────────────────────────────┐
A3/A4 (schema, consolidation)   │                                          │
A2 (real channels) ─────────────┼──► E1 Supplier requests ──► B5 Make Guard │
                                │                                          │
B4 Import ──► B1 Equipment passport/matrix ──► C3 MAR/MIR ──► C1 IR ──► C2 Tests
                       │                              │                      │
                       ├──► F3 Warranty/DLP ──► C4 Snag/DLP desk ──► F2 QR    │
                       └──► F1 Handover builder ◄────────────────────────────┘
A2 + ingest ──► B2 Decision Register ──► B3 Waiting Ledger ──► D3 Variation trail
                                   └──► D1 Money Gates ──► D2 RA support pack
B3 + D1 + data ──► D4 Portfolio analytics ──► E2 Scorecards ──► G6 predictions (NO until data)
C2 ──► G2 OCR ──► G3 Cross-check
Customer validation gates:  [VG1] interviews  [VG2] real checklists  [VG3] pilot handover  [VG4] paid pilots
```

---

## 3. Implementation sequence (phases with exit gates)

### Phase 0: Truth and focus (3-5 weeks, in parallel with research)
- A1 remove simulated success; A3 one schema source; A4 quarantine DSC/billing/customisation.
- Replace hard-coded personas/KPIs with real invitations (demo data only in a separate demo tenant).
- Wire real OTP (SMS + e-mail), real storage-backed preview.
- **Research track (no code):** 10+ interviews (contractors, QC, doc controllers, consultants/PMCs); collect 5+ real consultant checklists, 10 subcontract retention/DLP clauses, 3 shadow RA-bill cycles; survey Autodesk/Indian vendors; CA/lawyer review of tax/DPDP claims.
- **Exit gate (VG1+VG2):** interview synthesis confirms the buyer, the first workflow, and a price hypothesis; checklists collected.

### Phase 1: The wedge (6-10 weeks)
- B4 import, E1 supplier requests with WhatsApp, A2 reminders, Work Inbox + Today, mobile shell with offline capture, minimal B1 (equipment list + matrix view), F1 handover with completeness gate, F3 warranty/DLP clocks.
- Run **one concierge pilot on a live project** (team onboards and imports with the customer).
- **Exit gate (VG3):** pilot completes a real handover; measured: setup time, supplier first-pass acceptance, hours of doc-control saved; customer says they'd pay.

### Phase 2: Differentiators (8-12 weeks)
- B2 Decision Register (e-mail forward first, WhatsApp next), B3 Waiting Ledger, D1 Money Gates (manual contract terms), B5 Make Guard, C3 MAR chain (scope per pilot feedback), C4 snag desk.
- **Exit gate (VG4):** 3 paid pilots at ≥ the hypothesised price (the repo's own target is ≥3 paid pilots at ≥₹5,000/month equivalent within 6 months: `02-BUSINESS-REQUIREMENTS.md`), measurable cash-release or time-saved story from at least one.

### Phase 3: Daily-use and expansion (3-6 months)
- C1 IR with hold points, C2 test records (start with 3 test types), F2 equipment QR, D4 portfolio analytics, G1 rules-based suggestions, multi-language rollout.
- Pricing/packaging by capability tier. Self-serve onboarding.

### Phase 4: Optional (only on evidence)
- D2 RA support pack, D3 variation trail, OCR/G2/G3, scorecards, archive export, other MEP trades, main-contractor/PMC compliance module (new buyer).

---

## 4. Measurement framework

| Level | Metric | Target hypothesis |
|---|---|---|
| Product integrity | Silent-failure incidents | 0 |
| Onboarding | Time from signup to a populated project | < 1 day, ideally < 2 hours with import |
| Supplier loop | Median days PO -> complete documents; first-pass acceptance | Improvement vs baseline recorded in pilot |
| Review | Median review turnaround; % consultant decisions captured < 24h | Baseline then improve |
| Money | Days from handover to retention/BG release; ₹ blocked by missing items | Pilot-measured |
| Handover | Time from last approval to delivered dossier | < 1 working day |
| Engagement | Weekly active users per account; Work Inbox daily opens | Habit formation |
| Business | Paid pilots, logo retention, cost to serve per active project, support tickets per project (repo target < 0.5) | Validate |
| Quality | % evidence with passport link; % tests with computed pass/fail | Rising |

All numeric targets are hypotheses to be replaced with pilot baselines.

---

## 5. Risks to the roadmap
1. **Buyer misidentification.** If the main contractor or PMC is the real buyer, Phase 2 priorities shift toward subcontractor compliance dashboards.
2. **Upstream refusal** to accept contractor-generated artefacts.
3. **Channel integration cost/lead time** (WhatsApp templates, DLT) delaying Phase 1.
4. **Matching quality** in B2 eroding trust: ship with always-confirm UI and visible originals.
5. **Team capacity:** the plan assumes 2-3 engineers and part-time domain lead; halve scope if smaller.
6. **Regulatory claims** unverified: engage a CA/lawyer before publishing compliance statements.
