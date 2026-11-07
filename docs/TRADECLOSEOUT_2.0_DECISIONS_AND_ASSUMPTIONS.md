# TradeCloseout 2.0 — Decisions and Assumptions

**Status:** Discovery/design only; no application source changes  
**Date:** 4 November 2026  
**Purpose:** Make product and architecture choices, rejected alternatives, evidence gaps and required customer validation explicit

## 1. How to use this register

- **Proposed:** Recommended design direction, not yet implemented and not necessarily customer-approved.
- **Required for live pilot:** Safety/integrity condition that must be satisfied before real customer data is used.
- **Validate:** Product/commercial assumption requiring customer evidence.
- **Deferred:** Deliberately excluded until a dependency or demand exists.
- **Rejected:** Not recommended under the current evidence and constraints.

This 2.0 register supplements `DECISIONS-AND-OPEN-QUESTIONS.md`. Where it changes an earlier assumption, the change should be reviewed and recorded in the authoritative decision log before implementation. It must not be silently treated as an approved migration of business rules.

## 2. Product and market decisions

| ID | Decision | Status | Rationale and affected existing assumption |
|---|---|---|---|
| D2-001 | Target HVAC subcontractors first, selected by project complexity and closeout need, not rigid turnover/headcount alone | Proposed | Preserves HVAC focus while avoiding arbitrary exclusion of smaller complex contractors |
| D2-002 | Keep the core MEP-ready but do not launch other trade packs yet | Proposed | Requirement/evidence/review/handover primitives are reusable; trade content needs separate proof |
| D2-003 | Position as contractor-owned closeout evidence, acceptance and commercial-readiness workspace | Proposed | Differentiates from generic PM, CDE and commissioning-only products; no claim to replace Aconex |
| D2-004 | Initial buyer hypothesis is owner/projects head; PM/document controller is champion and frequent operator | Validate | Purchase and daily use are different; discovery must test actual budget authority |
| D2-005 | Mid-project closeout rescue is a valid entry point; ongoing requirement/review/DLP usage supports renewal | Validate | Prevents “whole lifecycle from award” becoming a barrier while testing subscription retention |
| D2-006 | Smallest valuable product is checklist/equipment → evidence → review → dossier → acceptance → DLP/export | Proposed | Do not begin with full commissioning, ERP, AI or integrations |
| D2-007 | Use per-company/project-aligned packaging; external guests are free | Validate | Avoids seat/supplier friction; exact INR pricing remains untested |
| D2-008 | Paid live-project pilots and bounded checklist/equipment mapping services are acceptable | Validate | Measures real value and prevents unlimited hidden onboarding cost |
| D2-009 | Sales language must not guarantee acceptance, legal validity, payment release or savings | Required for live pilot | Client/consultant and contract control those outcomes; evidence must precede ROI claims |
| D2-010 | No production personas or simulated success actions | Required for live pilot | Hardcoded demo states undermine contractual trust; isolate demos explicitly |

## 3. Domain decisions

