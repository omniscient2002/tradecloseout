# Decisions, Open Questions, Assumptions, Risks and Final Architecture Review

**Status:** Draft v0.2
**Change history:** v0.2 records remediation decisions D-033…D-042 and the resolution of Q-004/021/022/023/024/033/034 following `TRADECLOSEOUT-AUDIT`.
**Rule:** This file overrides other documents on points of decision. Unresolved items must not be silently implemented.

---

## 1. Decision log

| ID | Decision | Status | Rationale | Affects |
|---|---|---|---|---|
| D-001 | Modular monolith, single deployable API + workers | Confirmed | Solo developer; avoids distributed complexity | `09` |
| D-002 | PostgreSQL + S3-compatible object storage | Confirmed | Relational integrity + cheap durable files | `08`, `09` |
| D-003 | Tenant isolation via `org_id` + app scoping + PostgreSQL RLS | Confirmed | Defence in depth; non-negotiable | `05`, `08`, `13` |
| D-004 | Direct-to-storage resumable uploads | Confirmed | Mobile networks, memory, scaling | `09`, `10` |
| D-005 | Transactional outbox for domain events | Confirmed | Avoid lost/duplicated side effects | `09` |
| D-006 | Next.js + NestJS + Drizzle + TypeScript | Proposed | Speed, shared types, SQL control | `09` |
| D-007 | Host primarily in India | Confirmed preference | Latency, customer expectation, contract comfort | `09`, `13`, `15` |
| D-008 | Razorpay for INR subscriptions | Proposed | UPI/cards, subscriptions, India | `02`, `10` |
| D-009 | Own OTP/magic-link auth, no passwords in MVP | Proposed | Cost, India phone workflows, fewer credentials | `05`, `13` |
| D-010 | HVAC-only for MVP | Confirmed | Focus; validate one trade deeply | `00`, `16` |
| D-011 | Project checklist is an immutable snapshot | Confirmed | Prevent silent changes; audit | `06`, `07` |
| D-012 | Requirements are project-level rows; snapshots preserve historical definitions | Confirmed | Stable evidence links across changes | `08` |
| D-013 | Documents have immutable versions; approvals attach to versions | Confirmed | Revision integrity | `06`, `08` |
| D-014 | Only an approved replacement supersedes the current approved version | Confirmed | Prevent gaps during re-review | `03`, `06` |
| D-015 | Single-stage review in MVP; multi-stage in V1 | Confirmed | Scope; schema supports stages | `03`, `16` |
| D-016 | Suppliers use scoped links without accounts | Confirmed | Adoption reality | `05`, `11` |
| D-017 | OTP required for review/acceptance guest actions; optional for upload links | Proposed | Security vs friction; see Q-004 | `05`, `13` |
| D-018 | No AI/OCR in MVP | Confirmed | Not essential; risk and cost | `16` |
| D-019 | No e-signature in MVP | Confirmed | Contractual acceptance can be recorded with evidence | `03`, `16` |
| D-020 | Default project/audit retention = closure + 8 years | Proposed | Disputes/tax practice; configurable | `08`, `13` |
| D-021 | Audit events are append-only and customer-immutable | Confirmed | Trust and dispute evidence | `08`, `13` |
| D-022 | 98-type HVAC catalogue (DT-001–DT-099); default template is a curated subset (~72 items) (RT-037) | Confirmed | Avoid overwhelming users; catalogue is reference | `04` |
| D-023 | WhatsApp deep links in MVP, Business API in V1 | Confirmed | Low cost, immediate utility | `10`, `16` |
| D-024 | Per-company subscription pricing | Proposed | Matches buyer; unlimited suppliers | `02`, `17` |
| D-025 | Indicative pricing ₹4,999 / ₹9,999 / ₹19,999 per month | Hypothesis | To be tested | `17` |
| D-026 | File limit 100 MB; package limit 1 GB | Confirmed | Practical ceiling; configurable | `03`, `08` |
| D-027 | Package output = merged PDF + ZIP + manifest | Confirmed | Meets most client expectations; portable | `03`, `08` |
| D-028 | No native apps in MVP; PWA first | Confirmed | Cost; test demand | `11`, `16` |
| D-029 | Fixed roles in MVP; custom roles later | Confirmed | Complexity; roles cover ICP | `05` |
| D-030 | English UI in MVP; Hindi in V1 | Confirmed | Time-to-market; translation-ready strings | `11`, `16` |
| D-031 | Main contractors cannot access a subcontractor tenant; guest grants only | Confirmed | Tenant isolation; trust | `05` |
| D-032 | Source of truth for API is OpenAPI 3.1 once coding starts | Proposed | Contract tests, generated client | `10` |
| D-033 | Session is an opaque hashed token with DB lookup — **not a JWT** | Confirmed | Enables ≤60 s revocation and org switching | `08`, `13`, `10` |
| D-034 | `sessions.active_org_id` is the only authoritative tenant; org switch is `POST /auth/switch-org` | Confirmed | Removes the path-vs-session contradiction (`AUD-014`) | `05`, `08`, `10` |
| D-035 | One evidence document per requirement in MVP | Confirmed | Avoids the unlabelled `evidence_count` model (`AUD-015`) | `03`, `08` |
| D-036 | External approval (stamped PDF / email / portal) is a first-class review method | Confirmed | Consultants do not approve in-app (`AUD-010`) | `03`, `06`, `08`, `11` |
| D-037 | HTML/attribute escaping is mandatory in all generated documents; PDF active content is stripped | Confirmed | Prevents injection into client deliverables (`AUD-006`) | `09`, `13`, `14` |
| D-038 | Requirement asset scoping uses **only** `requirements.scope_key`; `requirement_assets` removed | Confirmed | Resolves the two-model contradiction (`AUD-002`) | `08` |
| D-039 | Permission model is **positive-only** with narrowing scopes; no explicit deny list | Confirmed | Removes an unimplementable concept (`AUD-012`) | `05`, `08` |
| D-040 | MVP accepts PDF and image input only; DOCX/XLSX are stored but not converted | Confirmed | Removes Gotenberg/Office from the critical path | `09`, `16` |
| D-041 | Variation orders are L4 project overrides with provenance, not a multi-L3 resolver | Confirmed | Keeps the config resolver bounded (`AUD-011`) | `07`, `08` |
| D-042 | MVP estimate re-baselined to 40–50 developer-weeks (9–12 months) | Confirmed | Original 25–32 weeks excluded remediation scope (`AUD-A-33`) | `16` |

