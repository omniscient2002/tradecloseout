# TradeCloseout — Top 25 Opportunities Not Adequately Addressed Before

**Status:** Second-pass ranked discovery; no application source changes  
**Date:** 4 November 2026  
**Ranking basis:** Expected contractor value, reuse, differentiation and feasibility after the P0 foundation  
**Evidence caveat:** No customer-frequency or willingness-to-pay statistics are assumed

## 1. Ranked register

“Build now” still follows the existing trust/security remediation. “Validate” means use real customer artefacts before committing a full module. Effort includes implementation plus near-term operational complexity.

### 1. Obligation source graph with RFI/site-instruction impact

- **Problem:** Current requirements do not consistently prove their contract/spec/BOQ/RFI/variation origin or which downstream work a decision changes. Frequency is unknown but potentially recurring on design-coordination-heavy projects.
- **Proposed solution:** `obligation_sources` and typed dependencies linking exact source revisions to requirements, equipment, inspections and commercial milestones. **New.**
- **Users / business value:** PM, design, site, QC and commercial teams; fewer unrecorded decisions and better entitlement/rework control. WTP confidence is untested but potentially high.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then narrow build. Medium effort. Needs real RFI/instruction/variation artefacts and existing requirement/evidence model.
- **Success criteria:** Source-linked obligation coverage, reviewer-confirmed mapping accuracy, and all affected downstream items identified in an RFI-impact scenario without silent baseline mutation.

### 2. PO and vendor-document obligation schedule

- **Problem:** Supplier links target requirements directly, not an upstream PO/vendor-document schedule; late FAT/O&M/warranty discovery is likely on made-to-order equipment.
- **Proposed solution:** Lightweight PO/revision/line and supplier obligations due before manufacturing/FAT/dispatch/delivery/install/handover. **Extended.**
- **Users / business value:** Procurement, PM and suppliers; earlier document collection and less last-minute chasing.
- **Decision / effort / dependencies:** **BUILD NOW** in narrow equipment-only form after core grants. Medium effort; requires equipment, supplier scopes and approval states.
- **Success criteria:** Each supplier request has PO-line/stage/owner/due date; on-time upload rate and reduced outstanding obligations at dispatch/handover versus project baseline.

### 3. Equipment identity revisions and evidence revalidation

- **Problem:** Serial/model/location edits can silently change the apparent subject of approved FAT/MIR/warranty evidence.
- **Proposed solution:** Effective-dated identity revisions, aliases, correction/replacement distinction and impact review on linked evidence. **New.**
- **Users / business value:** QC, procurement, service and audit; avoids wrong-unit warranties and false provenance.
- **Decision / effort / dependencies:** **BUILD NOW.** Medium effort/high migration care; requires all asset-linked documents and historical records.
- **Success criteria:** Every identity edit has reason/effective date/history; affected evidence enters revalidation and no old record is silently reassigned to a different unit.

### 4. Dual event time and backdated-entry provenance

- **Problem:** External decision/delivery/inspection dates and system insertion dates are conflated, preventing reliable notice/calibration/warranty/claim chronology.
- **Proposed solution:** `occurred_at` + server `recorded_at`, timezone/precision, source reference, backdated reason and correction linkage across meaningful events. **New.**
- **Users / business value:** All operational and claims users; defensible late entry and actual chronology.
- **Decision / effort / dependencies:** **BUILD NOW.** Medium cross-cutting effort; API DTOs, audit and read models.
- **Success criteria:** Every external/physical event exposes both times; late/backdated entry is visible and no single timestamp is used for both occurrence and recording.

### 5. Contractual authority and delegation snapshots

- **Problem:** RBAC proves application access, not that the person could approve a technical deviation, variation, waiver or final acceptance.
- **Proposed solution:** Effective-dated authority grants with party/scope/limit/appointer/evidence and immutable snapshot at decision. **Extended.**
- **Users / business value:** Reviewers, owners, client representatives and claims teams; fewer disputed approvals.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then implement for decision classes used in pilots. Medium effort/high correctness dependency; requires party contacts and decision service.
- **Success criteria:** Every decision has an authority snapshot; expired/out-of-scope authority blocks new action without invalidating historical valid approvals.

### 6. Parent/child evidence and missing-attachment checks

- **Problem:** A test PDF may exist without gauge calibration, raw readings, witness sheet, annexure or approved method; file presence is mistaken for completeness.
- **Proposed solution:** Versioned evidence dependency rules and parent/child links producing specific missing-companion actions. **New.**
- **Users / business value:** QC, document controllers and reviewers; fewer first-pass rejections and manual checks.
- **Decision / effort / dependencies:** **BUILD NOW for known rules.** Medium effort; needs obligation dependency graph and exact-version links.
- **Success criteria:** Configured missing companions are identified before submission; measure first-pass acceptance and false missing-attachment reports by document family.

