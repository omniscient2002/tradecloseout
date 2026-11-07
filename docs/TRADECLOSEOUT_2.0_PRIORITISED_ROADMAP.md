# TradeCloseout 2.0 — Prioritised Product and Implementation Roadmap

**Status:** Discovery/design only; no application source changes  
**Date:** 4 November 2026  
**Sequencing rule:** Evidence integrity and customer value before feature count

## 1. Current versus desired capability

| Area | Current evidence | Desired outcome | Gap classification |
|---|---|---|---|
| Domain | Strong requirement/equipment/document/review/handover concepts, but divergent states and schema | One canonical model and reliable migration path | Foundation repair |
| Evidence trust | Direct READY, AV fail-open, generated missing PDF fallback | Original-preserving verified files and explicit failures | P0 blocker |
| Review | Multiple service paths; UI does not use the hardened command consistently | One authorised, version-exact, concurrency-safe decision path | P0 blocker |
| Tenancy and access | RLS foundations; incomplete project/grant scope | Org + project + requirement + grant isolation tested negatively | P0 blocker |
| Supplier | Two grant implementations and incomplete upload contract | Low-friction scoped uploads and contractor screening | P0/P1 core |
| Outbox/workers | Minimal payload, weak poll ownership and incomplete package job | Deterministic idempotent processing with real artefacts | P0 blocker |
| Checklist | Browser keyword mapping, snapshot concept | Persisted human-confirmed versioned configuration | P1 core |
| Work visibility | Role dashboards with static values and limited actor context | Universal action inbox with actor, blocker, age and due date | P1 core |
| Review UX | PDF preview/comments/decision concept | Complete version comparison, response tracking and external review | P1/P2 |
| Equipment | Assets, warranty and defect tables | Procurement-to-DLP equipment passport | P1/P2 |
| Inspection/Cx | Primarily document-oriented | Structured tests, readings, attempts and calibration | P2 differentiator |
| Handover | Package snapshots and recipient concepts | Real dossier, submissions, acceptance and exception actions | P1 core |
| Commercial | Contract-value retention estimate | Actual RA, deductions, retention releases and receipts | P2 differentiator |
| Mobile | Offline upload intentions with response mismatches | Honest offline capture and server reconciliation | P1 core |
| AI | Keyword mapping and aspirational claims | Measured human-confirmed assistance | P2/P3 experiment |
| Operations | Migrations/tests/infra, but contradictory claims and gaps | Clean deployment, observability, restore and support evidence | P0/P1 gate |

## 2. Value and delivery scoring

Scores are **relative planning judgements, not customer research results**:

- Pain, frequency, financial impact, differentiation and adoption: 1 (low) to 5 (high).
- Effort, technical risk and dependency burden: 1 (low) to 5 (high).
- P0 security/trust gates are mandatory even where users do not explicitly request them.

| Improvement | Pain | Freq. | Fin. impact | Diff. | Adopt. | Effort | Risk | Depends | Priority rationale |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Verified original file pipeline and real storage | 5 | 5 | 5 | 3 | 5 | 4 | 5 | 3 | P0: prevents false evidence and malware exposure |
| Remove synthetic PDF/review READY bypass | 5 | 5 | 5 | 3 | 5 | 2 | 2 | 1 | P0: immediate containment |
| One review command + scope enforcement | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 3 | P0: contractual correctness and same-org isolation |
| Real auth, guest sessions, idempotency | 5 | 5 | 4 | 4 | 5 | 4 | 5 | 3 | P0/P1: supplier and external workflows cannot work without it |
| Schema/OpenAPI/migration reconciliation | 4 | 5 | 4 | 2 | 4 | 4 | 5 | 2 | P0: live queries and deployment depend on it |
| Reliable outbox and real handover artefacts | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 4 | P0/P1: no real dossier without it |
| Persisted checklist import/change workflow | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 4 | P1: activation and reusable onboarding |
| Work Inbox and truthful role dashboards | 4 | 5 | 4 | 4 | 5 | 3 | 2 | 4 | P1: everyday adoption and actor accountability |
| Supplier screening and offline state machine | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 5 | P1: external collection and field reliability |
| Version-exact requirement satisfaction | 5 | 5 | 5 | 5 | 4 | 4 | 5 | 4 | P1: fundamental evidence differentiator |
| Handover acceptance and exception work | 5 | 4 | 5 | 5 | 4 | 4 | 4 | 5 | P1: closes the commercial/technical loop |
| Equipment passport and activity timeline | 4 | 4 | 4 | 5 | 4 | 3 | 3 | 5 | P1/P2: high reuse and DLP value |
| Review comparison/comment resolution | 3 | 4 | 3 | 3 | 4 | 4 | 3 | 4 | P2: valuable after review is correct |
| Structured inspections/calibration | 4 | 4 | 4 | 4 | 4 | 5 | 4 | 5 | P2: deep Cx value; significant domain/form complexity |
| RA/retention/commercial ledger | 5 | 4 | 5 | 5 | 4 | 5 | 4 | 5 | P2: strong differentiation but needs real contracts/CA workflows |
| Human-confirmed AI mapping/extraction | 3 | 4 | 3 | 3 | 3 | 4 | 4 | 5 | P2/P3: only after deterministic baseline and labelled samples |
| Native apps, BIM, broad integrations, other trades | 2 | 2 | 2 | 2 | 2 | 5 | 4 | 5 | P3: demand must justify large cost |

