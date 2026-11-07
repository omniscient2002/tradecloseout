# Domain and market research

Research date: 2026-11-05. Evidence labels: **Fact** is supported by the linked primary source; **Inference** is product interpretation; **Hypothesis** requires interviews or observation. Repository examples and fictional contractor stories inform understanding but are not independent customer research. No contractor interview, paid trial or price quote was conducted in this assignment.

## Primary-source evidence ledger

| Source | Verified observation | Consequence / limit |
|---|---|---|
| [CPWD HVAC specification 2024, section 17.5.10](https://www.cpwd.gov.in/Publication/HVAC_Specification_2024.pdf) | Indexed final documentation includes manuals, test records and manufacturer warranties alongside commissioning material | Fact from search-indexed official PDF excerpts; direct full-PDF retrieval timed out/was rejected. Demonstrates one public-sector specification, not every Indian contract |
| [ASHRAE commissioning guidance](https://www.ashrae.org/technical-resources/bookstore/commissioning) | Commissioning process evaluates facilities/systems against owner's project requirements | Fact; commissioning is a requirements and verification process. No paid standard text inspected; do not invent clause-level mandatory thresholds |
| [Procore ball-in-court support](https://v2.support.procore.com/product-manuals/submittals-project/tutorials/change-the-ball-in-court-on-a-submittal/) | Required workflow groups receive responsibility sequentially, with administrator control to move responsibility back | Fact; responsibility and review response are independent of mere file presence |
| [Procore create-submittal support](https://support.procore.com/products/online/user-guide/project-level/submittals/tutorials/create-a-submittal) | Submittals carry document identification, responsible contractor, due dates, workflow and revision fields | Fact; an upload-only checklist is not adequate submittal management |
| [Autodesk submittal packages](https://help.autodesk.com/cloudhelp/ENG/Build-Submittals/files/work-submittals/Create_Package.html) | Packages can organise by physical location | Fact; document taxonomy and installation scope should be distinct |
| [Autodesk About Assets](https://help.autodesk.com/cloudhelp/ENU/Build-Assets/files/getting-started/About_Assets.html) | Equipment can connect to project records, quality/commissioning and barcode/QR/NFC access | Fact; current page uses Forma Build branding. Do not assume legacy product naming or entitlements remain constant |
| [Oracle Aconex Document Processes](https://help.aconex.com/document-processes/what-is-document-processes/) | Metadata routing, assigned reviewers and accumulated comment registers support cross-organisation reviews | Fact; serious competition already connects document review and issue handling |
| [CxAlloy](https://www.cxalloy.com/) | Vendor describes asset-linked checklists/tests/issues, offline mobile collection and report generation | Fact about marketed capability; not an independently benchmarked performance result |
| [MaintainX mobile/web help](https://help.getmaintainx.com/mobile-vs-web-overview) | Mobile QR scanning connects assets/locations with work orders | Fact; QR access alone is not differentiation |

No verified India-specific pricing comparison was obtained. Do not claim that these products are inherently unaffordable, hard to use or lack version-aware evidence. Their breadth suggests configuration and adoption costs to investigate, not proven weaknesses. TradeCloseout differentiation must be demonstrated with a narrower contractor-owned workflow and better adoption results.

## Lifecycle ownership and gating model

This is a proposed configurable operating model informed by the sources and repository domain materials. Actual authority, terminology and stage ordering must be captured per contract. Contractor owns its internal record; external reviewer owns their response, and client acceptance cannot be substituted by internal completion.

| Stage | Creator / operational owner | Reviewer or counterparty | Evidence and record | What prevents next stage |
|---|---|---|---|---|
| Enquiry/tender | Estimator, owner | Commercial/technical lead | Enquiry revision, exclusions, clarification log, draft obligation register | Unresolved scope, missing deliverables, commercial exceptions |
| Award/contract/BOQ | PM/commercial lead | Authorised contractor and client/main contractor | Contract revision, source clause, BOQ reference, milestone, payment/DLP/retention terms | Scope/authority/baseline not agreed |
| Engineering | Design engineer | Consultant/PMC, client if specified | Drawing register, design calculations, data sheets, exact revision, comments | Technical response pending, revised design or unresolved condition |
| Material approval | Procurement/design | Consultant or delegated approver | Material submittal, make/model, compliance deviation, samples if required | Unapproved substitution or open technical clarification |
| Purchase/OEM | Procurement | OEM and internal technical team | PO line documentary schedule, promised date, FAT/dispatch documents | Missing tests/manuals/traceability before dispatch |
| Delivery/install | Site engineer | QC, main contractor/consultant witness | Material inspection, serial/tag reconciliation, installation inspection, site photos | Wrong item, incomplete inspection, workfront dependency |
| Quality | QC engineer | Assigned witness/consultant | Inspection/test plan revision, inspection request, result, NCR | Hold point unreleased, inspection rejected or evidence incomplete |
| Testing/commissioning | Commissioning engineer | OEM/QC/consultant witness | Approved procedure, instrument calibration, readings/units/tolerances, pass criteria, retests | Prerequisites unmet, instrument invalid at test time, failed result |
| Submission/review | Document controller | Named consultant/client authority | Numbered transmittal with exact items, returned markup/stamp/email | Waiting response, request changes, superseded submittal |
| Snag/defect | Site/QC/client observer | Assigned closer and verifier | Location/asset, severity, remedy, closure proof and verification | Open blocking snag or unverified remedy |
| As-built/O&M | Engineering/OEM/DC | Consultant/client/FM recipient | Final drawings, manuals, spares, training/attendance, emergency contacts | Missing final revision, wrong equipment or incomplete FM material |
| Handover | DC prepares, PM issues | Named required recipients | Immutable dossier and recipient decisions, acceptance exceptions | Package generation failure or pending contractual acceptance |
| DLP/warranty | Service coordinator | Client/OEM under contract | Separate asset warranty and project DLP anchor evidence, defect notices | Open liability event, disputed start date or unresolved defect |
| RA/milestone | Commercial lead | Engineer/QS/main contractor | Bill reference, measurement/JMR evidence, approved milestone prerequisite pack | Documentary prerequisite unmet, measurement or certification pending |
| Retention/final closure | Owner/commercial lead | Contractual release authority | Tranches, eligibility proof, application, certification and receipt records | DLP condition, final acceptance or payment still outstanding |

Do not encode the table as a mandatory linear project state machine. Engineering revisions can continue during procurement; sectional handover can precede whole-project commissioning; seasonal tests may remain deferred with explicit agreement. Model scope-level dependencies and contract-specific conditions. Measurement Book/JMR files can be linked evidence without implementing quantity accounting.

## Segment-specific operating hypotheses

| Segment | Likely working pattern to test | Product implication and discovery question |
|---|---|---|
| Small specialist contractor | Owner/PM combines commercial and documentation roles, spreadsheets plus messaging | Start from imported register, low setup, few roles. Can owner identify missing evidence without a DC? |
| Medium MEP contractor | Shared DC/procurement across projects, multiple OEMs, consultant return cycles | Portfolio inbox, bulk operations, scope-based review and supplier documentary schedule. Which repeated task consumes DC time? |
| Large contractor | Formal controls, internal systems, varied client portals | Export/API compatibility and durable audit. Will a contractor-owned ledger remove or add duplicate work? |
| Main contractor | Coordinates trades and contractual interfaces | Restricted submissions and status exchange; avoid giving access to subcontractor internal commercial notes |
| Specialist subcontractor | Needs to prove scope completion within upstream deadlines | Main beachhead: owns evidence across client systems and protects project knowledge |
| Consultant/PMC | Reviews many technical submittals and distinguishes conditional responses | Minimal review interface, exact revision and comment resolution; no subscription/account friction for simple bounded response |
| OEM/supplier | Supports many buyers, serial-specific and generic documents differ | Requested list by PO/equipment, reuse suggestions with explicit applicability, zero visibility into unrelated suppliers |
| Client/FM | Needs usable final asset records after project team disperses | Controlled passport export and acceptance checklist, no exposure to internal notes or unsupported certification claims |

These are research hypotheses, not prevalence statistics. Geography, contract form, client industry, cleanroom/hospital/data-centre requirements and main-contractor rules may matter more than company size. Do not hard-code fictional narrative workflows from repository stories.

## Independent competitive assessment and positioning

Procore provides structured submittal responsibility and workflow; learn its separation of assignee and response. Autodesk connects assets, quality and handover; match trustworthy linking rather than competing on BIM breadth. Aconex supports cross-organisation routing and comment records; offer a contractor record that can export into upstream systems rather than trying to replace the contractual CDE. CxAlloy demonstrates that equipment-centred commissioning and offline work are established capabilities. MaintainX illustrates aftercare workflows; TradeCloseout should export to FM/CMMS rather than build a complete maintenance system.

**Inference:** a meaningful wedge is the explicit chain contract clause → scoped obligation → exact evidence revision → qualified decision → frozen acceptance package → commercial prerequisite. Its value depends on lower adoption cost, trustworthy external participation and evidence portability. None of these alone is unique; the integrated contractor workflow is the hypothesis to test.

## Validation programme

Recruit six initial organisations across small and medium specialist contractors, plus at least two consultant/PMC reviewers and three supplier/OEM contacts across those projects. Obtain permission to observe and redact one real project register, returned submittal, OEM document list, commissioning report, handover index, RA evidence pack and retention-release correspondence. These are recruitment targets, not completed research.

Observe one live handover preparation and one return/revision cycle. Record creator, owner, reviewer, authority, exact revision, due date, missing evidence, app/portal hops, elapsed work and downstream blocker. Ask for actual contract source when a participant says something is mandatory. Test imports and exports with the customer's own register and index. Interview who pays, who uses, who can veto and who owns evidence after project completion.

Proposed success criteria: two pilot contractors repeatedly use the inbox and evidence workflow for four weeks; at least one real submitted dossier can be reconstructed independently; no internal spreadsheet is needed for the tracked evidence scope; users correctly distinguish uploaded, verified, approved and accepted in usability tests. Establish baseline before claiming time reduction. Validate willingness to pay using a paid pilot and renewal decision, not verbal enthusiasm.

## Domain gaps to close

Immediate: version-specific qualification, independent review authority, submitted-item identity, evidence rules, contextual applicability and immutable package artifacts. Later: system/location hierarchy; PO-line-to-many-asset identity; inspection hold points; calibrated instrument applicability at test time; structured readings, acceptance criteria and retests; sectional acceptance and aftercare anchors; retention tranches, applications and receipts; provenance of source clause and amendment. All are designed in architecture/tasks; none requires a full accounting ERP.