### 7. Portable, self-verifying project archive

- **Problem:** Backups do not provide former customers with independently usable evidence, and ordinary exports may omit original bytes/relationships/authority.
- **Proposed solution:** Archive containing originals, exact relationships, authority snapshots, decisions, package manifests, schema version, hashes and verification receipt. **Extended.**
- **Users / business value:** Owner/admin/future staff/customer at exit; reduces lock-in and long-term retrieval risk.
- **Decision / effort / dependencies:** **BUILD NOW in basic form**, extend with obligation coverage later. Medium effort; depends on original hashes and stable schema.
- **Success criteria:** Archive restores in a clean verifier, every included original hash matches, accepted versions/decisions are linked and receipt/missing-object report is produced.

### 8. Shipment, delivery and MIR serial/quantity reconciliation

- **Problem:** One “delivered” stage cannot represent split/consolidated/damaged/short shipments or which units are installation-eligible.
- **Proposed solution:** Separate dispatch/shipment/receipt/MIR events with line quantities, serials, accepted/rejected/damaged amounts and NCR/replacement links. **New.**
- **Users / business value:** Site, QC and procurement; avoids wrong/short/damaged equipment being treated as delivered.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then build for affected projects. High effort; requires PO lines and identity revisions.
- **Success criteria:** Delivered and accepted quantities/serials reconcile to PO and MIR; rejected/damaged units cannot become installation-eligible without a controlled exception.

### 9. Inspection appointment, hold-point notice and release

- **Problem:** A passing test may be contractually incomplete because witness notice/attendance/release was not handled, particularly concealed work.
- **Proposed solution:** Appointment, approved ITP revision, notice/acknowledgement, confirmations, no-show/reschedule, authorised waiver/release and attendees. **Extended.**
- **Users / business value:** Site, QC and consultants; avoids disputed or repeated inspections.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then build with structured inspections. Medium effort; requires authority and offline appointments.
- **Success criteria:** A hold-point test cannot complete normally without required release; notices and witness outcomes are traceable and no-show leads to rescheduling rather than silent pass.

### 10. Forwarded transmittal hops and response meanings

- **Problem:** Flat recipients cannot model subcontractor → MC → consultant → client chains or distinguish technical approval, comment, no-objection and commercial acceptance.
- **Proposed solution:** Transmittal hops, current holder, parent references, actual/recorded times, original response wording and client-specific meaning mappings. **New.**
- **Users / business value:** Document controllers, PM and external reviewers; accurate next actor and acceptance state.
- **Decision / effort / dependencies:** **BUILD LATER** after direct submissions are reliable. Medium effort; depends on bitemporal model and external decision records.
- **Success criteria:** Every hop has exact package/version/current holder; original response is preserved and canonical meaning cannot be changed without confirmation.

### 11. BOQ-to-equipment-to-JMR-to-RA quantity graph

- **Problem:** A milestone-filtered document pack cannot prove that billed quantity was approved, delivered, installed and jointly measured.
- **Proposed solution:** Versioned BOQ lines, scope links and quantity events by unit, linked to JMR/RA lines. **New.**
- **Users / business value:** QS/commercial/site/owner; fewer certification disputes and clearer variation quantities.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then build only for item-rate/quantity-driven projects. High effort; depends on BOQ artefacts, shipment/MIR and commercial model.
- **Success criteria:** Ordered/delivered/accepted/installed/JMR/billed quantities reconcile by line/unit with zero unexplained discrepancies after reviewer resolution.

### 12. RFI/instruction-to-variation and executed-at-risk evidence

- **Problem:** Current variation creation defaults to `APPROVED`; real instructions can precede commercial approval and require notice/measurement chronology.
- **Proposed solution:** Separate instruction, notice, quotation, technical acceptance, commercial approval, execution-at-risk, JMR and RA events. **New.**
- **Users / business value:** PM/commercial/owner; protects entitlement and avoids unapproved amounts looking final.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then build. High effort; depends on obligation graph, authority and RA events.
- **Success criteria:** No variation becomes approved without actual authority/evidence; executed-at-risk is explicit and every cost/time state and RA inclusion can be traced.

### 13. Approved method/ITP work-release pack

- **Problem:** Field staff can execute from a generic or superseded method/ITP because readiness checks focus on evidence produced afterward.
- **Proposed solution:** Pre-execution card verifying approved method/ITP revision, prerequisites, appointment, permits and current release. **New.**
- **Users / business value:** Site, QC and safety; avoids invalid work and repeated inspections.
- **Decision / effort / dependencies:** **BUILD LATER with O09.** Medium effort; requires versioned methods, appointment and notice releases.
- **Success criteria:** In test scenarios, superseded methods and unmet prerequisites block normal work release and identify the exact correction.