| ID | Decision | Status | Rationale / earlier rule affected |
|---|---|---|---|
| D2-011 | Preserve stable requirement identities and immutable checklist snapshots | Proposed, consistent with D-011/D-012 | Historical evidence must not change meaning when a consultant template changes |
| D2-012 | Replace string-only scope discovery with formal requirement scopes for project/system/equipment/location | Proposed migration, revises D-038 | Equipment hierarchy and validation cannot safely depend only on `scope_key`; retain old values during backfill |
| D2-013 | Requirement evidence references an exact document version, not merely a logical document | Required for live pilot | Prevents a new upload from silently changing what was reviewed/approved |
| D2-014 | Preserve one active primary satisfaction per requirement in the first release; allow supporting evidence | Proposed, clarifies D-035 | Keeps MVP semantics bounded while preserving supporting files; multi-evidence coverage requires a later explicit rule |
| D2-015 | One approved replacement supersedes the old approved version only after approval | Proposed, consistent with D-014 | Uploading R2 must not erase approved R1 |
| D2-016 | File verification, version review, requirement satisfaction and handover acceptance are independent | Required for live pilot | A virus scan is not an approval; a dossier is not acceptance; current code must not merge these states |
| D2-017 | `MISSING`, `OVERDUE`, `EXPIRING` and `HANDED_OVER` are derived views, not universal persisted states | Proposed | Avoid stale statuses and divergent enums; acceptance derives from submission history |
| D2-018 | External approval is a first-class review method, labelled and evidenced | Proposed, consistent with D-036 | Consultants need not adopt the contractor's portal, but authority/reference/method/date must be recorded |
| D2-019 | Shared evidence requires explicit requirement/equipment coverage; no blanket approval | Required for live pilot | A combined AHU report may cover selected units, not every requirement linked to the document |
| D2-020 | Equipment passport is a read model over lifecycle records, not a giant duplicated JSON blob | Proposed | Prevents inconsistent copied history; supports procurement-to-DLP traceability |
| D2-021 | Structured inspections record attempts, readings, units and instrument-on-test-date | Proposed | PDF-only tests cannot validate calibration or preserve repeated attempt history |
| D2-022 | Handover package is immutable and version-pinned; acceptance is recipient-specific | Proposed, consistent with snapshot intent | Regeneration creates a new package; required-recipient decisions aggregate deterministically |
| D2-023 | Project closure requires required acceptance and mandatory issue resolution or authorised exception | Required for live pilot | Prevents lifecycle-only closure without actual handover completion |
| D2-024 | Commercial readiness is separate from actual certification, payment and receipt | Proposed | Contract-value retention estimates must not be presented as actual receivables |
| D2-025 | Money uses integer paise and dated events, not JavaScript floating point or single mutable balances | Required for commercial module | RA/deduction/retention adjustments need audit and exact arithmetic |

## 4. Architecture and security decisions

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D2-026 | Retain modular monolith + worker + PostgreSQL + private object storage | Proposed, consistent with D-001/D-002 | Appropriate for a small team; no distributed-system evidence |
| D2-027 | Consolidate review, supplier, permission and status logic before adding features | Required for live pilot | Multiple current paths enforce different invariants |
| D2-028 | Keep direct-to-storage uploads, but API completion yields only `PROCESSING` | Required for live pilot, clarifies D-004 | Preserves mobile scalability without bypassing worker verification |
| D2-029 | ClamAV/storage/verification failures fail closed | Required for live pilot | No file is “clean by absence of scanner” |
| D2-030 | Original objects are immutable; sanitisation/compression/preview creates a derivative | Required for live pilot | Chain of custody and original evidence must survive processing |
| D2-031 | Missing storage returns an error, never a generated certified PDF | Required for live pilot | Removes fabricated evidence risk |
| D2-032 | Use transactional outbox with full versioned payload, deterministic jobs and idempotent consumers | Required for live pilot, strengthens D-005 | Prevents lost/stalled jobs and duplicate effective side effects |
| D2-033 | Use one OpenAPI contract and runtime validation; generate web client | Proposed, implements D-032 | Current inline types do not enforce runtime contracts |
| D2-034 | Session active org remains authoritative; add real project/grant scope checks | Required for live pilot, extends D-034 | RLS alone cannot distinguish projects inside one tenant |
| D2-035 | Guest sessions are grant-bound, short-lived and independently identified | Required for live pilot | Supplier must not act as grant creator; every operation rechecks scope |
| D2-036 | Use explicit risk-based guest verification policy | Validate, revises Q-004 discussion | Supplier low-friction uploads can be screened; acceptance/review needs stronger identity. Default policy must be tested, not assumed |
| D2-037 | Idempotency claims occur before mutation and include route parameters/body hash | Required for live pilot | Current read-then-response approach permits duplicate concurrent execution |
| D2-038 | Preserve append-only audit and recompute hashes during verification | Required for live pilot | Link-only verification does not detect changed content; audit is tamper-evident, not superuser-proof |
| D2-039 | Redis is required in staging/production; no silent in-memory substitute | Required for live pilot | OTP/rate limit/queue coordination cannot be silently weakened |
| D2-040 | Production OTP/storage providers must be real and fail loudly | Required for live pilot | Current no-op providers cannot authenticate or store real customers |
| D2-041 | PostgreSQL search/projections first; no Elasticsearch or warehouse initially | Proposed | Simpler operations; add only after measured scale needs |
| D2-042 | Migrations are forward-only with a checksum ledger and clean/upgrade CI | Required for live pilot | Current rerun model and duplicate/conflicting patches are unsafe |
| D2-043 | PDF sanitisation is a derived rendition, not proof that original is harmless | Required for live pilot | Flatten/linearise is not a complete active-content removal guarantee |
| D2-044 | Digital signature feature is deferred until real CMS/certificate/target validation exists | Deferred; consistent with D-019 | Current client-provided signature metadata is not a verified Class 3 DSC |
| D2-045 | Keep qpdf subprocess compilation, but remove unmeasured O(1) claims | Proposed | pdf-lib bookmark stage can still load full package; profile representative artefacts |
| D2-046 | Production configuration uses environment-specific API/storage origins, not localhost constants | Required for live pilot | Current Next.js rewrite is local-only |
| D2-047 | Automated future audit partitions and 365+ day security-log operations are required, not static 2026 partitions | Required before scale | Prevents future audit insertion failures; legal periods still require counsel confirmation |

