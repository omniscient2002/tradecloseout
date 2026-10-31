# TradeCloseout — System Specification

**Status:** Version 0.2.1 — Hardened & Approved with Conditions following Independent Red-Team Meta-Audit.
**Change history:** v0.2.1 applies the full independent red-team remediation set (`RT-001` through `RT-042`, Patches 1, 2, and 3 from `TRADECLOSEOUT-AUDIT/`), resolving all critical PostgreSQL DDL errors, state machine deadlocks, missing API endpoints, and statutory compliance mandates (CERT-In 6h, DPDP Rules 2025 365d retention, GST Rule 46).
**Product:** Multi-tenant SaaS for technical documentation, compliance tracking and project handover, initially for Indian HVAC subcontractors.
**Audience:** Founder/developer, designer, QA, prospective design partners, technical advisors.
**Last updated:** 2026-10-31.

---

## 1. What this directory is

This is the authoritative specification for TradeCloseout. It is a design document, not marketing material and not a tutorial. It defines the domain, requirements, permissions, workflows, configuration model, data model, architecture, APIs, UI, failure behaviour, security posture, tests, roadmap and commercial validation plan.

No application code exists yet. Nothing in this directory should be read as a claim that the product is built or commercially validated.

## 2. Reading order

| Order | Document | Why read it |
|---|---|---|
| 1 | [`00-PRODUCT-VISION.md`](00-PRODUCT-VISION.md) | Problem, scope, principles, success metrics |
| 2 | [`01-MARKET-AND-DOMAIN-RESEARCH.md`](01-MARKET-AND-DOMAIN-RESEARCH.md) | How Indian HVAC projects and documentation actually work |
| 3 | [`02-BUSINESS-REQUIREMENTS.md`](02-BUSINESS-REQUIREMENTS.md) | Business goals, constraints, commercial rules |
| 4 | [`03-PRODUCT-REQUIREMENTS.md`](03-PRODUCT-REQUIREMENTS.md) | Every functional and non-functional requirement with IDs |
| 5 | [`04-DOCUMENT-CATALOGUE.md`](04-DOCUMENT-CATALOGUE.md) | HVAC document taxonomy and per-type rules |
| 6 | [`05-ACTORS-AND-PERMISSIONS.md`](05-ACTORS-AND-PERMISSIONS.md) | Roles, tenants, guests, permission matrix |
| 7 | [`06-WORKFLOWS-AND-STATE-MACHINES.md`](06-WORKFLOWS-AND-STATE-MACHINES.md) | End-to-end flows and state transitions |
| 8 | [`07-CUSTOMISATION-ENGINE.md`](07-CUSTOMISATION-ENGINE.md) | Configuration hierarchy, inheritance, snapshots |
| 9 | [`08-DATA-MODEL-AND-ERD.md`](08-DATA-MODEL-AND-ERD.md) | Entities, keys, constraints, retention |
| 10 | [`09-SYSTEM-ARCHITECTURE.md`](09-SYSTEM-ARCHITECTURE.md) | Components, deployment, trust boundaries |
| 11 | [`10-API-AND-INTEGRATIONS.md`](10-API-AND-INTEGRATIONS.md) | API conventions, endpoints, integrations |
| 12 | [`11-UI-UX-SPECIFICATION.md`](11-UI-UX-SPECIFICATION.md) | Screens, fields, states, mobile behaviour |
| 13 | [`12-EDGE-CASES-AND-FAILURE-MODES.md`](12-EDGE-CASES-AND-FAILURE-MODES.md) | Failure matrix and recovery rules |
| 14 | [`13-SECURITY-PRIVACY-AND-COMPLIANCE.md`](13-SECURITY-PRIVACY-AND-COMPLIANCE.md) | Threat model, tenant isolation, Indian law posture |
| 15 | [`14-TESTING-AND-ACCEPTANCE.md`](14-TESTING-AND-ACCEPTANCE.md) | Test strategy and acceptance criteria traceability |
| 16 | [`15-DEPLOYMENT-AND-OPERATIONS.md`](15-DEPLOYMENT-AND-OPERATIONS.md) | Environments, backups, monitoring, runbooks |
| 17 | [`16-MVP-AND-IMPLEMENTATION-ROADMAP.md`](16-MVP-AND-IMPLEMENTATION-ROADMAP.md) | Phases, sequencing, complexity |
| 18 | [`17-BUSINESS-VALIDATION-PLAN.md`](17-BUSINESS-VALIDATION-PLAN.md) | ICP, pricing hypotheses, paid-pilot test |
| 19 | [`DECISIONS-AND-OPEN-QUESTIONS.md`](DECISIONS-AND-OPEN-QUESTIONS.md) | Decision log, unresolved questions, risks |
| 20 | [`SOURCES-VERIFICATION.md`](SOURCES-VERIFICATION.md) | Verification status of every legal, tax, regulatory and competitor claim |