### 14. Metrological suitability and shared-instrument allocation

- **Problem:** Date-valid calibration alone does not prove instrument range/accuracy suitability or prevent double booking across sites.
- **Proposed solution:** Range/unit/accuracy/uncertainty checks plus planned/actual allocations and authorised substitution. **Extended.**
- **Users / business value:** QC/commissioning; fewer invalid tests and last-minute substitutions.
- **Decision / effort / dependencies:** **BUILD LATER with structured Cx.** Medium effort; needs ITP measurement requirements and instrument register.
- **Success criteria:** Expired, wrong-range, wrong-unit, insufficient-accuracy and conflicting allocations are blocked or require explicit exception; actual used instrument is recorded.

### 15. Physical custody handover

- **Problem:** Accepted dossier does not prove spares, special tools, keys, BMS access, licences or training were transferred.
- **Proposed solution:** Custody items with required/transferred quantity/condition/custodian/time/exceptions and credential-reset proof. **New.**
- **Users / business value:** PM, commissioning and client facilities; improves real operational readiness and closure.
- **Decision / effort / dependencies:** **BUILD LATER with package acceptance.** Medium-low effort; requires recipients and actual event times.
- **Success criteria:** All required custody items have recipient acknowledgement or owned exception; no plaintext credentials are stored.

### 16. Layered warranty and service-resolution evidence

- **Problem:** A single warranty range cannot represent component/controls/installation/workmanship coverage or service restoration after a claim.
- **Proposed solution:** Concurrent coverages plus claim/entitlement/response/attendance/restoration/client-verification/part-replacement events. **Extended.**
- **Users / business value:** Service, procurement and clients; fewer incorrect chargeability decisions and clearer DLP responsibilities.
- **Decision / effort / dependencies:** **BUILD LATER after core DLP.** High effort; depends on asset identity and warranty/defect history.
- **Success criteria:** Every service claim identifies applicable coverage, responsible party, response and restoration evidence; overlapping coverage dates do not overwrite one another.

### 17. Obligation-driven retention and granular legal holds

- **Problem:** Project-closure retention can delete evidence while warranty, defect, claim or dispute is active; accepted package may expire before source evidence.
- **Proposed solution:** Obligation/policy-based retention with project/asset/submission/evidence holds and authorised release. **New.**
- **Users / business value:** Admin/legal/service; prevents irreversible evidence loss and inconsistent retention.
- **Decision / effort / dependencies:** **BUILD LATER before purge automation.** High effort/risk; requires archive and active-obligation projections.
- **Success criteria:** Purge tests cannot delete held original/derivative/decision records, release has authority/evidence and accepted-package/source retention is explicit.

### 18. Required-on-site backward dependency planning

- **Problem:** Material approval, FAT and dispatch delays surface only when site expects equipment.
- **Proposed solution:** Required-on-site ← MIR ← delivery ← dispatch ← FAT ← material approval ← PO dependencies with promised/actual dates and current actor. **New.**
- **Users / business value:** PM, procurement and site; earlier intervention and fewer idle crews.
- **Decision / effort / dependencies:** **VALIDATE WITH CUSTOMERS**, then build limited closeout dependencies. Medium effort; requires PO obligations and event model.
- **Success criteria:** At-risk obligations are flagged before required-on-site with accurate current blocker; measure warning lead time and avoided late discoveries.

### 19. Full responsibility-transfer manifest

- **Problem:** Offboarding updates requirements/reviews only; RFIs, supplier grants, appointments, variations, claims and commitments become orphaned.
- **Proposed solution:** Transfer manifest covering all commitments, acting/permanent modes, successor eligibility and acknowledgements. **Extended.**
- **Users / business value:** Admin, PM and successors; continuity during leave/turnover and fewer personal dependencies.
- **Decision / effort / dependencies:** **BUILD NOW.** Medium effort; needs work-item registry and authority checks.
- **Success criteria:** Every open commitment has a successor or explicit unassigned queue, outgoing/incoming acknowledgement exists and no `draftPackagesCount` placeholder remains.

### 20. Template/policy blast-radius control

- **Problem:** Shared configuration edits can silently change meaning across active projects and clients at scale.
- **Proposed solution:** Impact preview by project/contract/status, policy versions, opt-in migration and rollback plan. **New.**
- **Users / business value:** Admin/PM/PMO; safer reusable templates and fewer widespread configuration incidents.
- **Decision / effort / dependencies:** **BUILD LATER before broad reuse.** Medium-high effort; depends on immutable snapshots and obligation links.
- **Success criteria:** Active project meaning cannot change without preview/confirmation; all affected projects and historical policy versions are listed and migration is reversible.

### 21. Deterministic equipment/document candidate matching