## 5. UX decisions

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D2-048 | Work Inbox is the default home, replacing four separate hardcoded role dashboards | Proposed | Employees need action/actor/blocker, not role-specific static cards |
| D2-049 | Project navigation is task/domain coherent: Requirements, Equipment, Documents, Inspections/Cx, Reviews, Handover, Commercial, Activity | Proposed | Makes lifecycle explicit without turning into generic ERP |
| D2-050 | Use dense accessible tables and structured lists, not a card for every metric | Proposed | Document controllers and PMs need scanning and comparison |
| D2-051 | Mobile is capture/inspection-first; desktop is review/package/control-first | Proposed | Different contexts require different hierarchy, not the same desktop layout compressed |
| D2-052 | QR opens an authorised equipment passport, not an unprotected file URL | Proposed | Field speed without public evidence exposure |
| D2-053 | Offline copy distinguishes saved-on-device, uploaded, verified, submitted and approved | Required for live pilot | Prevents false success and duplicate work |
| D2-054 | Voice notes/transcription are draft assistance, not approved evidence content | Proposed | Human confirms accuracy; original audio remains linked |
| D2-055 | Hindi/regional language follows field-user testing; all strings externalised now | Deferred, consistent with D-030 | Avoid premature translation and mistranslated contractual terms |
| D2-056 | Target WCAG 2.2 AA through measured testing, including dialogs, PDF controls, tables and mobile | Required for release | Accessibility is an acceptance activity, not a visual claim |
| D2-057 | Only genuine floating overlays receive shadows; main panels use borders and spacing | Proposed | Premium enterprise clarity without generic card-heavy design |

## 6. Rejected or deferred alternatives

| Alternative | Decision | Reason |
|---|---|---|
| Broad MEP/construction ERP at launch | Rejected now | High scope and adoption cost; weak evidence of need versus closeout specialisation |
| Replace Aconex/main-contractor CDE | Rejected | Customer must feed existing contractual systems; prepare/export is more realistic |
| Compete head-on with all commissioning platforms | Rejected | Adopt asset/Cx expectations; differentiate on external collaboration and Indian commercial closeout |
| Generic task management to increase engagement | Rejected | Creates more administration and obscures evidence semantics |
| Per-seat/per-supplier pricing | Rejected as default hypothesis | Discourages collaboration and supplier participation |
| Free unlimited onboarding | Rejected | Mapping is real service effort and must be measured/bounded |
| Microservices/Kubernetes/Kafka | Rejected without scale evidence | Adds operational cost with no demonstrated requirement |
| Elasticsearch/data warehouse now | Deferred | PostgreSQL search/read projections are sufficient until measured |
| Native mobile apps now | Deferred | PWA can validate capture/offline demand at lower cost |
| Full Bluebeam/BIM markup suite | Rejected | Focus on page comments, comparison and evidence context |
| Arbitrary multi-stage workflow builder now | Deferred | Pilot actual reviewer matrices before generalising |
| AI approvals or autonomous evidence acceptance | Rejected | Human contractual accountability is non-negotiable |
| Third-party AI processing by default | Deferred | Privacy, DPA, customer confidentiality, cost and accuracy need review |
| Real DSC/PAdES claims using current signature records | Rejected | Client-supplied CMS text is not proof of signature or certificate validity |
| Eight-year hosting bundled at an untested price | Rejected until costed | Long retention needs measured storage/support and contractual terms |
| Hardcoded standard test pressures/calibration validity for every project | Rejected | Values come from approved contract/ITP/instrument records |

## 7. Product assumptions requiring validation

