# Decisions, assumptions and unknowns

## Final design decisions

| ID | Decision | Rationale / rejected alternative |
|---|---|---|
| D01 | Contractor-owned requirement/evidence/acceptance readiness is the core | Generic ERP/CDE scope dilutes adoption and evidence correctness |
| D02 | Modular monolith, shared PostgreSQL and separate worker | Current repository fits atomic rules; microservices add premature distributed transactions |
| D03 | Original file, review, satisfaction, artifact, submission and money states independent | Prevents false contractual completion from file/status changes |
| D04 | Exact-version, exact-requirement-revision qualification | Document-wide current pointer cannot prove scoped satisfaction |
| D05 | One application command and server policy per behaviour | Legacy aliases and helper implementations must not provide weaker authority paths |
| D06 | Actor is member/guest/system principal, never just grant creator user | External provenance and resource permissions require explicit identity |
| D07 | Supplier OTP default; bearer-only links deferred | Current low-friction PIN path cannot prove identity and scope; future intake-only bearer mode needs a separate reviewed design |
| D08 | Immutable provider object identity plus observed verification | Signed URL or client hash alone does not prove stored original bytes |
| D09 | DB receipts/outbox authoritative, Redis transport recoverable | At-least-once work needs idempotent effects and crash recovery |
| D10 | Current approved evidence may remain while newer draft is pending | Avoid new upload accidentally invalidating existing accepted evidence; conditions/rules govern withdrawal |
| D11 | Final package READY requires verified stored artifact; draft exception separate | Metadata/index generation cannot be represented as complete handover |
| D12 | Admin role does not imply external technical/acceptance authority | Tenant administration cannot substitute consultant/client decision |
| D13 | Commercial prerequisite tracking, external accounting references | No full accounting/GST/payment platform in core product |
| D14 | AI proposes only, human verifies; deterministic rules own trust | No autonomous approvals, certification, waivers, acceptance or monetary edits |
| D15 | SQL migration history immutable and checksum-checked | Current renamed ledger files require environment inventory, not guessed renumbering |
| D16 | Inclusive local expiry date, UTC event instants and recorded/occurred separation | Date-only certificates should not expire at UTC midnight accidentally |
| D17 | Asset identity effective-dated, replacement requalification explicit | Reused tag is not proof of same installed equipment |
| D18 | No unsupported digital-signature certification in MVP | Metadata registration/hash equality does not validate PKCS7, trust chain or legal effect |
| D19 | Export portability part of product trust | Recurring value should come from workflow/history, not withholding contractor evidence |
| D20 | Real pilot gated by integrity, operations and usability | Passing selected compiler/mock suites is insufficient |

These are proposed architecture/product decisions for implementation handoff, not claims that a customer or external authority has approved a contract-specific rule.

## Unresolved items and validation owner

