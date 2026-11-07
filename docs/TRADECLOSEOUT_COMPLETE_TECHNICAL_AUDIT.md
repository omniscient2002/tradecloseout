# Complete technical audit

## Scope and evidence discipline

Audit date 2026-11-05; baseline is the current dirty working tree. Starting Git status and SHA-256 fingerprints were captured outside the repository. No AGENTS.md was found within this workspace by repository search. User constraints govern: documentation only, no source changes, dependency installation, migrations, seeds or destructive operations.

Every first-party executable/source area was inventoried, method/route and suspicious-behaviour patterns were scanned, and core security, upload, review, requirement, handover and worker paths were inspected directly. Coverage is not a claim that every line, binary fixture, dependency or deployment was exhaustively verified. Existing documentation was surveyed and selected prior findings revalidated; historical reports are hypotheses, not evidence of present runtime defects. The appendix inventories repository files; deep runtime proof remains limited as described below.

## Repository architecture and ownership

| Area | Current responsibility | Assessment |
|---|---|---|
| apps/web | Next App Router, contractor/guest/login, local drafts, upload queue, view/modals | Multiple upload/status implementations; large project page; interactions lack shared contract discipline |
| apps/api | Nest modules for identity, organisations, parties, projects, configuration, checklists, assets, documents, reviews, handover, billing, notifications, signatures, health | Suitable modular-monolith foundation; service rules and transaction ownership diverge |
| apps/worker | BullMQ processors, outbox polling, recurring scheduler, converters | Real process helpers exist, but active orchestration does not complete real storage workflows |
| packages/db | Drizzle schema, SQL migrations, tenant transactions, catalogue rules, portfolio seeds | Two tenant-setting names, ledger drift risk, new single-ID references weaken earlier composite relationships |
| packages/shared | Permission maps, status enums, validators, env definitions | Two policy evaluators; runtime guard uses hasPermission rather than richer project-state evaluator |
| packages/pdf-engine | Front matter, package merging, sanitisation | Multiple compilers and placeholder behaviour need one supported artifact path |
| infra and .github | Local DB/Redis/MinIO/ClamAV; partial AWS; CI | Configuration intent does not prove a deployed secure environment |
| scripts and materializers | Runbooks, seeding, simulations, traceability and repo materialization | Some mutate DB/files; inspected but not executed. Materializers may recreate obsolete implementations |
| docs/root reports/fixtures/images | Extensive product specifications, older audits, narrative examples, consultant checklist | Useful domain context; not authoritative proof of delivered capability |

## End-to-end traces

1. **Authentication:** login calls api-client, identity creates Redis challenge and session, cookie is checked by SessionCsrfGuard, PermissionGuard checks capability. Token hashing and CSRF exist. Member challenge success is consumed through separate read/delete operations (TC-F032), and guest failed-attempt updates roll back when the transaction wrapper catches the thrown authentication error (TC-F031). Provider delivery is stubbed; OTP consume is separate read/delete; logout is broken. Guest sessions use grant creator as session user, obscuring external identity. Direct session exchange bypasses challenge proof (TC-F001–005,017).
2. **Evidence:** upload UI/offline queue creates intent, DocumentsService stores pending object/version and document-level links, presigner returns URLs, completion writes PROCESSING and scan outbox event. Worker expects local paths absent from event; multipart is synthetic; worker persistence lacks tenant transaction. Download-url signs S3 URL while stream reads simulation/local paths. No coherent provider-backed immutable lifecycle is established (TC-F009–013,019–021).
3. **Review:** controller offers review-ID, version-ID, project review, external approval, override and bulk routes. ReviewsService is active; executeReviewDecision and V021WorkflowsService contain overlapping decisions. Active main approval checks READY, latest pointer, self-approval and companions, but omitted reviewer-role checks and isOverride bypass remain. Stamp-back writes approvals independently. Locks do not prove all commands share a global order; review record is read before version lock and not locked/rechecked afterward, a concurrency concern requiring real DB tests (TC-F006–008).
4. **Requirement:** checklist snapshot/import produces requirements, parties assign owners, documents link many requirements, decision writes all links approved. Handover infers satisfaction using revision text through the document current-approved pointer. Evidence sets, stage decisions and exact requirement-version qualification are absent from this chain (TC-F014–015).
5. **Handover/commercial:** readiness runs in a separate transaction before snapshot; compiler request stores snapshots and queues; fallback worker marks READY without bytes. Submission may reference latest package without checking finished artifact; recipient aggregation has dedicated functions and must be tested under concurrent final decisions. RA helper inserts READY without package items. Archive emits a manifest yet declares completion (TC-F011,024–025).

