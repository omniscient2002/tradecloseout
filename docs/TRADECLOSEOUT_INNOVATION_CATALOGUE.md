# TradeCloseout — Innovation Catalogue

**Status:** Second-pass discovery/design only; no application source changes  
**Date:** 4 November 2026  
**Scoring:** Relative engineering/product judgement, not measured customer willingness to pay

## 1. Decision and score keys

- **Decision:** BUILD NOW (next suitable core increment), BUILD LATER (after core pilot), VALIDATE WITH CUSTOMERS (artefact/problem test first), INTEGRATE WITH EXISTING SOFTWARE, DO NOT BUILD.
- **Value columns:** customer pain, frequency, financial/operational impact, affected users, differentiation, willingness-to-pay evidence (WTP).
- **Cost columns:** implementation effort, maintenance cost, technical risk, dependency burden.
- **Scale:** H = high, M = medium, L = low. WTP refers to evidence confidence, not price level.
- **Novelty:** New = absent from prior 2.0 design; Extended = named before but missing critical operational semantics.

“Build now” remains subordinate to the P0 evidence/security foundation. It is not permission to expand before trustworthy uploads/reviews work.

## 2. Ranked opportunity catalogue

| Rank / ID | Capability and novelty | Decision | Pain | Freq. | Impact | Affected users | Diff. | WTP | Effort | Maint. | Risk | Dependencies |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 / O01 | **Obligation graph with RFI/SI/source lineage — New** | VALIDATE, then BUILD NOW | H | H | H | PM/design/site/QC/commercial | H | M | M | M | M | Contract artefacts + existing requirement/evidence model |
| 2 / O02 | **BOQ → equipment → quantity → JMR → RA graph — New** | VALIDATE, then BUILD LATER | H | M | H | QS/commercial/site/owner | H | M | H | H | H | BOQ and real RA examples + O01/O20 |
| 3 / O03 | **PO/vendor-document obligations and make/FAT/dispatch gates — Extended** | BUILD NOW in narrow form | H | H | H | Procurement/PM/supplier | M | M | M | M | M | Supplier grants + equipment + approval states |
| 4 / O04 | **Forwarded transmittal hops and response meaning — New** | BUILD LATER after direct submissions | H | H | H | Doc controller/PM/MC/consultant/client | H | M | M | M | M | Real submissions + external decisions + bitemporal events |
| 5 / O05 | **RFI/instruction → variation → executed-at-risk → RA evidence — New** | VALIDATE, then BUILD LATER | H | M | H | PM/commercial/owner | H | M | H | M | H | O01 + authority + commercial ledger |
| 6 / O06 | **Inspection appointment, hold-point notice and release — Extended** | VALIDATE, then BUILD LATER | H | H | H | Site/QC/consultant | M | M | M | M | M | ITP + offline inspections + authority |
| 7 / O07 | **Metrological suitability and shared-instrument scheduling — Extended** | BUILD LATER with Cx | H | M | H | QC/commissioning | H | M | M | M | M | Structured ITP ranges + instrument register + appointments |
| 8 / O08 | **Equipment identity revisions and evidence revalidation — New** | BUILD NOW | H | M | H | QC/procurement/service/audit | H | M | M | M | H | Existing assets + all linked evidence |
| 9 / O09 | **Occurred-at vs recorded-at event model — New** | BUILD NOW | H | H | H | All operational/claims users | H | M | M | L | M | API DTOs + audit/read models |
| 10 / O10 | **Contractual authority and time-bound delegation snapshots — Extended** | VALIDATE, then BUILD NOW for approvals | H | M | H | Reviewers/owner/client/claims | H | M | M | M | H | Party contacts + authority evidence + decision service |
| 11 / O11 | **Physical custody handover — New** | BUILD LATER with handover acceptance | H | M | H | PM/client facilities/commissioning | H | M | M | L | M | Package acceptance + recipients + actual dates |
| 12 / O12 | **Layered warranty and service-resolution evidence — Extended** | BUILD LATER after core DLP | H | M | H | Service/procurement/client | H | M | H | M | M | Asset identity + warranty coverage + defect events |
| 13 / O13 | **Portable, self-verifying project archive and exit receipt — Extended** | BUILD NOW in basic export, richer later | H | M | H | Owner/admin/client/future staff | H | M | M | M | M | Original hashes + manifests + schema versions + retention |
| 14 / O14 | **Obligation-driven retention and granular legal holds — New** | BUILD LATER before any purge automation | H | M | H | Admin/legal/service | H | M | H | H | H | Archive + warranty/claim state + retention policy |
| 15 / O15 | **Deterministic equipment/document candidate matching — Extended** | BUILD NOW as suggestion only | M | H | M | Doc controller/procurement/site | L | M | M | M | M | Equipment aliases + OCR/filename + human confirmation |
| 16 / O16 | **Parent/child evidence and missing-attachment dependency checks — New** | BUILD NOW for known rules | H | H | H | QC/reviewer/doc controller | M | M | M | M | M | Obligation dependency graph + evidence links |
| 17 / O17 | **Coded rejection/root-cause and recurrence intelligence — New** | BUILD LATER after reliable decision data | M | H | M | QC/PM/procurement/owner | M | L | L | L | M | Coded decisions + supplier/equipment/doc-type dimensions |
| 18 / O18 | **Required-on-site backward dependency planning — New** | VALIDATE, then BUILD LATER | H | H | H | PM/procurement/site | M | M | M | M | M | PO obligations + approval/delivery milestones |
| 19 / O19 | **Factual supplier cycle-time and reliability intelligence — New** | BUILD LATER | M | M | M | Procurement/PM | M | L | L | L | M | O09 actor intervals + supplier obligations; no opaque score |
| 20 / O20 | **Shipment/delivery/MIR serial and quantity reconciliation — New** | VALIDATE, then BUILD LATER | H | H | H | Site/QC/procurement | H | M | H | M | H | PO lines + equipment identity + delivery/MIR events |
| 21 / O21 | **Full responsibility-transfer manifest and acknowledgement — Extended** | BUILD NOW | H | M | H | Admin/PM/team successor | M | M | M | M | M | Work item types + project scope + authority |
| 22 / O22 | **Template/policy blast-radius preview and opt-in migration — New** | BUILD LATER before broad template reuse | H | M | H | Admin/PM/PMO | M | M | M | M | H | Immutable snapshots + requirement links + policy versions |
| 23 / O23 | **Email/meeting-to-decision capture with human confirmation — New** | INTEGRATE, then BUILD LATER | H | H | H | PM/doc controller/consultant | M | M | H | H | H | Mail provider + source/authority + RFI graph + security |
| 24 / O24 | **CDE interchange/export mapping and returned-decision capture — New** | INTEGRATE WITH EXISTING SOFTWARE | H | M | H | PM/doc controller/MC consultant | H | M | H | H | H | Real customer CDE requirements + transmittal hops |
| 25 / O25 | **Archive/storage lifecycle economics — New** | BUILD NOW for temporary data, policy later | M | M | H | Owner/finance/operations | L | M | L | L | M | Object classification + outbox cleanup + retention obligations |
| 26 / O26 | **Approved method/ITP work-release pack — New** | BUILD LATER with O06 | H | H | H | Site/QC/safety | M | L | M | M | M | Current MS/ITP + appointments + permits |