## 3. Authority and precedence

When documents disagree, apply this order:

1. `SOURCES-VERIFICATION.md` (a claim that is not `VERIFIED` may not be relied on)
2. `DECISIONS-AND-OPEN-QUESTIONS.md` (latest accepted decision)
3. `03-PRODUCT-REQUIREMENTS.md` (behaviour)
4. `05-ACTORS-AND-PERMISSIONS.md` and `13-SECURITY-PRIVACY-AND-COMPLIANCE.md` (security overrides convenience)
5. `06-WORKFLOWS-AND-STATE-MACHINES.md`
6. `08-DATA-MODEL-AND-ERD.md`
7. `07-CUSTOMISATION-ENGINE.md`
8. All other documents

A contradiction must be logged as a new `D-###` or `Q-###` entry, not silently resolved in code. No implementation may "fill in" an unresolved behaviour without recording it.

## 4. Conventions

### 4.1 Identifiers

| Prefix | Meaning | Example |
|---|---|---|
| `BR-###` | Business requirement | `BR-004` |
| `FR-<AREA>-###` | Functional requirement | `FR-DOC-012` |
| `NFR-<AREA>-###` | Non-functional requirement | `NFR-SEC-003` |
| `WF-##` | Workflow | `WF-09` |
| `E-XXX` | Data entity | `E-DOCUMENT_VERSION` |
| `API-###` | API endpoint group | `API-014` |
| `SCR-###` | Screen | `SCR-021` |
| `TC-###` | Test case | `TC-104` |
| `BO-###` / `BR-###` | Business objective / business requirement | `BO-01`, `BR-004` |
| `EC-*` | Edge-case scenario | `EC-DOC-05` |
| `H#` | Commercial hypothesis | `H1` |
| `SRC-###` | Source-verification record | `SRC-007` |
| `D-###` | Decision | `D-007` |
| `Q-###` | Open question | `Q-012` |
| `A-###` | Assumption | `A-003` |
| `RK-###` | Risk | `RK-006` |

Area codes for functional requirements: `ORG`, `IAM`, `PRJ`, `CNT`, `CHK`, `AST`, `PTY`, `DOC`, `REV`, `HND`, `NOT`, `CFG`, `SRCH`, `AUD`, `BIL`, `INT`, `RPT`, `ADM`.

### 4.2 Status labels

Every non-obvious statement is labelled:

- **Confirmed** — accepted design decision; implementation may rely on it.
- **Proposed** — recommended but still changeable; do not build irreversible dependencies.
- **Unresolved** — behaviour explicitly not decided; tracked as `Q-###`.
- **Assumption** — believed true without sufficient evidence; tracked as `A-###`.
- **Hypothesis** — commercial or product guess to be tested; tracked as `H#` in `17-...`.

### 4.3 Evidence grading (used mainly in research)

| Grade | Meaning |
|---|---|
| **VO** | Verified against an official publication or portal. Re-check edition/date before relying on it. |
| **IP** | Common Indian industry practice. Not a legal obligation. |
| **A** | Assumption requiring customer or expert confirmation. |
| **H** | Commercial hypothesis requiring market test. |

> **Research limitation (important):** This draft was compiled from domain knowledge of Indian construction/MEP practice and the named official sources. Live web verification was not available in the drafting environment. No clause numbers, thresholds, tax rates or statutory duties in this specification should be treated as legal advice. Every `VO` claim carries a canonical source to check; every legal/tax item must be re-verified by a qualified Indian professional before launch. See `01` §2 and `13` §2.