## Security and data integrity

Tenant RLS is valuable but does not implement project membership or guest visibility. A query filtered by org_id is insufficient for scoped actors. Session guard project-member lookup uses raw pool queries outside tenant context and swallows failure; exact failure depends on live policies/role. Global queries against RLS tables also exist in idempotency and signature lookup. Test under actual NOBYPASSRLS credentials before diagnosing every empty result as missing data.

VisibilityProjectionInterceptor recursively denies a short field list, recognises only a subset of guest roles and reads guestScope from auth, while guard populates it on user. Replace response denylisting with explicit role/resource projection. Do not call this a confirmed financial exfiltration without proving a reachable payload; it is a demonstrated coverage weakness to include in T03 threat tests.

Storage presigning hand-rolls SigV4 and uses local credentials if absent; deployment should use workload credentials and the maintained SDK. PUT URL existence does not establish object immutability, uploaded size, checksum or provider version ID. Completion can be replayed onto nonpending states and late worker results can overwrite state; define allowed transitions and attempt fencing. Stream path does not compare bytes to persisted digest and uses basename fallback; cross-object substitution is a risk even though missing originals now throw.

New migrations 0006/0007 add RLS but several foreign keys omit tenant/project columns. Original migration patterns include stronger composite relationships. Two context keys are now set in primary wrappers, but independent raw queries do not establish either. Canonicalize on app.current_org through a compatibility period; audit every policy before removing the alias.

## Performance, maintainability and gaps

Document/review lists have no bounded cursor pagination; wide selects and one-to-many joins increase payloads and duplicates. Project page is 1,947 lines and dashboard 1,039 at audit baseline; split by domain screen after shared API contracts are stable. MAX+1 allocation, readiness joins, expensive PDF parsing, nonrenewed schedule locks and minute-level periodic cycles require representative load tests. No measured latency or capacity claim is justified.

Retain useful catalogue applicability and asset identity revision concepts, but do not infer procurement completeness from three new tables. Inspections, instrument validity at test time, readings/units/tolerances, retests, system boundaries, acceptance criteria, BOQ scope-change provenance and retention tranches need explicit design (T15–T19). Keep accounting services outside the core product path. Notification creation does not prove external delivery. Health endpoint is not proof of object store/scanner/worker readiness.

## Previous audit revalidation

| Previous concern | Current evidence | Disposition |
|---|---|---|
| Missing bulk import endpoint | DocumentsController now exposes intent/dry-run/commit | Endpoint absence obsolete; real archive extraction/import and error recovery still need integration proof |
| Missing organisation switch | IdentityController includes switch-org | Endpoint absence obsolete; membership lookup under RLS remains unverified |
| Completion immediately READY | DocumentsService now writes PROCESSING | Fixed locally; storage retrieval/worker integration remains TC-F009–010 |
| Scanner fails open | File processor normally fails closed | Improved; unsafe flag/environment restriction remains TC-F028 |
| Missing original fabricated as certified page | Stream now throws EVIDENCE_OBJECT_NOT_FOUND | Fixed locally; local simulation resolution remains unsuitable as production storage |
| External approval forces READY | Main service requires READY and does not mutate file status | Fixed on this route; stamp-back still bypasses it (TC-F006) |
| Outbox redis call not awaited | Current queue.add calls are awaited and use stable job IDs | Improved; tenant discovery and unknown-event handling remain incomplete |
| No migration ledger | Ledger now exists | Old absence obsolete; checksum and concurrent-runner flaws remain TC-F022 |
| Single timestamp / no asset identity history | 0006 and services add these structures | Present; end-to-end validation and exact-version satisfaction are still required |
| Multi-recipient decisions absent | Handover/workflows services contain recipient aggregation | Do not repeat blanket absence; concurrent recipient result and exception handling remain release tests |
| Claimed perfect scores or production simulation | Comments/tests use such labels | Not evidence of production safety; 45 mock/policy tests cannot validate cross-process storage |
| Historical document-only DDL/traceability/price/legal claims | Older reports contain many proposals | Not re-proven current application defects; retain as historical/unverified until specifically checked |

## Executed validation

API, web and worker compiler checks completed without diagnostics using no emit and incremental disabled. Selected four Jest suites: phase0-evidence-integrity-remediation, discovery-lifecycle-foundations, perfect-10-remediation and rbac-matrix: 4 passed, 45 tests passed, 9.291 seconds. Initial root-level Jest executable was absent; rerun used existing apps/api executable. No installation occurred.