## 3. Why the top choices are different from generic feature expansion

### O01 — Obligation graph before more AI

The critical advantage is knowing why an obligation exists and which downstream work changes after a decision. A chatbot cannot reliably create this lineage without exact sources and human approval. Implement sources/dependencies first, then use AI to suggest links.

### O02/O20 — Quantities are not metadata on a PDF

Item-rate and partial-delivery workflows need separate physical events and units. Start only with customers who have this problem; ordinary serialized-equipment projects need not carry BOQ complexity.

### O04/O09/O10 — Authority and time are part of the evidence

The central question is not only “was this file approved?” but “who had authority, at what actual time, under which transmitted version, and when did we record it?” This creates defensibility without a blockchain narrative.

### O13/O25 — Archive portability reduces both sales friction and cost

A customer-ownable archive is a trust feature and a commercial alternative to indefinite full-application hosting. Temporary derivatives and abandoned uploads should not carry the same retention class as originals.

## 4. Smart automation catalogue

Every automation below must cite source data and preserve human confirmation where a business relationship or contractual fact is created. “Expected saving” is a hypothesis to measure, not a promised result.

| Automation | Input | Processing | Output | Accuracy limitation / verification | Cost | Complexity | Expected saving to measure |
|---|---|---|---|---|---|---|---|
| Exact duplicate evidence | Stored bytes/hash, project | SHA-256 exact match + existing object lookup | Duplicate candidate and reuse/new-version choice | Same bytes may serve different obligations; user decides relationship | Very low | Low | Avoided duplicate uploads/storage and searching; measure per 100 uploads |
| Tag/serial candidate matching | Project equipment aliases, filenames, PDF text/OCR, supplier | Deterministic alias/serial dictionary and context score; OCR only when needed | Ranked equipment candidate(s), never auto-link | OCR/layout errors and duplicate serials; confirm with model/location/source | Low–medium | Medium | Less manual equipment linking; measure correct-first-suggestion rate and correction time |
| Equipment identity mismatch | Approved make/model/serial, PO, MIR/FAT/warranty metadata | Field/unit comparison and effective-date rules | Mismatch/unknown/match result with source fields | Missing/OCR data is unknown, not mismatch; human resolves | Low | Medium | Earlier detection of wrong unit/warranty; measure prevented re-review |
| Missing attachments | Obligation dependency, doc type, parent/child evidence links | Deterministic required-companion rule (e.g. test + gauge calibration + witness) | Missing companion list with exact requirement | Only configured dependency families supported; reviewer decides completeness | Low | Medium | Less review rejection and manual checking; measure first-pass acceptance |
| Evidence validity | Issue/expiry/inspection dates and policy version | Calendar/timezone rules; no LLM | Expired/expiring/valid-on-event-date flags | Date-only timezone and warranty basis nuances; show policy/source | Very low | Low | Earlier renewals; measure avoided expired approvals |
| Technical reading extraction | Scanned test sheets, units/ranges, instrument info | OCR + constrained field parser, optional model for layout | Draft numeric readings/units/dates with page citations | Decimal/unit/range/table errors common; user confirms every result against page | Medium–high | High | Less retyping; measure field-level precision and correction time before any automation |
| Revision comparison | Two exact PDFs and extracted text/page images | Page alignment, text diff, image/overlay diff, metadata diff | Added/removed/changed pages and candidate technical changes | Scans/layout/reordered pages can create false changes; reviewer decides significance | Medium | Medium–high | Faster revision review; measure missed-change/false-change rate |
| Inspection PDF → structured attempt | Test form PDF + template definition | OCR/table extraction + template-specific mapping | Draft attempt/items/readings/instruments | Never infer pass/fail without exact rule and values; entire draft reviewed | High | High | Data reuse without re-entry; measure accepted-field percentage and time |
| Rejection recurrence | Coded review comments/reasons, supplier, doc type, project, equipment | SQL groupings/trends, optional text clustering later | Recurring reason/register and coaching follow-up | Small samples and inconsistent comment coding mislead; show counts and source | Low | Low–medium | Fewer repeat errors; measure recurrence and correction effort |
| Supplier follow-up list | Outstanding PO/document obligations, promised/actual dates, actor intervals | Deterministic filters and templates | Supplier-specific pending list and WhatsApp/email draft | Supplier performance cannot be inferred from overall elapsed time; PM edits/sends | Very low | Low | Less follow-up preparation; measure minutes and response time |
| Collection bottleneck risk | Required-on-site date, upstream state, promised dates, actor intervals | Rule-based late/critical-path calculation; ML only after sufficient history | At-risk obligation with cause and current actor | Promise estimates can be wrong; not a probabilistic prediction initially | Low | Medium | Earlier intervention; measure forecast lead time and avoided late discoveries |
| Meeting/action register | Confirmed minutes/email, participant/authority list | Optional LLM summary or deterministic action extraction + human editing | Draft decisions, actions, due dates and RFI/variation links | Hallucinated owners/dates/commitments; every decision confirmed by accountable person | Medium | Medium–high | Less minutes administration; measure correction rate and missed commitments |
| Draft transmittal/index | Exact versions, recipients, external references, package snapshot | Deterministic renderer | Draft transmittal and index with hashes/revisions | Does not mean sent/approved; document controller checks and dispatches | Low | Low | Faster package preparation; measure assembly time and errors |
| Archive verification | Original objects, manifest, schema/relationship requirements | Hash recompute + relationship/readability checks | Verifiable archive receipt and missing-object report | Hash proves bytes, not engineering truth; policy completeness still reviewed | Low | Medium | Lower long-term retrieval/support burden; measure restore success and time |