### 4.4 Naming

- Database: `snake_case`, plural tables, UUID primary keys.
- API JSON: `camelCase`.
- Code: TypeScript `camelCase`/`PascalCase`.
- URLs: `kebab-case`.
- Status values: `SCREAMING_SNAKE_CASE` in storage and API; displayed as sentence case in UI.
- Time: stored UTC (`timestamptz`); displayed in `Asia/Kolkata` by default; Indian date display `DD MMM YYYY` (e.g., `31 Oct 2026`).

### 4.5 Canonical vocabulary

These terms have exactly one meaning across all documents:

| Term | Definition |
|---|---|
| **Organisation (Org)** | The tenant: a contractor company using TradeCloseout. All tenant data belongs to exactly one Org. |
| **User** | A natural person with a login identity. A user may belong to multiple Orgs. |
| **Member** | A user's membership and role inside an Org. |
| **Guest** | A project-scoped external user (supplier, client representative, external reviewer) with no Org-wide access. |
| **Party** | A counterparty record in an Org's directory: client, main contractor, consultant, supplier or manufacturer. A Party is not necessarily a TradeCloseout tenant. |
| **Project** | A contractual engagement owned by one Org, with its own checklist snapshot, assets and documents. |
| **Contract** | The commercial instrument governing a Project (value, retention, defect liability, specification references). |
| **Specification Register** | The recorded set of contract/specification references that drive requirements for a Project. |
| **Document** | The logical record of a deliverable (e.g., "Chiller O&M Manual"), independent of file and revision. |
| **Document Version** | One uploaded file for a Document, with revision code, hash, uploader and review state. |
| **Revision** | A new Document Version intended to supersede an earlier one. |
| **Requirement** | An instance of a checklist item on a Project, stating what evidence is needed and whether it is mandatory. |
| **Checklist Snapshot** | An immutable, versioned copy of the requirement set applied to a Project at a point in time. |
| **Asset** | A tagged piece of installed equipment (chiller, AHU, pump, etc.) on a Project. |
| **Review** | A structured decision on a Document Version by an authorised reviewer. |
| **Approval** | A terminal positive Review decision that satisfies a Requirement. |
| **Waiver** | An authorised decision that a Requirement is not required, with reason and evidence. |
| **Handover Package** | A generated, versioned compilation (index + documents) submitted to the client/main contractor. |
| **Submission** | The act and record of sending a Handover Package or response to an external party. |
| **Configuration Set** | A versioned bundle of settings at one level of the customisation hierarchy. |
| **Audit Event** | An append-only record of a security- or business-significant action. |
| **Tenant ID** | The `org_id` that owns a row. Present on every tenant-owned table. |

## 5. How to use this specification

- **Developer:** implement `03` requirements in the order given by `16`, against the states in `06`, schema in `08`, contract in `10`, and security rules in `13`. Do not implement a screen (`11`) before its API and permission rules exist.
- **Designer:** `11` is binding for flows and states; visual styling is not specified.
- **QA:** every `FR` must map to at least one `TC` in `14`. A requirement without a test is not done.
- **Sales/founder:** `01` and `17` distinguish evidence from hypothesis. Do not quote hypotheses as market facts.

## 6. Change control

1. Propose change as a `D-###`/`Q-###` entry with rationale and affected IDs.
2. Update the authoritative document first, then dependent documents in the same change set.
3. Bump the version table at the bottom of each affected file.
4. Never mutate a released Checklist Snapshot or generated Handover Package; create a new version.

## 7. Document version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial complete specification set |
| 0.2 | 2026-10-31 | Full remediation of `TRADECLOSEOUT-AUDIT`: SMS/OTP, external approval, bulk import, requirement scoping, cross-project FKs, permission scoping, PDF escaping, session/active-org binding, e-invoice/TDS, warranty/DLP workflows, statutory document family, testing coverage, roadmap re-baseline, `SOURCES-VERIFICATION.md` added |