Database integration tests and simulations were not run because their setup seeds/mutates the configured database. No isolated disposable service environment was created. No live browser, S3/MinIO, ClamAV, provider delivery, RLS, migration upgrade, concurrency, backup, legal-compliance or production-topology proof is claimed. Lockfile advisories were not refreshed. Findings are canonical in the finding register; acceptance and future tests live in task specifications.

## Repository coverage inventory

Inventory excludes .git, installed dependencies, build/cache output and local secret files. Listed means discovered and classified; core traces above identify deeper inspection. Binary fixtures and screenshots were not parsed/visually validated.

| Path | Size in bytes | Category |
|---|---:|---|
| .env.example | 229 | source/configuration/tooling |
| .github/workflows/deploy.yml | 1854 | source/configuration/tooling |
| .gitignore | 107 | source/configuration/tooling |
| 00-PRODUCT-VISION.md | 14757 | documentation |
| 01-MARKET-AND-DOMAIN-RESEARCH.md | 25305 | documentation |
| 02-BUSINESS-REQUIREMENTS.md | 13119 | documentation |
| 03-PRODUCT-REQUIREMENTS.md | 44259 | documentation |
| 04-DOCUMENT-CATALOGUE.md | 43435 | documentation |
| 05-ACTORS-AND-PERMISSIONS.md | 23642 | documentation |
| 06-WORKFLOWS-AND-STATE-MACHINES.md | 47044 | documentation |
| 07-CUSTOMISATION-ENGINE.md | 20532 | documentation |
| 08-DATA-MODEL-AND-ERD.md | 42337 | documentation |
| 09-SYSTEM-ARCHITECTURE.md | 18563 | documentation |
| 10-API-AND-INTEGRATIONS.md | 27817 | documentation |
| 11-UI-UX-SPECIFICATION.md | 22300 | documentation |
| 12-EDGE-CASES-AND-FAILURE-MODES.md | 23256 | documentation |
| 13-SECURITY-PRIVACY-AND-COMPLIANCE.md | 26011 | documentation |
| 14-TESTING-AND-ACCEPTANCE.md | 22604 | documentation |
| 15-DEPLOYMENT-AND-OPERATIONS.md | 14220 | documentation |
| 16-MVP-AND-IMPLEMENTATION-ROADMAP.md | 14378 | documentation |
| 17-BUSINESS-VALIDATION-PLAN.md | 13840 | documentation |
| AGENT-FULL-PRODUCTION-FLOW-DIRECTIVE.md | 8626 | documentation |
| DECISIONS-AND-OPEN-QUESTIONS.md | 24843 | documentation |
| LIVE-PRODUCTION-SIMULATION.md | 8173 | documentation |
| PRODUCTION-EXECUTION-PLAYBOOK.md | 56246 | documentation |
| README.md | 11112 | documentation |
| SOURCES-VERIFICATION.md | 9593 | documentation |
| THE-DECCAN-CLOSEOUT-STORY.md | 44480 | documentation |
| THE-HVAC-CEO-OPERATIONS-AND-WORKFLOW-GUIDE.md | 27428 | documentation |
| THE-MEP-CONTRACTOR-EXECUTIVE-STORIES.md | 26760 | documentation |
| TRADECLOSEOUT-AUDIT/00-EXECUTIVE-AUDIT.md | 11807 | documentation |
| TRADECLOSEOUT-AUDIT/01-CRITICAL-ISSUES.md | 42597 | documentation |
| TRADECLOSEOUT-AUDIT/02-DOMAIN-AND-BUSINESS-REVIEW.md | 7868 | documentation |
| TRADECLOSEOUT-AUDIT/03-PRODUCT-AND-WORKFLOW-REVIEW.md | 7622 | documentation |
| TRADECLOSEOUT-AUDIT/04-ARCHITECTURE-AND-DATABASE-REVIEW.md | 7334 | documentation |
| TRADECLOSEOUT-AUDIT/05-SECURITY-AND-EDGE-CASE-REVIEW.md | 5573 | documentation |
| TRADECLOSEOUT-AUDIT/06-REQUIREMENT-TRACEABILITY.md | 4219 | documentation |
| TRADECLOSEOUT-AUDIT/07-RECOMMENDED-CHANGES.md | 11323 | documentation |
| TRADECLOSEOUT-AUDIT/08-FINAL-READINESS-REPORT.md | 5819 | documentation |
| TRADECLOSEOUT-AUDIT/ISSUE-REGISTER.md | 25163 | documentation |
| TRADECLOSEOUT-AUDIT/README.md | 4557 | documentation |
| TRADECLOSEOUT-COMPLETE-STUDENT-AND-DOMAIN-MASTER-GUIDE.md | 26326 | documentation |
| TRADECLOSEOUT-MASTER-PROMPT.md | 648814 | documentation |
| TRADECLOSEOUT-MASTER-PROMPT.txt | 648814 | documentation |
| apps/api/.env | 229 | source/configuration/tooling |
| apps/api/jest.config.ts | 823 | source/configuration/tooling |
| apps/api/nest-cli.json | 154 | source/configuration/tooling |
| apps/api/package.json | 1379 | source/configuration/tooling |
| apps/api/scripts/run-live-simulation.ts | 43037 | source/configuration/tooling |
| apps/api/scripts/seed-portfolio.ts | 184 | source/configuration/tooling |
| apps/api/src/app.module.ts | 1812 | source/configuration/tooling |
| apps/api/src/common/decorators/idempotency.decorator.ts | 349 | source/configuration/tooling |
| apps/api/src/common/filters/problem-json.filter.ts | 4647 | source/configuration/tooling |
| apps/api/src/common/guards/permission.guard.ts | 2352 | source/configuration/tooling |
| apps/api/src/common/guards/session-csrf.guard.ts | 8160 | source/configuration/tooling |
| apps/api/src/common/interceptors/idempotency.interceptor.ts | 5250 | source/configuration/tooling |
| apps/api/src/common/interceptors/visibility-projection.interceptor.ts | 2712 | source/configuration/tooling |
| apps/api/src/database/database.module.ts | 606 | source/configuration/tooling |
| apps/api/src/database/tenant-db.service.ts | 3624 | source/configuration/tooling |
| apps/api/src/main.ts | 1057 | source/configuration/tooling |
| apps/api/src/modules/assets/assets.controller.ts | 3901 | source/configuration/tooling |
| apps/api/src/modules/assets/assets.module.ts | 298 | source/configuration/tooling |
| apps/api/src/modules/assets/assets.service.ts | 29526 | source/configuration/tooling |
| apps/api/src/modules/billing/billing.controller.ts | 6298 | source/configuration/tooling |
| apps/api/src/modules/billing/billing.module.ts | 680 | source/configuration/tooling |
| apps/api/src/modules/billing/billing.service.ts | 5775 | source/configuration/tooling |
| apps/api/src/modules/billing/gst-einvoice-tds.service.ts | 7956 | source/configuration/tooling |
| apps/api/src/modules/billing/warranty-and-billing.service.ts | 17202 | source/configuration/tooling |
| apps/api/src/modules/checklists/checklists.controller.ts | 3814 | source/configuration/tooling |
| apps/api/src/modules/checklists/checklists.module.ts | 330 | source/configuration/tooling |
| apps/api/src/modules/checklists/checklists.service.ts | 27792 | source/configuration/tooling |
| apps/api/src/modules/configuration/config-resolver.ts | 7480 | source/configuration/tooling |
| apps/api/src/modules/configuration/configuration.module.ts | 123 | source/configuration/tooling |
| apps/api/src/modules/documents/documents.controller.ts | 7091 | source/configuration/tooling |
| apps/api/src/modules/documents/documents.module.ts | 494 | source/configuration/tooling |
| apps/api/src/modules/documents/documents.service.ts | 41899 | source/configuration/tooling |
| apps/api/src/modules/documents/dto/upload-intent.dto.ts | 1929 | source/configuration/tooling |
| apps/api/src/modules/documents/s3-storage.service.ts | 5041 | source/configuration/tooling |
| apps/api/src/modules/handover/dto/handover-packages.dto.ts | 883 | source/configuration/tooling |
| apps/api/src/modules/handover/handover.controller.ts | 7687 | source/configuration/tooling |
| apps/api/src/modules/handover/handover.module.ts | 393 | source/configuration/tooling |
| apps/api/src/modules/handover/handover.service.ts | 33169 | source/configuration/tooling |
| apps/api/src/modules/health/health.controller.ts | 1198 | source/configuration/tooling |
| apps/api/src/modules/health/health.module.ts | 317 | source/configuration/tooling |
| apps/api/src/modules/identity/identity.controller.ts | 16306 | source/configuration/tooling |
| apps/api/src/modules/identity/identity.module.ts | 4134 | source/configuration/tooling |
| apps/api/src/modules/notifications/notifications.controller.ts | 1499 | source/configuration/tooling |
| apps/api/src/modules/notifications/notifications.module.ts | 417 | source/configuration/tooling |
| apps/api/src/modules/notifications/notifications.service.ts | 4345 | source/configuration/tooling |
| apps/api/src/modules/organisations/organisations.controller.ts | 3790 | source/configuration/tooling |
| apps/api/src/modules/organisations/organisations.module.ts | 433 | source/configuration/tooling |
| apps/api/src/modules/organisations/organisations.service.ts | 32779 | source/configuration/tooling |
| apps/api/src/modules/parties/parties.controller.ts | 6315 | source/configuration/tooling |
| apps/api/src/modules/parties/parties.module.ts | 545 | source/configuration/tooling |
| apps/api/src/modules/parties/parties.service.ts | 21809 | source/configuration/tooling |
| apps/api/src/modules/parties/supplier-guest.service.ts | 8766 | source/configuration/tooling |
| apps/api/src/modules/projects/dto/close-project.dto.ts | 147 | source/configuration/tooling |
| apps/api/src/modules/projects/projects.controller.ts | 5396 | source/configuration/tooling |
| apps/api/src/modules/projects/projects.module.ts | 314 | source/configuration/tooling |
| apps/api/src/modules/projects/projects.service.ts | 27639 | source/configuration/tooling |
| apps/api/src/modules/reviews/dto/decide-review.dto.ts | 830 | source/configuration/tooling |
| apps/api/src/modules/reviews/review-decision.service.ts | 8184 | source/configuration/tooling |
| apps/api/src/modules/reviews/reviews.controller.ts | 4744 | source/configuration/tooling |
| apps/api/src/modules/reviews/reviews.module.ts | 306 | source/configuration/tooling |
| apps/api/src/modules/reviews/reviews.service.ts | 31392 | source/configuration/tooling |
| apps/api/src/modules/signatures/digital-signature.controller.ts | 1140 | source/configuration/tooling |
| apps/api/src/modules/signatures/digital-signature.service.ts | 10011 | source/configuration/tooling |
| apps/api/src/modules/signatures/signatures.module.ts | 453 | source/configuration/tooling |
| apps/api/src/modules/workflows/v021-workflows.service.ts | 18591 | source/configuration/tooling |
| apps/api/src/modules/workflows/workflows.module.ts | 318 | source/configuration/tooling |
| apps/api/test/concurrency.spec.ts | 5038 | source/configuration/tooling |
| apps/api/test/discovery-lifecycle-foundations.spec.ts | 32492 | source/configuration/tooling |
| apps/api/test/modules/auth-iam.spec.ts | 3693 | source/configuration/tooling |
| apps/api/test/modules/config-checklists-assets.spec.ts | 3899 | source/configuration/tooling |
| apps/api/test/modules/documents-reviews.spec.ts | 6041 | source/configuration/tooling |
| apps/api/test/modules/handover-billing-system.spec.ts | 5398 | source/configuration/tooling |
| apps/api/test/modules/nfr-quality-attributes.spec.ts | 4115 | source/configuration/tooling |
| apps/api/test/modules/parties-projects.spec.ts | 5626 | source/configuration/tooling |
| apps/api/test/perfect-10-remediation.spec.ts | 24215 | source/configuration/tooling |
| apps/api/test/phase0-evidence-integrity-remediation.spec.ts | 25334 | source/configuration/tooling |
| apps/api/test/rbac-matrix.spec.ts | 4096 | source/configuration/tooling |
| apps/api/test/rls-and-integrity.spec.ts | 7525 | source/configuration/tooling |
| apps/api/test/rls-isolation.spec.ts | 7290 | source/configuration/tooling |
| apps/api/test/security-invariants.e2e-spec.ts | 3411 | source/configuration/tooling |
| apps/api/test/v021-edge-cases.e2e-spec.ts | 2898 | source/configuration/tooling |
| apps/api/tsconfig.json | 1022 | source/configuration/tooling |
| apps/web/e2e/critical-flows.spec.ts | 1278 | source/configuration/tooling |
| apps/web/next-env.d.ts | 262 | source/configuration/tooling |
| apps/web/next.config.mjs | 437 | source/configuration/tooling |
| apps/web/package.json | 733 | source/configuration/tooling |
| apps/web/postcss.config.mjs | 81 | source/configuration/tooling |
| apps/web/public/manifest.json | 774 | source/configuration/tooling |
| apps/web/public/sw.js | 1879 | source/configuration/tooling |
| apps/web/src/app/(contractor)/audit/page.tsx | 7527 | source/configuration/tooling |
| apps/web/src/app/(contractor)/billing/page.tsx | 8835 | source/configuration/tooling |
| apps/web/src/app/(contractor)/dashboard/page.tsx | 53269 | source/configuration/tooling |
| apps/web/src/app/(contractor)/layout.tsx | 13408 | source/configuration/tooling |
| apps/web/src/app/(contractor)/parties/page.tsx | 11351 | source/configuration/tooling |
| apps/web/src/app/(contractor)/projects/[projectId]/page.tsx | 92285 | source/configuration/tooling |
| apps/web/src/app/(contractor)/projects/[projectId]/review/[versionId]/page.tsx | 26622 | source/configuration/tooling |
| apps/web/src/app/(contractor)/projects/page.tsx | 16692 | source/configuration/tooling |
| apps/web/src/app/(guest)/guest/[token]/page.tsx | 16964 | source/configuration/tooling |
| apps/web/src/app/(public)/login/page.tsx | 13798 | source/configuration/tooling |
| apps/web/src/app/globals.css | 3538 | source/configuration/tooling |
| apps/web/src/app/layout.tsx | 742 | source/configuration/tooling |
| apps/web/src/app/page.tsx | 106 | source/configuration/tooling |
| apps/web/src/components/layout/header.tsx | 9152 | source/configuration/tooling |
| apps/web/src/components/layout/sidebar.tsx | 11465 | source/configuration/tooling |
| apps/web/src/components/modals/add-requirement-modal.tsx | 8713 | source/configuration/tooling |
| apps/web/src/components/modals/compile-handover-modal.tsx | 16735 | source/configuration/tooling |
| apps/web/src/components/modals/create-project-modal.tsx | 3637 | source/configuration/tooling |
| apps/web/src/components/modals/external-approval-modal.tsx | 6122 | source/configuration/tooling |
| apps/web/src/components/modals/import-checklist-modal.tsx | 14659 | source/configuration/tooling |
| apps/web/src/components/modals/login-switch-user-modal.tsx | 14354 | source/configuration/tooling |
| apps/web/src/components/modals/request-waiver-modal.tsx | 6630 | source/configuration/tooling |
| apps/web/src/components/modals/share-supplier-link-modal.tsx | 11874 | source/configuration/tooling |
| apps/web/src/components/modals/upload-evidence-modal.tsx | 8281 | source/configuration/tooling |
| apps/web/src/components/modals/upload-modal.tsx | 6879 | source/configuration/tooling |
| apps/web/src/components/modals/waiver-modal.tsx | 4204 | source/configuration/tooling |
| apps/web/src/components/pwa-register.tsx | 1229 | source/configuration/tooling |
| apps/web/src/components/requirement-status-pill.tsx | 3997 | source/configuration/tooling |
| apps/web/src/components/ui/metric-card.tsx | 2452 | source/configuration/tooling |
| apps/web/src/components/ui/modal.tsx | 2690 | source/configuration/tooling |
| apps/web/src/components/ui/motion-button.tsx | 1968 | source/configuration/tooling |
| apps/web/src/components/ui/motion-card.tsx | 850 | source/configuration/tooling |
| apps/web/src/components/ui/progress-bar.tsx | 1306 | source/configuration/tooling |
| apps/web/src/components/ui/status-badge.tsx | 4087 | source/configuration/tooling |
| apps/web/src/components/upload-sheet.tsx | 16043 | source/configuration/tooling |
| apps/web/src/components/views/checklist-view.tsx | 16372 | source/configuration/tooling |
| apps/web/src/components/views/client-guest-view.tsx | 6429 | source/configuration/tooling |
| apps/web/src/components/views/overview-view.tsx | 17244 | source/configuration/tooling |
| apps/web/src/components/views/packages-view.tsx | 15591 | source/configuration/tooling |
| apps/web/src/components/views/reviews-view.tsx | 14895 | source/configuration/tooling |
| apps/web/src/components/views/supplier-guest-view.tsx | 5894 | source/configuration/tooling |
| apps/web/src/components/views/warranties-view.tsx | 14203 | source/configuration/tooling |
| apps/web/src/lib/api-client.ts | 5697 | source/configuration/tooling |
| apps/web/src/lib/draft-storage.ts | 1090 | source/configuration/tooling |
| apps/web/src/lib/offline-upload-queue.ts | 11416 | source/configuration/tooling |
| apps/web/src/middleware.ts | 1385 | source/configuration/tooling |
| apps/web/tailwind.config.ts | 2430 | source/configuration/tooling |
| apps/web/tsconfig.json | 609 | source/configuration/tooling |
| apps/web/tsconfig.tsbuildinfo | 166078 | source/configuration/tooling |
| apps/worker/package.json | 607 | source/configuration/tooling |
| apps/worker/src/main.ts | 11095 | source/configuration/tooling |
| apps/worker/src/queues/file.processor.ts | 12752 | source/configuration/tooling |
| apps/worker/src/queues/format-converter.ts | 4800 | source/configuration/tooling |
| apps/worker/src/queues/pdf-stream-compiler.ts | 16564 | source/configuration/tooling |
| apps/worker/src/queues/pdf.processor.ts | 6694 | source/configuration/tooling |
| apps/worker/src/scheduler.ts | 11474 | source/configuration/tooling |
| apps/worker/tsconfig.json | 796 | source/configuration/tooling |
| docs/MEP-CONSTRUCTION-DOMAIN-AND-DOCUMENT-TAXONOMY-HANDBOOK.md | 23934 | documentation |
| docs/SOL_ARCHITECTURE_AND_UX_RECOMMENDATIONS.md | 18542 | documentation |
| docs/SOL_BEST_PRODUCT_IMPROVEMENTS.md | 20363 | documentation |
| docs/SOL_COMPETITIVE_DIFFERENTIATION.md | 13466 | documentation |
| docs/SOL_FINAL_PRODUCT_ANALYSIS.md | 22697 | documentation |
| docs/SOL_FINAL_PRODUCT_VISION.md | 8407 | documentation |
| docs/SOL_PRIORITISED_PRODUCT_ROADMAP.md | 10250 | documentation |
| docs/SYSTEM-CERTAINTY-CONSISTENCY-AND-CAPABILITIES.md | 18448 | documentation |
| docs/TRADECLOSEOUT-ENGINEERING-AND-DOMAIN-COURSE.md | 23818 | documentation |
| docs/TRADECLOSEOUT_2.0_DECISIONS_AND_ASSUMPTIONS.md | 25360 | documentation |
| docs/TRADECLOSEOUT_2.0_PRIORITISED_ROADMAP.md | 18849 | documentation |
| docs/TRADECLOSEOUT_2.0_PRODUCT_SPECIFICATION.md | 35924 | documentation |
| docs/TRADECLOSEOUT_2.0_TARGET_ARCHITECTURE.md | 36368 | documentation |
| docs/TRADECLOSEOUT_2.0_UX_DESIGN_SPECIFICATION.md | 25457 | documentation |
| docs/TRADECLOSEOUT_ADDITIONAL_DISCOVERY.md | 33992 | documentation |
| docs/TRADECLOSEOUT_FINAL_PRODUCT_STRATEGY.md | 12834 | documentation |
| docs/TRADECLOSEOUT_FUTURE_DOMAIN_MODEL.md | 22626 | documentation |
| docs/TRADECLOSEOUT_INNOVATION_CATALOGUE.md | 20089 | documentation |
| docs/TRADECLOSEOUT_PRODUCT_EXCELLENCE_RESEARCH.md | 35880 | documentation |
| docs/TRADECLOSEOUT_PRODUCT_SIMPLIFICATION.md | 16747 | documentation |
| docs/TRADECLOSEOUT_TOP_25_OPPORTUNITIES.md | 22429 | documentation |
| docs/compliance-and-commercial/01-CA-GST-TDS-VERIFICATION-BRIEF.md | 2637 | documentation |
| docs/compliance-and-commercial/02-LEGAL-DPDP-AND-CERT-IN-DOSSIER.md | 1953 | documentation |
| docs/compliance-and-commercial/03-PAID-PILOT-AND-DISCOVERY-KIT.md | 1500 | documentation |
| fixtures/meinhardt-hvac-closeout-checklist.csv | 5291 | source/configuration/tooling |
| fixtures/meinhardt-hvac-closeout-checklist.xlsx | 27664 | binary/fixture |
| fixtures/meinhardt-l3-profile-generated.json | 4875 | source/configuration/tooling |
| images/Screenshot From 2026-11-02 18-40-29.png | 268445 | binary/fixture |
| images/Screenshot From 2026-11-02 18-40-34.png | 293714 | binary/fixture |
| images/Screenshot From 2026-11-02 18-40-41.png | 282904 | binary/fixture |
| images/Screenshot From 2026-11-02 18-40-45.png | 263308 | binary/fixture |
| images/Screenshot From 2026-11-02 18-40-53.png | 254102 | binary/fixture |
| infra/docker/docker-compose.yml | 1157 | source/configuration/tooling |
| infra/docker/postgres-init.sql | 1020 | source/configuration/tooling |
| infra/terraform/main.tf | 3830 | source/configuration/tooling |
| materialize-production-ops-and-tests.sh | 34715 | source/configuration/tooling |
| materialize-repo.sh | 48128 | source/configuration/tooling |
| materialize-web-and-worker.sh | 8638 | source/configuration/tooling |
| package.json | 1191 | source/configuration/tooling |
| packages/db/migrations/0000_complete_v021_schema_and_rls.sql | 68104 | source/configuration/tooling |
| packages/db/migrations/0001_rls_and_constraints.sql | 6959 | source/configuration/tooling |
| packages/db/migrations/0002_create_missing_tables.sql | 6031 | source/configuration/tooling |
| packages/db/migrations/0003_v021_redteam_patches.sql | 7371 | source/configuration/tooling |
| packages/db/migrations/0004_perfect_10_hardening.sql | 5489 | source/configuration/tooling |
| packages/db/migrations/0005_add_project_contract_columns.sql | 171 | source/configuration/tooling |
| packages/db/migrations/0006_discovery_and_lifecycle_foundations.sql | 6798 | source/configuration/tooling |
| packages/db/migrations/0007_procurement_and_vendor_obligations.sql | 4470 | source/configuration/tooling |
| packages/db/package.json | 895 | source/configuration/tooling |
| packages/db/src/catalogue-rules.ts | 7962 | source/configuration/tooling |
| packages/db/src/index.ts | 90 | source/configuration/tooling |
| packages/db/src/run-migrations.ts | 2132 | source/configuration/tooling |
| packages/db/src/schema.ts | 67974 | source/configuration/tooling |
| packages/db/src/seed-real-portfolio.ts | 39635 | source/configuration/tooling |
| packages/db/src/seed-vayuputra-story.ts | 39965 | source/configuration/tooling |
| packages/db/src/tenant-tx.ts | 6813 | source/configuration/tooling |
| packages/db/tsconfig.json | 337 | source/configuration/tooling |
| packages/pdf-engine/package.json | 452 | source/configuration/tooling |
| packages/pdf-engine/src/index.ts | 67 | source/configuration/tooling |
| packages/pdf-engine/src/package-builder.ts | 10406 | source/configuration/tooling |
| packages/pdf-engine/src/sanitise-pdf.ts | 3256 | source/configuration/tooling |
| packages/pdf-engine/tsconfig.json | 141 | source/configuration/tooling |
| packages/shared/package.json | 996 | source/configuration/tooling |
| packages/shared/src/env.ts | 1900 | source/configuration/tooling |
| packages/shared/src/index.ts | 141 | source/configuration/tooling |
| packages/shared/src/permissions.ts | 20167 | source/configuration/tooling |
| packages/shared/src/status-enums.ts | 3479 | source/configuration/tooling |
| packages/shared/src/types.ts | 551 | source/configuration/tooling |
| packages/shared/src/validators.ts | 3658 | source/configuration/tooling |
| packages/shared/tsconfig.json | 141 | source/configuration/tooling |
| pnpm-lock.yaml | 264962 | source/configuration/tooling |
| pnpm-workspace.yaml | 94 | source/configuration/tooling |
| scripts/execute-runbooks.ts | 2882 | source/configuration/tooling |
| scripts/master-prompt-header.txt | 5114 | documentation |
| scripts/rebuild-master-prompt.py | 2845 | source/configuration/tooling |
| scripts/reconcile-consultant-checklist.ts | 9070 | source/configuration/tooling |
| scripts/run-restore-drill.sh | 1719 | source/configuration/tooling |
| scripts/test-e2e-smoke.ts | 12346 | source/configuration/tooling |
| scripts/test-real-excel-ingestion.ts | 16371 | source/configuration/tooling |
| scripts/verify-traceability.ts | 1604 | source/configuration/tooling |
| tradecloseout-production-monorepo-v021.zip | 42094 | binary/fixture |
| tradecloseout_independent_red_team_audit_complete_single_file_deliverable(1).md | 117270 | documentation |
| tradecloseout_master_implementation_blueprint_v0_2_1.md | 98328 | documentation |
| tsconfig.base.json | 741 | source/configuration/tooling |
| tsconfig.json | 304 | source/configuration/tooling |
| turbo.json | 315 | source/configuration/tooling |