### Automation sequence

1. **Now:** exact hashes, aliases/candidate suggestions, dependency checks, validity, follow-up lists, deterministic transmittal/index and archive verification.
2. **After real evidence accumulates:** identity mismatch, revision compare, recurrence, bottleneck lead-time rules, supplier cycle-time analysis.
3. **After labelled datasets and privacy/cost approval:** OCR table/readings, inspection conversion, meeting summaries and AI-assisted search. No autonomous approval or commercial ledger entry.

## 5. UX innovations not covered adequately before

| Innovation | User problem | Practical interaction | Decision |
|---|---|---|---|
| Obligation ↔ procurement ↔ quantity views | PM currently switches mental models across modules | Same project/obligation context with view switch, not three duplicated screens | VALIDATE |
| Current-holder timeline | “In review” does not say where external package is stuck | Horizontal hops with current holder, sent/acknowledged times and returned wording | BUILD LATER |
| Evidence relationship tray | User cannot see missing companion files without reopening every PDF | Side panel lists required companions, linked evidence and unresolved dependency | BUILD NOW for known rules |
| Keyboard review flow | Repetitive review requires excessive mouse travel | J/K next/previous, C comment, R resolve, [ ] page; never single-key approve | BUILD LATER |
| Import merge conflict workbench | Spreadsheet aliases create duplicates or silent merges | Side-by-side existing/imported identity with explicit create/map/merge/undo-before-apply | BUILD NOW |
| Pre-capture prerequisite card | Site learns witness/instrument/method issues after test | Top-of-form compact status and direct fix links before first reading | BUILD LATER |
| Client wording preserved | Internal APPROVED label hides actual response | External original wording first, canonical meaning second, with original response one click away | BUILD LATER |
| Supplier request autofill with memory | Procurement repeatedly maps similar OEM document sets | Reuse supplier/PO-document profile after preview; never silently apply to new revision | BUILD LATER |
| Handover responsibility transfer | Offboarding is technically complete but successor lacks context | Checklist of open commitments with notes, parties, due dates and acknowledgement | BUILD NOW |
| Notification policy by obligation | Every event creates email/WhatsApp noise | Digest changed obligations; urgent only security, hold point, revocation and required overdue decision | BUILD LATER |
| Archive verification UX | Downloaded ZIP cannot be trusted/restored | Verify button/report showing objects checked, missing dependencies and archive hash | BUILD NOW in basic form |
| Mobile device/account privacy | Shared Android exposes prior drafts | Account-bound outbox, explicit device sign-out cleanup and safe storage quota screen | BUILD NOW |