| ID | Assumption | Evidence currently available | How to validate / consequence if false |
|---|---|---|---|
| A2-001 | HVAC subcontractors will pay for closeout workflow | Domain concept and vendor analogues, no direct customer evidence | Buyer interviews + paid live pilot; otherwise narrow to assisted service or stop |
| A2-002 | Mid-project import produces value quickly | Import concept exists, but implementation inconsistent | Time accepted checklist/equipment setup; revise onboarding if too costly |
| A2-003 | PM/document controller will replace the shadow register | No direct usage evidence | Observe weekly coordination and register reconciliation; simplify data model if they maintain both |
| A2-004 | Suppliers will use scoped phone links without training | Product hypothesis, not measured | Measure open/upload/OTP abandonment and support contacts |
| A2-005 | Consultants accept external recorded approval rather than using the portal | External workflow concept, not legal/customer proof | Consultant interviews + pilot accepted submittals; retain external PDF/email evidence |
| A2-006 | A single primary satisfaction covers most checklist requirements | Existing MVP decision, not real checklist proof | Analyse five+ checklists; add explicit multi-evidence coverage if common |
| A2-007 | Equipment passports create repeat/DLP value | Cx products support asset-centric histories | Test retrieval and warranty tasks on subsequent projects/DLP |
| A2-008 | WhatsApp deep links are sufficient initially | No Business API is needed for link sharing | Measure manual share workflow before paying for API integration |
| A2-009 | Offline PWA meets site needs | Implementation intention, no device evidence | Test mid-range Android, basement connectivity and browser storage eviction |
| A2-010 | Per-company/project pricing beats per-seat | Competitor models vary, no Indian willingness-to-pay evidence | Price test actual projects and compare conversion/support margin |
| A2-011 | Customers will use the product on the next project | Renewal hypothesis only | Measure second-project activation and template reuse |
| A2-012 | Commercial readiness is a buying differentiator | Financial logic, not direct demand evidence | Include RA/retention examples in discovery before building full ledger |
| A2-013 | Consultant checklists can be mapped mostly deterministically | Keyword script exists, accuracy not independently measured | Build labelled real-world mapping dataset and measure corrections |
| A2-014 | English UI is adequate initially | Not validated | Field-user observation; translate high-frequency labels only if needed |
| A2-015 | One derived PDF preview is enough for most users | Format support broad in current code, demand unclear | Measure actual file types; avoid Office/DWG conversion until required |
| A2-016 | Real payment is delayed by missing technical evidence in target segment | Plausible domain hypothesis, no verified customer cases | Trace actual withheld/accepted bills and reasons without assuming causation |
| A2-017 | Client acceptance with exceptions is a common useful workflow | Domain model includes it, not direct proof | Validate with actual client/consultant handover examples |
| A2-018 | Users need page-level revision comparison | Bluebeam validates general demand, not TradeCloseout priority | Observe review process; defer complex overlay if metadata comparison suffices |
| A2-019 | Structured Cx forms are necessary for initial purchase | Cx competitors prove category demand, not initial closeout wedge | Determine whether PDF evidence is enough for pilot; build forms only after core value |
| A2-020 | Customers accept India-region cloud hosting and external guest links | Hosting preference is not legal proof or universal consent | Review DPA/customer confidentiality and blocked-cloud constraints |

## 8. Unverified claims that must not be used as facts

The following appear in repository narratives/specification material or common product claims. They remain unverified by this research and should not appear in sales, legal, performance or production-readiness statements without evidence:

| Claim | Current treatment |
|---|---|
| Indian SMEs universally operate through Excel/WhatsApp/paper | Hypothesis requiring primary evidence; use specific pilot observations instead |
| Typical subcontract values, retention percentages, DLP durations and release conditions | Contract-specific; never use a universal figure in readiness or marketing |
| “60–80% of handover documents are created before handover” | Unmeasured statement; do not quote |
| “60–90 day handover delay” or specific interest savings | Unverified; measure actual project delay/cost |
| Specific CC/OD interest rate and retention-delay cost formula | Customer-specific financial assumption, not a market fact |
| “92.3% consultant checklist mapping coverage” | One sample/script result is not a representative accuracy metric |
| “98/99-type catalogue is comprehensive” | Not proven against a representative real checklist corpus |
| Sub-three-second large PDF streaming on 4G | Must be measured by device/network/package |
| O(1) memory PDF compilation including bookmarks | Not guaranteed; current pdf-lib stages can load files |
| Two-second production PITR restore | Not established by this research; representative restore with assertions required |
| “Production Verified,” “zero-trust,” “zero race conditions,” “zero data loss” | Absolute claims not supported; use tested behaviour and limitations |
| Current Class 3 DSC/eMudhra signature is valid | Not implemented as verified signing; do not claim |
| Aconex/Autodesk/Procore are always too expensive for target SMEs | Need comparable quotes; use workflow fit, not invented price comparisons |
| All O&M/test/as-built requirements are statutory | Often contractual/client-specific; verify instrument and applicability |
| India-region hosting alone satisfies all data-protection duties | Hosting is only one control; DPA/security/retention/process are separate |
| Supplier PIN equals secure identity verification | PIN/link security and screening are different from verified identity |
| Existing 97 passing tests prove production readiness | Tests do not cover several critical live workflows |