## 3. Dependency graph

```text
Customer discovery + artefact collection (parallel, no live data yet)
                         │
P0-A Unsafe-behaviour containment
                         │
P0-B Schema + OpenAPI + runtime validation + permission model
                         │
P0-C Real storage / verification / auth / idempotency / outbox
                         │
P1-A Version-exact evidence + one review command + supplier screening
                         │
P1-B Checklist configuration + Work Inbox + truthful role UX
                         │
P1-C Handover artefacts + recipient acceptance + exception work
                         │
             ┌───────────┴────────────┐
             │                        │
       Live pilot gate          P2-A Equipment passport
             │                   + timeline + review comparison
             │                        │
             │                   P2-B Structured inspections
             │                        │
             │                   P2-C Commercial ledger
             │                        │
             └──────────► Measured AI experiments / integrations / trade packs
```

Equipment passport should begin as a read projection as soon as version-exact evidence exists; it need not wait for the commercial ledger. Commercial readiness must not be used to claim real receivables until actual RA/deduction data is modelled.

## 4. Implementation phases

### Phase 0 — Research and containment (P0)

**Goal:** Remove behaviour that can falsely represent evidence, and validate the product thesis before further expansion.

**Work:**

1. Disable synthetic certified-PDF generation and fake upload/approval/signature controls.
2. Prevent direct API `READY` and review-driven file-state changes; make AV outages fail closed.
3. Require explicit production configuration for storage, Redis and OTP providers; no no-op production integrations.
4. Remove production persona switching and hardcoded tenant/demo data.
5. Catalogue schema inconsistencies and actual data that may already violate future invariants.
6. Conduct customer interviews and checklist/equipment/handover/RA artefact analysis without putting live data into an unsafe deployment.

**Exit evidence:**

- No known route can create a verified-looking artefact without source bytes and server verification.
- Static review of all write routes confirms no alternate bypass remains.
- A written ICP and five+ real checklist/equipment artefact teardowns support or revise the thesis.

**Cost/risk:** Small containment effort, high urgency. Taking existing unsafe records into a reconciliation state may require careful customer communication; do not delete them.

### Phase 1 — Trustworthy platform foundation (P0)

**Goal:** Make schema, access, storage and asynchronous processing deterministic.

**Work:**

1. Reviewed migration baseline + forward ledger + Drizzle/status/permission reconciliation.
2. OpenAPI contract, runtime DTO validation and generated API client.
3. Project-role and grant-scope resolver plus negative integration tests.
4. Real S3 upload/download adapter and original/rendition/verification records.
5. Real OTP provider adapters and grant-bound sessions.
6. Atomic idempotency, versioned outbox payload, leases and idempotent BullMQ consumers.
7. Clean-migration, upgrade, security and concurrency CI.

**Exit evidence:**

- Clean and upgraded databases run the same schema.
- ClamAV down = no READY; missing original = explicit failure.
- Cross-tenant, same-org cross-project and out-of-scope guest actions fail closed.
- Duplicate idempotency requests and duplicate outbox delivery create one effective outcome.

**Cost/risk:** Large foundational effort and migration risk. Avoid simultaneously introducing inspections, AI or broad UX rewrites.