- **Problem:** Manual linking is slow and inconsistent, while unverified AI linking could corrupt evidence provenance.
- **Proposed solution:** Exact hash, equipment alias/serial dictionaries, filename/PDF text/OCR candidates with human confirmation. **Extended.**
- **Users / business value:** Document controllers, procurement and site; reduced linking effort without auto-approval.
- **Decision / effort / dependencies:** **BUILD NOW as suggestion only.** Medium effort; needs equipment aliases and optional OCR.
- **Success criteria:** No link is created without confirmation; measure correct-first-candidate rate, false-link avoidance and time per 100 documents.

### 22. Coded rejection and recurrence intelligence

- **Problem:** Repeated rejection reasons remain buried in free-text comments, preventing corrective action at source.
- **Proposed solution:** Structured reason codes plus SQL trends by document type, supplier, equipment, project and reviewer; optional text clustering later. **New.**
- **Users / business value:** QC, PM, procurement and owners; fewer repeated submission defects.
- **Decision / effort / dependencies:** **BUILD LATER after reliable decisions.** Low-medium effort; depends on coded comments and adequate sample size.
- **Success criteria:** Every trend links to source decisions; recurrence of selected defect categories falls after intervention without opaque predictive scoring.

### 23. Factual supplier cycle-time intelligence

- **Problem:** Overall elapsed time can unfairly blame suppliers for consultant/contractor/scheduled delays; opaque scores are unsafe.
- **Proposed solution:** Actor-work intervals and supplier obligation cycle breakdown by document/stage/project. **New.**
- **Users / business value:** Procurement and PM; factual escalation and better supplier coordination.
- **Decision / effort / dependencies:** **BUILD LATER.** Low-medium effort; depends on dual timestamps and actor intervals.
- **Success criteria:** Reports separate supplier, contractor, consultant, client and scheduled time with source events; no performance label is generated without sufficient/contextual data.

### 24. External decision bridge: email and incumbent CDE interchange

- **Problem:** Requiring migration away from email/Aconex/Procore creates adoption resistance and duplicate entry of returned decisions.
- **Proposed solution:** Start with transmittal/export mapping, then provider-specific email/CDE ingestion of returned responses with exact-version deduplication and human confirmation. **New.**
- **Users / business value:** PM/document controllers working with MC/consultants; allows TradeCloseout use alongside incumbent platforms.
- **Decision / effort / dependencies:** **INTEGRATE WITH EXISTING SOFTWARE** after export workflow and real demand. High effort/security; needs transmittal hops and provider-specific source/authority handling.
- **Success criteria:** Returned response is matched to exact package/version/hop, source wording preserved, no duplicate response is created and incorrect mappings require correction.

### 25. Archive and storage lifecycle economics

- **Problem:** Permanent thumbnails/OCR/temp dossiers and abandoned multipart uploads create unpredictable long-term cost and may pressure unsafe deletion of originals.
- **Proposed solution:** Separate original/accepted/derived/aborted retention, regenerate working derivatives and clean temporary artifacts deterministically. **New.**
- **Users / business value:** Owner, finance and operations; predictable cost without sacrificing evidence.
- **Decision / effort / dependencies:** **BUILD NOW for temporary files, policy later.** Low-medium effort; needs object classification and retention obligations.
- **Success criteria:** Temporary artifacts expire and original hashes remain intact; storage/egress cost per project is measured and no original is deleted by a cost-only cleanup.

## 2. Recommended order of attack

### Immediate, narrow and high-leverage

- PO/vendor-document obligations (2)
- Identity revisions (3)
- Dual timestamps (4)
- Parent/child evidence dependencies (6)
- Basic portable archive (7)
- Full responsibility transfer (19)
- Deterministic matching (21)
- Temporary-storage lifecycle (25)

### Validate with real contract/project artefacts before building deeply

- Obligation graph (1)
- Shipment/MIR (8)
- Inspection notice/release (9)
- BOQ quantity graph (11)
- Variation chronology (12)
- Required-on-site dependencies (18)
- Authority model (5)

### Build after core pilot reliability

- Transmittal hops (10)
- Work-release pack (13)
- Metrology/allocation (14)
- Custody handover (15)
- Layered warranty/service (16)
- Retention/legal holds (17)
- Template blast-radius controls (20)
- Rejection and supplier intelligence (22–23)
- External email/CDE interchange (24)

## 3. Final ranking rationale

The top opportunities improve the **meaning and defensibility of closeout**, not just the number of screens. They preserve authority, actual chronology, physical facts and long-term proof while reducing repetitive administration.

BOQ, structured commissioning and external connectors have considerable potential, but they should not delay the smaller high-leverage improvements: identity history, dual timestamps, dependency checks, vendor-document obligations, portable archives and full responsibility transfer.