---

## 2. Open questions

Priority: **P0** blocks MVP build or launch; **P1** blocks V1 or first scale; **P2** later.

| ID | Question | Why it matters | Proposed default | Priority | Validation |
|---|---|---|---|---|---|
| Q-001 | Is the contractor the payer, or will main contractors pay? | GTM and packaging | Contractor pays | P0 | Interviews/pilots |
| Q-002 | Which documents actually gate final payment by segment? | Checklist accuracy | Use catalogue + contract config | P0 | 5 real projects |
| Q-003 | Does the default HVAC template cover ≥80% of real checklists? | Activation | Curated 72-item subset | P0 | 5 checklist teardowns |
| Q-004 | Should supplier upload links require OTP by default? | Security vs friction | **Resolved:** OTP on by default (`guest_grants.otp_required`); orgs may disable for low-sensitivity projects | **Resolved** | Pilot conversion to confirm |
| Q-005 | Will consultants accept in-app approvals as evidence? | Review value | Record decision + audit; PDF export | P0 | 5 consultant interviews |
| Q-006 | What price is acceptable? | Viability | ₹4,999–₹19,999/month | P0 | Price test/pilots |
| Q-007 | Which entity invoices customers, and how is GST applied? | Cannot bill without it | Indian entity, 18% SaaS | P0 | CA review |
| Q-008 | Do customers/contracts require India-only data residency? | Hosting/architecture | India region | P1 | Customer contracts |
| Q-009 | What are current DPDP Act rules, notices and timelines? | Privacy compliance | Implement baseline now | P0 | Counsel |
| Q-010 | What retention do contracts require? | Deletion policy | Closure + 8 years | P1 | Contract review |
| Q-011 | Is e-signature required for completion certificates? | V2 scope | No for MVP | P2 | Customer interviews |
| Q-012 | How much should clients see in a portal? | Scope/security | Approved documents + packages only | P1 | Pilots |
| Q-013 | Which WhatsApp provider and template costs? | Notifications | Meta Cloud API or Gupshup | P1 | Vendor quotes |
| Q-014 | Is a digitally recorded approval legally sufficient? | Dispute value | Evidence + audit, not legal advice | P1 | Counsel |
| Q-015 | Is multi-stage approval needed at launch? | Consultant workflows | V1 | P1 | Pilot demand |
| Q-016 | Are custom fields needed at launch? | Client-specific metadata | V1 | P1 | Pilot demand |
| Q-017 | What package format do consultants demand? | Acceptance | PDF + ZIP + index | P1 | 5 consultants |
| Q-018 | Do drawings need DWG preview or only PDF? | Scope | PDF only in MVP | P2 | Pilot |
| Q-019 | Does OCR/AI materially reduce effort? | Future investment | V2 experiment | P2 | Measured pilot |
| Q-020 | Will main contractors integrate or require Aconex exports? | Expansion | Export only | P2 | MC interviews |
| Q-021 | One primary asset per document or many-to-many? | Schema | **Resolved:** one primary (`document_assets.is_primary`) + secondary links | **Resolved** | — |
| Q-022 | Approvals on versions or documents? | Audit | **Resolved:** versions | **Resolved** | — |
| Q-023 | Store rendered package pages or source versions only? | Storage/regeneration | **Resolved:** source versions + generated PDF + `package_requirements` | **Resolved** | — |
| Q-024 | Is a hash chain worth the write cost from day one? | Tamper evidence | **Resolved:** yes, computed asynchronously (`08` §5.6) | **Resolved** | Load test to confirm cost |
| Q-025 | Do we need a materialised satisfaction table? | Query performance | Derive first; cache later | P2 | Load test |
| Q-026 | How long do backups retain deleted data? | Privacy claims | 35 days | P1 | Counsel |
| Q-027 | Is after-hours support promised? | SLA | Best effort in MVP | P1 | Pilot contracts |
| Q-028 | Would per-project pricing convert better? | Packaging | Test alongside subscription | P1 | Price test |
| Q-029 | When is Hindi necessary? | Adoption | V1 | P1 | Site user tests |
| Q-030 | What are safe customer-config limits? | Complexity | See `07` §5.1 | P2 | Usage data |
| Q-031 | Which SMS provider and DLT sender ID? | Authentication | MSG91 / 2factor / Plivo / Twilio India | **P0** | Vendor quote + DLT registration |
| Q-032 | Is e-invoicing applicable at expected turnover, and what is the SAC code? | Indian invoicing | Confirm with a CA | **P0** | CA opinion |
| Q-033 | Is bulk document import MVP or a paid assisted service? | Scope | **Resolved:** MVP (`FR-DOC-031`) | **Resolved** | — |
| Q-034 | PDF-only vs Office conversion in MVP? | Scope | **Resolved:** PDF/image only (`D-040`) | **Resolved** | — |
| Q-035 | Should `document_search` partition by org or date? | Schema | By org at V1 | P2 | Load test |