### Phase 2 — Essential closeout workflow (P1)

**Goal:** Deliver a small complete workflow suitable for a controlled live pilot.

**Work:**

1. Persisted checklist/config hierarchy with preview, mapping confirmation and controlled changes.
2. `requirement_evidence` and `requirement_satisfactions`, with auditable migration/backfill.
3. One review decision command for in-app/external/stamp-back/bulk routes.
4. Supplier link exchange, scoped upload, screening and honest offline status.
5. Work Inbox and real database-driven role views.
6. Real handover compilation, manifest, submissions, recipients and exception actions.
7. Project closure and warranty-basis correctness.
8. Fix web typecheck/build and execute browser mobile/desktop E2E flows.

**Exit evidence:**

- One live sample project can run checklist → equipment → staff/supplier evidence → review → dossier → recipient decision → exception queue.
- No shadow spreadsheet is needed for requirement status in this core path.
- All success states match persisted data and negative tests pass.

**Cost/risk:** High business complexity. Limit custom workflow configuration to what the pilot requires.

### Phase 3 — Controlled paid pilot and product fit gate (P1)

**Goal:** Prove user value and support economics on real projects.

**Work:**

1. Onboard a small number of live projects with written success criteria and data-processing terms.
2. Time checklist/equipment mapping and record corrections.
3. Measure role adoption, supplier conversion, review ageing and handover preparation.
4. Test desktop/mobile accessibility and interrupted-network uploads.
5. Obtain consultant/client feedback on dossier and external approval records.
6. Capture storage/provider/support cost and support hours.

**Go/no-go evidence:**

- Core workflows are used with actual evidence and real review/acceptance.
- Users return for repeated actions, not only one export.
- Onboarding/support load is compatible with proposed pricing or a viable assisted-service model.
- No unresolved P0 defects or unexplained evidence inconsistencies remain.

**Pivot/stop signals:**

- Users prefer only a one-off PDF merge, with no ongoing workflow value.
- Setup exceeds sustainable effort despite template improvements.
- Suppliers or consultants reject the external workflow even after measured friction reduction.
- The product increases duplicate administration or cannot prove reliable evidence.

These are decision criteria, not fabricated thresholds. Numeric go/no-go targets should be agreed before each pilot with the founder and customer.

### Phase 4 — Differentiation and retention (P2)

**Goal:** Make the product valuable beyond one handover.

**Work:**

1. Equipment passport and project timeline from authoritative events.
2. Review comparison and complete comment assignment/resolution.
3. Structured inspections, attempts, readings, instruments and calibration.
4. Contract milestone and actual RA/retention/receipt ledger.
5. DLP/warranty/defect management and portfolio reporting.
6. Reusable client templates and next-project activation.

**Exit evidence:**

- New team member can retrieve exact equipment and acceptance history.
- Calibration expired on test date blocks compliant submission.
- Actual retention events reconcile in paise and estimates are labelled.
- Customers activate a subsequent project and reuse configuration.

**Cost/risk:** High domain and migration complexity. Build against pilot-proven examples, not a generic commissioning/ERP wishlist.

### Phase 5 — Optional expansion (P3)

Only after measured demand:

- Human-confirmed AI checklist/PDF metadata and revision assistance.
- Permission-filtered natural-language project search with citations.
- WhatsApp Business API notifications, if deep-link usage and economics justify it.
- Aconex/Autodesk/Procore/ERP connectors requested by paying customers.
- Other MEP trade packs.
- Real third-party e-signature integration if required; no self-declared cryptographic sealing.
- Native mobile apps if PWA/offline evidence shows a material unmet need.

## 5. What should NOT be built now

1. **Generic construction ERP:** payroll, inventory, procurement accounting, resource planning, full project scheduling.
2. **A universal workflow designer:** arbitrary multi-stage approvals before real consultant patterns are known.
3. **A broad “AI copilot” chat page:** structured work queues and linked evidence are more valuable and safer.
4. **Automatic approvals/waivers/acceptance or AI-calculated commercial ledgers.**
5. **Native iOS/Android apps** before PWA evidence.
6. **BIM/CAD authoring, model coordination or a complete Bluebeam replacement.**
7. **Microservices, Kubernetes, Kafka or a separate search/analytics platform** without scale evidence.
8. **Self-built cryptographic DSC claims.** Either integrate and verify a real provider or omit the claim.
9. **Other MEP trade packs** before HVAC workflow and template portability are proven.
10. **Long-term archive guarantees** without storage/restore/support cost evidence and contractual retention terms.
11. **Per-supplier pricing or account requirements** that directly undermine collection.
12. **More dashboard cards** to disguise missing workflow correctness.