## 6. Domain and architecture innovations worth preserving

- **Bitemporal event envelope** for every externally meaningful event.
- **Authority snapshot at decision**, not live role lookup for historical explanation.
- **Actor-work-period projection** to separate actual waiting reason from elapsed time.
- **Canonical identity + aliases + identity revisions** instead of edited tags and serials.
- **Obligation source/dependency links** to propagate RFI/variation impact without a general rules engine.
- **Evidence parent/child and coverage relationships** for completeness beyond one file.
- **Typed transmittal hops** for external workflow and holder.
- **Physical quantity facts** separate from evidence review where needed.
- **Archive schema versions and verification receipts** for longevity and exit.
- **Policy version snapshots** for readiness, retention and commercial calculations.

## 7. Opportunities deliberately rejected

| Idea | Decision | Why |
|---|---|---|
| Full contract-language “AI legal reviewer” | DO NOT BUILD | Liability and hallucination risk; build source extraction + human obligation mapping instead |
| Probabilistic supplier score | DO NOT BUILD | Small/biased samples and upstream waiting periods make it unfair; use factual cycle breakdown |
| Full Primavera/CPM scheduler | DO NOT BUILD | Use only upstream/downstream closeout dependencies |
| Full procurement/inventory/payables | DO NOT BUILD | Keep PO obligations and physical evidence, integrate ERP for accounting |
| Generic correspondence/chat platform | DO NOT BUILD | Capture decisions/RFIs/instructions, not all conversations |
| Full CMMS/preventive maintenance | DO NOT BUILD | Keep warranty/service-resolution evidence and DLP only |
| Autonomous “closeout risk prediction” | DO NOT BUILD initially | Insufficient labelled data; deterministic dependency/age rules are explainable |
| Cross-tenant document deduplication by hash | DO NOT BUILD by default | Confidentiality/existence leakage and retention/ownership complexity |
| Blockchain evidence ledger | DO NOT BUILD | Existing hash chain + originals + authority and portable verification are sufficient |
| Universal workflow/status builder | DO NOT BUILD now | Preserve canonical states and map external wording per client |
| Data lake/event-sourced everything | DO NOT BUILD | Relational current state + append-only events + targeted projections are simpler |
| General RFI/submittal suite before core trust | DO NOT BUILD first | Secure evidence and real review/handover must work first |

## 8. Recommended innovation sequence

1. **Immediate domain leverage:** dual timestamps, identity revisions, attachment dependencies, deterministic matching, basic portable export, responsibility transfer and temporary-storage cleanup.
2. **Next core increment:** PO/vendor-document obligations, authority snapshots, obligation/RFI source graph and canonical external meanings.
3. **After customer evidence:** shipment/MIR, required-on-site dependencies, transmittal hops, inspection notices, metrological suitability and custody handover.
4. **After core commercial fit:** BOQ/JMR/RA, variation claims, layered service, full retention/legal holds and supplier intelligence.
5. **After measured demand:** CDE connectors, OCR/LLM extraction, cross-project predictive analysis and trade packs.