---

## 3. Assumptions

| ID | Assumption | Impact if wrong | Validation |
|---|---|---|---|
| A-001 | HVAC subcontractors are the initial payer | GTM change | Interviews |
| A-002 | A configurable checklist covers most projects | Heavy onboarding/custom code | 5 teardowns |
| A-003 | Suppliers can use a browser link on a phone | Collection stays manual | Pilot metric |
| A-004 | Contractors will capture documents during the project | Value delayed | Usage cohort |
| A-005 | English UI is acceptable initially | Slower site adoption | Usability test |
| A-006 | India hosting is sufficient for data concerns | Architecture change | Customer contracts |
| A-007 | Consultants will review via link | Review feature underused | Pilot |
| A-008 | Clients accept PDF/ZIP packages | Rework | Consultant interviews |
| A-009 | ₹5,000+/month is affordable | No revenue | Price test |
| A-010 | 8-year retention is acceptable | Storage cost/policy | Contract review |
| A-011 | A solo developer can ship MVP in ~6–8 months | Funding/runway | Progress reviews |
| A-012 | Razorpay onboarding will be approved | Billing delay | Apply early |
| A-013 | Audit trail reduces disputes | Weak value prop | Pilot interviews |
| A-014 | PDF is the dominant handover format | Conversion work | Document sample audit |
| A-015 | Contractors will export data only occasionally | Portability claims | Support data |