## 6. Cost and complexity considerations

| Capability | Relative engineering cost | Operational cost | Main risk / simplification |
|---|---|---|---|
| File verification and storage | High | AV/storage/workers/monitoring | Keep original + one necessary preview; no arbitrary conversions |
| Review and requirement evidence | High | DB/audit | One command and one satisfaction rule; defer arbitrary multi-stage workflows |
| Supplier/PWA | Medium–high | OTP, uploads, support | Deep links first; no supplier accounts; preserve original |
| Checklist | Medium–high | Mapping support | Deterministic mapping + paid bounded onboarding; AI later |
| Work Inbox/read projections | Medium | DB queries | Shared projection rather than separate hardcoded dashboards |
| Handover compiler | High | Storage/CPU/worker diagnostics | qpdf subprocess, pinned inputs, real artefacts; profile bookmarks |
| Equipment passport | Medium | Read projections | Compose existing records; no duplicated lifecycle JSON |
| Inspection/Cx | High | Offline forms, templates, storage | Start with 2–3 pilot-proven test forms, not all HVAC tests |
| Commercial | High | Reconciliation/support | Model only milestone/RA/retention events, not accounting suite |
| AI | Medium–high | OCR/model/evaluation/privacy | Deterministic first, labelled samples, human confirmation and citations |
| Integrations | High per connector | Credentials/versioning/support | Reliable exports first; build only repeated paid demand |

## 7. Consolidated implementation plan

### Workstream A — Product and customer evidence

- Maintain artefact register, anonymised examples, interview notes and disconfirming evidence.
- Review product decisions weekly against actual pilot usage.
- Do not convert sample Deccan stories into customer claims.

### Workstream B — Platform trust

- Resolve P0 defects in the order: synthetic evidence → direct READY/review bypass → scope/auth → schema/storage/outbox.
- Require regression tests before each merge and a final independent security review.
- Reconcile existing data without deleting or silently changing its history.

### Workstream C — Core product

- Implement version-exact evidence before more dashboards.
- Build checklist, Work Inbox, supplier, review and handover as one coherent vertical slice.
- Remove duplicated services rather than adding more compatibility paths.

### Workstream D — UX and adoption

- Prototype Work Inbox, requirement detail, supplier upload and handover builder against real customer artefacts.
- Replace static dashboards with shared authorised projections.
- Run role-based usability and accessibility checks before visual sign-off.

### Workstream E — Operations and business

- Define staging/production configuration validation, queue monitoring, backup/restore and incident runbooks.
- Track onboarding/support/storage/provider cost from the first pilot.
- Obtain CA/counsel review for commercial and privacy claims before billing or legal assurances.

## 8. Release acceptance matrix

| Release | Mandatory evidence | Explicitly not enough |
|---|---|---|
| Foundation candidate | Clean migration, schema/API contract tests, negative tenant/project/grant tests, AV/storage/outbox failure tests | Typecheck alone or 97 existing tests passing |
| Core pilot candidate | End-to-end sample project with real files, supplier, review, dossier, recipient decision and retries | UI demo with seeded project cards |
| Paid live pilot | Signed scope/DPA, measured onboarding, monitored jobs, backup/restore, support runbook | Claims of production readiness from code review |
| Differentiation release | Equipment/Cx/commercial workflows verified on actual project examples | More features without adoption and reconciliation |
| AI/integrations | Accuracy, privacy, cost and human-override evaluation | Model-generated summary or vendor logo alone |

## 9. Final priority judgement

The highest-value roadmap is intentionally narrow:

> **Make evidence trustworthy → prove who must act → collect from anyone safely → review the exact revision → generate a real handover → record acceptance → connect it to DLP and actual commercial events.**

TradeCloseout should not scale beyond this sequence until a live contractor demonstrates that the product reduces administrative effort and produces a more dependable closeout than its existing Excel/WhatsApp process.