## 9. Customer validation plan by question

| Question to answer | Evidence to obtain | Decision affected |
|---|---|---|
| Who signs and who uses daily? | Buyer/champion/user map from live project | Pricing, onboarding and dashboard hierarchy |
| What was the last actual handover delay? | Timeline, rejection and payment/acceptance record | Core pain and ROI, not invented industry averages |
| Which requirements repeat across clients? | Five+ real checklists mapped with provenance | Template strategy and multi-evidence rule |
| What makes setup acceptable? | Timed import/mapping with actual workbook/equipment register | Self-serve vs assisted service |
| Which uploads need originals vs compressed preview? | File-type sample and consultant readability requirements | Offline/original storage policy |
| Do suppliers require OTP? | Supplier security expectations + completion/abandonment test | Guest verification default |
| How do consultants approve today? | Stamped PDF/email/portal examples and reviewer interviews | External vs in-app review emphasis |
| Which comments need resolution and comparison? | Actual revision cycle and reviewer notes | Review workbench priority |
| Which tests need structured readings? | ITP/test examples with units, ranges, calibration | Cx module scope |
| What does an acceptable dossier look like? | Accepted package/index/manifest sample | Compiler/output/layout requirements |
| What happens after client exceptions? | Exception register and owner/due workflow | Work Inbox and change model |
| Which evidence gates RA/retention/final bill? | Actual contract milestone and deduction/release records | Commercial model and differentiation |
| What warranty basis applies? | Contract and OEM examples with conflicting dates | Warranty rules and conflict UX |
| What is needed during DLP? | Real defect/warranty retrieval task | Passport retention and renewal value |
| Which data is confidential from whom? | Role/party access examples | Guest projection and tenant scope |
| Which mobile/language/offline constraints exist? | Device/network observation and user task test | PWA/language/native decisions |
| What price covers value and support? | Paid offer, actual onboarding/support cost and renewal | Packaging and service economics |
| Why would the customer stop after one project? | Churn interview and next-project behaviour | Subscription vs one-project offering |

## 10. Outstanding technical and legal verification

1. Inspect the actual deployed schema and reconcile it with SQL migrations and Drizzle before choosing a migration baseline.
2. Run a clean migration and upgraded-copy migration in isolated infrastructure; no claim of deployment readiness without it.
3. Verify real storage, ClamAV, Redis, SMS/email, package and recovery integrations in staging.
4. Have a practising Indian CA confirm invoicing entity, SAC/GST, TDS and e-invoice applicability; existing repository notes are not sign-off.
5. Have Indian counsel review DPDP roles, retention, breach response, guest access, external approval and evidence wording.
6. Verify current official engineering standards where a contract invokes them; do not hardcode from narrative guides.
7. Independently assess tenant/project/grant isolation, file upload/download and background processing before a live pilot.
8. Measure representative file/package performance on actual devices and networks.
9. Determine what to do with existing unverified/synthetic evidence records without deleting or silently reclassifying them.

## 11. Final decision summary

The design recommends a focused but ambitious product:

- HVAC-first, contractor-owned and closeout-specific.
- Evidence-version exact and equipment-aware.
- Human-reviewed, with external consultants supported honestly.
- Secure by verified originals, scoped sessions and deterministic processing.
- Useful from checklist through handover acceptance and DLP.
- Commercially connected only when actual RA/retention events are available.
- Simple enough for a small engineering team to operate.

Nothing in this register asserts that those outcomes have already been delivered. Implementation begins with trust-critical remediation and real customer evidence, not with the full feature list.