---

## 4. Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| RK-001 | Requirements too variable for templates | High | High | Config engine, contract profiles, assisted onboarding | Product |
| RK-002 | Contractors won't pay enough | Medium | High | Paid pilots, price tests, narrow ICP | Founder |
| RK-003 | Suppliers don't participate | Medium | High | No-login links, WhatsApp, procurement escalation | Product |
| RK-004 | Consultants reject digital approvals | Medium | Medium | PDF evidence, export, audit; don't force portal | Product |
| RK-005 | PDF/package pipeline unreliable | Medium | High | Early spike, limits, retries, monitoring | Eng |
| RK-006 | Cross-tenant leak | Low | Existential | RLS, tests, pen test, least privilege | Eng |
| RK-007 | Data loss | Low | Existential | Managed backups, restore drills | Eng |
| RK-008 | Legal/tax non-compliance | Medium | High | CA/counsel before billing | Founder |
| RK-009 | Support load exceeds margin | Medium | High | Self-serve, templates, KB, measure | Founder |
| RK-010 | Payment provider onboarding delay | Medium | Medium | Apply early; manual invoicing fallback | Founder |
| RK-011 | WhatsApp policy/cost change | Medium | Medium | Email/in-app fallback, provider abstraction | Eng |
| RK-012 | Solo-founder bandwidth | High | High | Ruthless scope, managed services, phased plan | Founder |
| RK-013 | Checklist content errors create liability | Medium | High | Mark as template, user confirms, disclaimers, no compliance claims | Product/Legal |
| RK-014 | Free-tier abuse / storage cost | Low | Medium | Limits, quotas, verification | Eng |
| RK-015 | Main contractor mandates Aconex | High | Medium | Position as internal prep + export | GTM |
| RK-016 | Contractors will not pay enough to cover support | Medium | High | Self-serve onboarding, templates, paid pilot | Founder |
| RK-017 | Requirements vary too much for the config engine | High | High | Client profiles, curated packs, assisted onboarding | Product |
| RK-018 | Main contractors mandate a specific platform | High | Medium | Internal preparation + export to any format | GTM |
| RK-019 | Payment aggregator onboarding rejected | Medium | Medium | Apply early; alternative PA | Founder |
| RK-020 | Legal/tax error | Medium | High | CA/counsel review before launch | Founder |
| RK-021 | Data breach destroys trust | Low | Existential | Security architecture, tests, incident plan | Eng |
| RK-022 | WhatsApp policy/cost changes | Medium | Medium | Email fallback, provider abstraction | Eng |
| RK-023 | Founder bandwidth | High | High | Ruthless MVP scope, managed services | Founder |

---

## 5. Contradictions found and resolved

| ID | Contradiction | Resolution |
|---|---|---|
| C-01 | Project could enter `HANDOVER` only with a package, but the workflow starts handover before generating the package | Guard changed to explicit handover intent; package follows (`06` §3.1, WF-15) |
| C-02 | "Only one CURRENT version" conflicted with keeping an approved version while a revision is under review | Split into `latest_version_id` and `current_approved_version_id`; only approval supersedes (`03` FR-DOC-014, `08` §5.3) |
| C-03 | Requirements were described as per-snapshot but also needed stable identity across changes | Requirements are project-level with `current_snapshot_id`; snapshot payload preserves history (`06`, `07`, `08` §5.4) |
| C-04 | Catalogue count consistency | Catalogue expanded to 98 types (DT-001–DT-099) including statutory and CPWD/PSU closeout certificates (`04`, RT-031, RT-037) |
| C-05 | Pricing range differed between vision and validation plan | Aligned to ₹5,000–₹20,000 hypothesis (`00`, `01`, `17`) |
| C-06 | Package builder allowed drafts in one place and blocked them in another | Resolved: drafts are excluded by default; inclusion requires explicit override with reason (see §6) |
| C-07 | Review uniqueness on `(version, stage, reviewer_user_id)` fails for Party reviewers with null user | Implementation must use two partial unique indexes (user and party) or a synthetic reviewer key |
| C-08 | "Statutory" labels in catalogue could be read as legal advice | Catalogue uses `S` only for copies of approvals; disclaimer added; legal review required |
| C-09 | Suspended org/project blocks writes but billing may still accrue | Intentional: suspension is access control, not a billing waiver; documented in `02`/`12` |
| C-10 | `client_profiles` reusable vs project-specific | Reusable profile referenced by project; project overrides remain allowed (`07` §14) |
| C-11 | API paths carried `orgId` while the rule said tenant is never from a path | **Closed:** `session.active_org_id` authoritative; mismatched path returns `404`; `POST /auth/switch-org` added (`D-034`) |
| C-12 | `requirements.scope_key` and `requirement_assets` modelled scoping two ways | **Closed:** `scope_key` only; `requirement_assets` removed (`D-038`) |
| C-13 | One CURRENT version vs keeping an approved version during re-review | **Closed:** `latest_version_id` + `current_approved_version_id` (`D-014`) |
| C-14 | Requirement rows mutable while snapshots were called immutable | **Closed:** `requirement_revisions` + `package_requirements` (`AUD-008`) |
| C-15 | Explicit deny referenced but never modelled | **Closed:** positive-only model (`D-039`) |