| ID | Unknown / assumption | Owner / method | Blocking scope | Safe interim treatment |
|---|---|---|---|---|
| U01 | Which migration filenames/checksums actually deployed? | Engineering/ops inspect every environment ledger | T01/customer release | Do not rename or rewrite applied files |
| U02 | Actual runtime DB role and full RLS policies | Security/engineering inspect roles and run disposable boundary suite | Pilot | No isolation claim from superuser tests |
| U03 | Real object provider/buckets/versioning/workload identity | Ops inspect deployed configuration and test multipart | Upload integrity | Provider SDK abstraction; no simulated provider |
| U04 | Real identity delivery provider/templates/account approval | Owner/ops sandbox and production onboarding | Login/guest pilot | No sent/delivered claim without receipt |
| U05 | Customer reviewer/waiver/acceptance authority | PM/DC plus contract/source clauses | Each project baseline | Explicit assignments, unknown authority blocks |
| U06 | Self-approval in tiny contractor teams | Customer/contract reviewer | Review policy | Default prohibit; independent authority or explicit narrow exception design |
| U07 | Conditional approval codes and downstream effects | Consultant/PMC with returned submittals | T07/T08 templates | Preserve original response and conditions; no auto-green |
| U08 | System/location scope and sectional handover patterns | Observe contractor and FM | T16–T18 full scope | Configurable hierarchy, no mandatory linear stages |
| U09 | DLP/warranty/retention triggers, rates, caps and release conditions | Customer commercial lead, source contract; legal review where needed | T18/T19 | Anchor pending; no universal percentage/duration |
| U10 | Native commissioning procedure/units/tolerances | QC/OEM/consultant controlled template review | T17 | Uploaded reports as evidence; no invented acceptance thresholds |
| U11 | Offline shared-device usage and permitted local retention | Site team/security usability interviews | T12 | Actor partition, explicit draft disposition; no encryption guarantee |
| U12 | Pilot recovery commitments and actual restore capability | Ops plus customer agreement | T14 | Targets proposed, no SLA until measured |
| U13 | Applicable privacy/incident legal obligations and commencement | Counsel/ops official sources, current launch date | Production policy | Source-backed controls; no blanket compliance claim |
| U14 | Will contractors pay and maintain a second system? | Paid pilot and renewal experiment | Product expansion | Coexist/export and minimise duplicate entry |
| U15 | Competitor India pricing, entitlements and real adoption burden | Direct quotes and observed customer workflow | Market claims | No invented pricing/affordability/weakness statements |
| U16 | Original/derivative photo policy and signed PDF preservation | Customer evidence policy plus security | Evidence transformations | Preserve original bytes; derivative labelled |
| U17 | Which historical approvals can prove exact version/scope? | DC migration review and source evidence | T08 legacy qualification | NEEDS_REASSESSMENT, never guessed approval |
| U18 | Dependency vulnerabilities in current resolved lockfile | Engineering current advisory scan | Production | No vulnerability-count or supported-version claim |
| U19 | Deployed IAM/TLS/backups/monitoring topology | Ops environment inspection | Production | Terraform intent not proof |
| U20 | AI processing region, retention, cost and quality | Customer/data owner and model evaluation | T20 | Disabled for customer documents until terms/evaluation pass |

## Inspection limits and unsupported claims removed

Not verified: every historical audit ID individually, live exploits, every line of every file, binary fixtures/screenshots, installed dependency source, secret/git-history scan, running deployment, real database/schema contents, lockfile advisory status, production provider delivery, real object/antivirus pipeline, load or restore. Repository-wide inventory and static scans cover first-party executable areas; core paths were traced directly. Historical issues selected for revalidation are explicitly listed in technical audit. Do not read the word complete as certification of exhaustive security coverage.

Research used official documentation and publicly indexed specifications. CPWD PDF direct retrieval failed; the narrow section observation relies on official-domain indexed excerpts. A large public tender PDF could not be retrieved, so no specific retention term is inferred from it. No paid standards text, customer interviews, vendor quote or independent competitor benchmark was obtained. Segment patterns, value scores, price packaging, AI costs and calendar milestones are hypotheses/planning estimates.

## Completion evidence

Only the twelve new Markdown reports were intentionally created. Starting working-tree changes were recorded and preserved. Final checksum/Git comparison and report-reference checks are appended after verification below. TypeScript checks API/web/worker passed; selected four Jest suites passed 45 tests. Source-based defects remain despite those successes. No migrations, seeds, dependency installs, deployments or destructive operations were executed.

## Final verification record — 2026-11-05

- All twelve requested reports exist under their exact requested names; exclusive-create mode prevented overwriting old reports.
- All 276 baseline file fingerprints remain identical; no baseline file was removed. The tracked binary Git diff is identical to the starting diff. All initial Git status entries remain; exactly twelve new report entries were added.
- All 32 finding file/line references resolve within the unchanged current source. Local report/file-link targets resolve; Markdown code fences are balanced. Twenty task IDs and 32 opportunity rows are present.
- API/web/worker no-emit TypeScript checks passed. Four selected Jest suites passed, 45 tests total. Live database/storage/scanner/browser/provider/recovery and advisory checks remain unexecuted as described above.
- Report consistency reviewed: modular monolith; one authority pipeline; exact-version qualification; immutable real artifacts; OTP-default supplier access; readiness distinct from acceptance/payment; AI proposal-only. P2 operations remain mandatory pilot gates.
- No application source, schema, migration, test, configuration or pre-existing report was modified. No dependencies installed, migrations/seeds executed, application deployed or destructive operation performed. Temporary baseline/test logs reside outside the repository under /tmp.