### 5.1 Remaining known tensions (not contradictions)

1. **Guest friction vs security.** OTP improves identity assurance but reduces supplier conversion. Decision deferred to Q-004.
2. **Customisation depth vs usability.** The engine supports rules, but exposing them to small contractors would overwhelm. MVP UI exposes only a subset.
3. **Retention vs storage cost.** 8 years is generous; measure storage cost per org and revisit.
4. **"Statutory" vs contractual.** Sales must not imply legal compliance. Copy review required.

---

## 6. Final architecture review

### 6.1 Cross-checks performed

| Check | Result | Notes |
|---|---|---|
| Every document in `04` maps to requirements/workflow | Pass with caveat | Catalogue is reference; template is a subset. Some types are optional/conditional and have no MVP UI beyond generic upload |
| Every workflow maps to states in `06` | Pass | All 26 workflows (WF-01 through WF-26) reference defined states (RT-038) |
| Every state maps to DB entities and allowed transitions | Pass | `requirements`, `document_versions`, `handover_packages`, `submissions` aligned |
| Every operation has a permission | Pass | Permission catalogue + matrix; a few admin jobs are system-only |
| Every API has auth, permission, errors | Pass | Endpoint catalogue; per-endpoint detail to be completed in OpenAPI |
| Customisation works without code | Pass | Documented limits; MVP exposes a subset |
| Edge cases have defined outcomes | Pass | 70+ scenarios in `12`; unlisted → fail closed |
| Tenant isolation at DB and app layers | Pass by design | Must be proven by tests before launch |
| MVP is buildable without future platform | Pass | Scope explicitly cut; dependencies ordered |
| Decisions needing customer validation are identified | Pass | Q-001–Q-030, H1–H8 |

### 6.2 Traceability summary

| Layer | Artefact | IDs |
|---|---|---|
| Business goals | `00`, `02` | BO-*, BR-* |
| Requirements | `03` | FR-*, NFR-* |
| Permissions | `05` | R-*, permission names |
| Workflows/states | `06` | WF-*, state names |
| Configuration | `07` | config levels/keys |
| Data | `08` | E-* |
| API | `10` | API-* |
| UI | `11` | SCR-* |
| Failures | `12` | D-*, P-*, U-*, T-*, B-*, S-* |
| Security | `13` | controls |
| Tests | `14` | TC-* |
| Delivery | `16` | M0–M10 |
| Commercial | `17` | H1–H8 |

### 6.3 Readiness by area

| Area | Readiness | Blockers |
|---|---|---|
| Auth/tenancy/RLS | Ready to build | None; pen test later |
| Org/members/parties | Ready | None |
| Projects/contracts | Ready | None |
| Checklist/config | **Conditional** | Q-003 (template validity), Q-002 (payment-gating docs) |
| Assets | Ready | Q-021 (document-asset cardinality) |
| Documents/upload | Ready | Technical spikes (multipart, AV, preview) |
| Reviews | Ready | Q-005 (consultant acceptance) |
| Packages | **Conditional** | Q-017 (format), spike on merge/performance |
| Notifications | Ready | Q-004, Q-013 |
| Billing | **Not ready for launch** | Q-007 (entity/GST), Razorpay onboarding, CA review |
| Legal/privacy | **Not ready for launch** | Q-009, Q-014, counsel/DPA |
| Operations | Ready with gaps | Backup drill, status page, on-call phone |

### 6.4 Critical risks to the design

1. **Checklist validity.** If the default template does not match real consultant checklists, onboarding becomes consulting. This is the single biggest product risk.
2. **Supplier behaviour.** If suppliers do not upload, the product shifts from collection to manual filing, reducing value.
3. **Package generation reliability.** A failed handover package at the payment milestone is a trust-destroying event. It must be tested under load and failure.
4. **Tenant isolation.** Any cross-tenant leak is existential. RLS + tests + pen test are mandatory.
5. **Legal/tax.** Billing and privacy mistakes can block launch or create liability.

### 6.5 Missing information

- Real consultant checklists (5+ projects, private/government).
- Actual acceptance/rejection statistics from contractors.
- Exact contractual documents gating retention for each segment.
- Consultant willingness to use a link-based review.
- Supplier smartphone/browser capabilities.
- GST/SAC treatment for the specific service and entity.
- DPDP rules and breach-notification specifics at launch time.
- Willingness to pay by city and size.
- Main-contractor platform mandates in target accounts.

### 6.6 What is explicitly not finalised

- Pricing and packaging.
- Whether the buyer is the contractor or the main contractor.
- The depth of post-activation checklist changes.
- Supplier identity verification policy.
- Client portal scope.
- AI/OCR roadmap.
- Multi-trade data model extensions (the config model is designed to allow them, but they are not validated).
- E-signature and accounting integrations.

### 6.7 Verdict

**Conditionally implementation-ready (v0.2, post-remediation).** The blocking findings from `TRADECLOSEOUT-AUDIT` — AUD-001, AUD-002, AUD-004, AUD-005, AUD-006, AUD-008, AUD-009, AUD-010, AUD-012, AUD-013, AUD-014, AUD-015 — are now addressed in the specification. Remaining work is **external validation**, not specification:

- **Start now:** M0–M2 (foundations, tenancy, org/members/parties, projects/contracts), plus technical spikes for upload, PDF merge, RLS and the SMS provider integration.
- **Before M3:** validate the HVAC checklist against 5 real projects (Q-002, Q-003, `AUD-003`). This is now a **gate** in `16` §3.1.
- **Before M7:** validate package format with 3 consultants and run the 500-page performance test.
- **Before first paid invoice:** CA/counsel sign-off (Q-007, Q-009, Q-014, Q-032), Razorpay live approval, pen test highs resolved, backup restore proven, incident tabletop completed.
- **Before scaling:** prove supplier participation and support load in 3 paid pilots.

The architecture is deliberately simple: one database, one API, one worker pool, object storage, configuration-driven domain. It can support the MVP and early V1 without re-platforming. Complexity has been pushed into configuration and state discipline, not infrastructure.

### 6.8 Go/no-go for coding

| Gate | Status |
|---|---|
| Domain model coherent | Yes |
| Permissions complete | Yes |
| State machines complete | Yes |
| Data model coherent | Yes (fix C-07 in migration) |
| Security model defined | Yes |
| Test strategy defined | Yes |
| MVP scope bounded | Yes |
| Commercial validation pending | Yes (expected) |
| Legal/tax pending | Yes (expected) |

**Proceed to M0–M2 and spikes. Do not build the full platform. Do not claim compliance or market validation.**

---

## 7. Change protocol

1. Add a `D-###` for a decision or `Q-###` for an open question.
1b. If the change touches a legal, tax or competitor claim, update `SOURCES-VERIFICATION.md` in the same change set.
2. Update all affected documents in one change set.
3. If a decision changes a state, permission, entity or API, update `03`, `05`, `06`, `08`, `10`, `14` together.
4. Never change a released snapshot or generated package; create a new version.
5. Record the date and rationale. "Because it was easier" is not a rationale.

## 8. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial decision log and architecture review |
| 0.2 | 2026-10-31 | Remediation decisions D-033…D-042; Q-004/021/022/023/024/033/034 resolved; C-11…C-15 closed; readiness revised |
