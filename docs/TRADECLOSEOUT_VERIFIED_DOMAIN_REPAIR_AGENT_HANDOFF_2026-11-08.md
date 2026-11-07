# Verified domain repair: agent instructions and definition of completion

Date: 8 November 2026. Repository: omniscient2002/tradecloseout.

## Exact baseline and verdict

The updated review is substantially correct about the remaining checklist/import/readiness/closure/applicability/payment gaps on main. Its branch recommendation is now historical: GitHub's default is already **main**, verified again through the GitHub API. The older master branch remains preserved. Do not reopen the earlier master-only security findings as though they describe current main.

Review baseline: local main `cc1d1881364ea2ad27846de4c4af78f48e536664`. Application code is from parent `2b1cf2c76727d711576fec6ce83fb6d1ce69d941`; cc1d188 adds documentation only. Public master was independently identified as `714ac6cf471f4c217e9150e200da401d4b4bf3ec`. This report's subsequent documentation commit will naturally have a newer SHA.

No application fixes are claimed by this handoff. Sources were checked locally; freshly built services were exercised with a fully migrated disposable PostgreSQL database and restricted application role. Service probes are not equivalent to public HTTP exploit demonstrations. No production data, customer messages or payment events were used.

## Finding dispositions

| Finding in the updated review | Disposition against this baseline |
|---|---|
| Provider calls, single identity module, correct logout column, self-approval protection | Improvements present; retain regressions. Real-provider acceptance and complete auth HTTP lifecycle remain distinct release evidence. |
| Default createSnapshot contains one HANDOVER_DOSSIER / DT-001 | Source-confirmed. Runtime currently fails earlier on missing client_type; fixing that column alone would expose the one-item default. |
| Import flattens scope/group/type | Source-confirmed: inputs do not preserve individual asset/system/category mapping, every row becomes PROJECT/G1 and missing doc type becomes DT-001. |
| Import has a direct unbound pool read | Source-confirmed. WHERE org_id does not establish transaction-local RLS authority. |
| Import reads snapshot_json instead of resolved_payload_json | Reproduced PostgreSQL 42703: snapshot_json does not exist in the migrated schema. |
| Empty requirements produce ready | Reproduced. A nonexistent project also returns ready from the service instead of not-found. |
| Partial acceptance can allow full closure | Reproduced with a synthetic HANDOVER project and PARTIALLY_ACCEPTED submission: project became CLOSED with no checklist or package. This fixture bypassed public submission creation to isolate closure's invariant. |
| Closure conflates HANDOVER/ACCEPTANCE warranty dates | Source-confirmed: both bases are initialized from closureDate where warranty_start is NULL. |
| projectType is discarded | Reproduced: requested HOSPITAL persisted PRIVATE_COMMERCIAL. Schema/rule enum vocabulary also differs. |
| Razorpay remains unavailable and HMAC uses reconstructed body | Source-confirmed. Safe refusal is present; automated payment processing is not complete. |
| GitHub landing page still defaults to master | No longer true: changed and verified as main. CI already uses main and pnpm 12.4.1. |

**Additional release blocker:** `createAndApplySnapshot` selects `projects.client_type`, but the migration chain does not create that column. The actual createSnapshot probe failed with PostgreSQL 42703. Applicability inputs, persisted fields and database constraints need repair together.

## Executed evidence

- `pnpm typecheck`: passed.
- `pnpm --filter @tradecloseout/api build`: passed.
- Root `pnpm test`: passed: database 10 tests including parent; shared 4 suites / 44 tests; archive browser 6 tests; PDF 3 scripted checks; API **26 suites / 232 tests**; worker 13 tests including parent.
- Real-service/database probes: empty project reports ready; nonexistent project reports ready; HOSPITAL round-trip becomes PRIVATE_COMMERCIAL; default snapshot fails missing client_type; import fails missing snapshot_json; partial submission without a package permits full closure.
- No new live provider/payment, production deployment, full application browser, workload or restore certification was performed. These results prove the named cases, not production readiness of every branch.

See [probe harness](evidence/domain-repair-2026-11-08/replay-probes.ts), [observed results](evidence/domain-repair-2026-11-08/results.jsonl), and [source fingerprints/check summary](TRADECLOSEOUT_DOMAIN_REPAIR_EVIDENCE_2026-11-08.json). The harness uses this checkout's absolute path and built API modules; build workspace packages/API first, then run it from the repository with `node --import tsx docs/evidence/domain-repair-2026-11-08/replay-probes.ts`. It creates/removes only its disposable test database and requires the existing test database credentials.

## Implementation packages

### D01 — Make schema and applicability inputs agree

Sources: `apps/api/src/modules/projects/projects.service.ts:103`, `checklists/checklists.service.ts:115`, `packages/db/src/catalogue-rules.ts`, project DTO/controller, Drizzle schema and SQL migrations.

1. Inventory all rule inputs and their authoritative source: project type, client type, contract conditions, equipment categories, DLP and technical attributes. Define one executable input schema and canonical vocabulary. Current DB project_type accepts PRIVATE_COMMERCIAL/GOVT_PWD/PSU/INSTITUTIONAL/INDUSTRIAL, while rules also refer to HOSPITAL/CLEANROOM/GOVERNMENT/CPWD; resolve whether these are separate dimensions rather than adding incompatible labels blindly.
2. Persist validated attributes through the entire controller → createProject → createDraftProject → SQL chain. Reject unsupported values explicitly. Do not silently turn unknown projects into PRIVATE_COMMERCIAL or unknown clients into PRIVATE.
3. Add a forward migration for the chosen representation, plus matching Drizzle schema. Do not edit already applied migrations. Add defaults only where justified by real legacy data. Produce a report of records needing confirmation; preserve unknown legacy attributes until reviewed.
4. Feed snapshot evaluation from persisted, validated project/contract/asset facts. Record the exact input/template/rule revisions used. Changes to those facts must produce a baseline-impact preview rather than silently rewriting accepted obligations.

**Complete when:** clean install and upgrade migration tests pass; supported attributes round-trip through HTTP under tc_app; unsupported/malformed values return structured validation errors; representative hospital/government/private scenarios yield reviewed expected applicability; legacy uncertainty is visible. Snapshot creation no longer fails on missing schema fields.

### D02 — Deliver real versioned checklist selection and preview

Sources: `checklists.service.ts:299`, `createAndApplySnapshot`, configuration resolver and catalogue/rules.

1. Replace the one-item wrapper with selection of a published, versioned HVAC template and applicable contract/project overlays. Retain existing resolver/expansion foundations where correct.
2. Define template lifecycle, stable requirement identifiers, source provenance, expected scope types and rule revision. An absent/unconfigured template returns a specific blocker; no substitute HANDOVER_DOSSIER or DT-001 classification.
3. Preview project, system, category and individual equipment requirements. Show applicability reason, missing inputs, owner/reviewer, mandatory/conditional/optional meaning and source contract/template reference. Conditional obligation is not simply the inverse of mandatory.
4. Persist the reviewed preview with source hash, project/asset/baseline revisions and disposition. Commit exactly that preview under a project/baseline lock with expected revision and idempotent receipt. Reconcile existing requirements using stable identity; retain historical acceptance/evidence and explicit change impact.
5. Add the actual setup/import UI so a contractor can select/map/review/commit without developer SQL. No screen may describe a one-item fallback as a complete HVAC checklist.

**Complete when:** a reviewed representative HVAC fixture instantiates exact expected scoped obligations; project-wide manuals and equipment tests differ correctly; missing/ambiguous inputs block commit; stale preview/retry/concurrent first snapshot behave deterministically; existing evidence lineage survives changes; an empty template cannot become a final baseline by accident.

### D03 — Repair imports as one atomic, scoped workflow

Sources: `checklists.service.ts:324–390`, snapshot schema, import controller and web modal.

1. Use `resolved_payload_json` consistently. Remove the snapshot_json query and any incompatible schema aliases only after inventorying legacy data.
2. Refactor the internal snapshot mutation to accept an existing transaction/client. Read the existing baseline and apply the reviewed change within that same tenant-bound transaction. Do not solve this with a scoped read followed by an independent mutation transaction; that leaves a race.
3. Preserve source row ID, sheet/row location, title, doc type mapping, group/milestone, scope kind/target and obligation semantics. Resolve asset references by exact tenant/project. Ambiguous tags and unknown document types become row errors requiring review, not project-wide DT-001 rows.
4. Define merge/update/duplicate/remove semantics explicitly. Same key and same source row can be a revision, not silently discarded by a Set. Require confirmation of destructive scope changes. Preserve both previous requirements and traceable revisions.
5. Persist import session/source hash/mapping/preview/row dispositions/expected baseline and a durable commit result. Enforce parser/row/file budgets, typed nested DTOs and idempotent commits. Field errors must identify the row and remediation.

**Complete when:** a second import preserves intended prior rows; retries do not duplicate; changed source rows create reviewed revisions; same-tag foreign-project assets reject; mixed scopes remain exact; concurrent imports cannot lose updates; failed commits leave no partial baseline. Run clean/upgrade and tc_app database tests plus actual HTTP/UI mapping flow.

### D04 — Centralize stage-specific readiness with a valid baseline

Sources: `handover.service.ts:28`, package generation SQL, dashboards/reports, projects and workflow executors.

1. Implement an authoritative domain evaluator that can run on a supplied transaction/client. Expose explanations through a separate API orchestration layer; do not open nested independent transactions inside final state-changing commands.
2. Resolve project and permission scope first; nonexistent project is not-found. Require an active, reviewed compatible baseline and its instantiated applicable scope. No requirements/no baseline must not imply ready. A legitimate zero-mandatory configuration needs an explicit approved policy outcome, not a blanket count > 0 heuristic.
3. Return stages separately: internal evidence readiness, ready-to-submit, external acceptance and ready-to-close. Include baseline/policy revision, evaluation time and reason codes with requirement/asset/version/exception references.
4. Reuse the exact current qualification checks for verified object status, pinned provider version, observed size/hash, current approved evidence, applicable identity/revalidation, expiry and authorized exceptions. Raw APPROVED/WAIVED/NOT_APPLICABLE/HANDED_OVER strings do not prove qualification.
5. Share the evaluator/read model across package generation, submissions, dashboards and closure. Revalidate under the final command transaction with a documented locking/revision strategy against concurrent evidence, baseline, recipient and waiver changes. An earlier successful GET is not authorization to commit later.

**Complete when:** empty/nonexistent/invalid baseline never returns ready; missing proof cannot satisfy a mandatory obligation; supported zero-mandatory/all-exempt policy is deliberate and audited; AHU-01 proof cannot satisfy AHU-02 without explicit valid scope; all projections agree for the same revision/time. Expiry tests use the defined India calendar boundary rather than host timezone accidents.

### D05 — Tie closure to current, fully accepted scope

Sources: `projects.service.ts:302`, `handover.service.ts` recipient/submission commands, permissions, schema.

1. Require a selected current acceptance/package/scope reference and expected project/baseline revision in the close command. Remove the “any accepted or partially accepted submission exists” shortcut.
2. Verify that the package is backed by real immutable artifacts, matches the relevant current baseline/scope and required evidence decisions, has no unresolved blocking exceptions/mandatory defects, and every required recipient has valid authority and acceptance for that scope.
3. Model sectional acceptance explicitly. Partial project acceptance can complete that section if policy allows; it must not silently close unrelated remaining scope. A partially accepted status may be acceptable only when structured policy proves no required whole-project scope remains—not by trusting the status alone.
4. Check recipient identity/delegation for both guests and members; fail closed when party binding is absent. Distinguish a recipient's authenticated decision from an internal user's recorded external decision with proof. Enforce allowed predecessor state, immutable decision history, reasoned correction/withdrawal and revision preconditions. The current service blocks repeated decided rows, but that is not the whole authority contract.
5. Consolidate or retire alternate workflow executors that can update acceptance without the canonical policy. Keep acknowledgement/receipt separate from acceptance.
6. Persist closure, coverage references, audit, outbox and command outcome atomically. No generic overrideReason may bypass current obligations.

**Complete when:** the retained partial-without-package fixture rejects; old acceptance cannot close a changed baseline; missing/revoked/incorrect recipient authority rejects; concurrent acceptance withdrawal or evidence change cannot race a false close; valid complete acceptance succeeds once and replays safely. Add real HTTP and database tests, not only direct service mocks.

### D06 — Derive warranty dates from the relevant recorded event

Sources: `projects.service.ts` closure asset update, warranty event service, equipment passport and commercial/aftercare views.

1. Separate occurrence date, recorded date, precision/timezone, applicable asset/section, event proof and authority for SUPPLY/COMMISSIONING/HANDOVER/ACCEPTANCE as supported by contract policy.
2. Remove unconditional initialization of HANDOVER and ACCEPTANCE bases from administrative closureDate. Use each asset's documented contractual event, preserving existing evidence-backed coverage and reporting missing/conflicting basis.
3. Define event-type behavior for registration, confirmation, claim, extension and correction. A confirmed extension must update the effective coverage projection; a claim must not fabricate coverage.
4. Preserve disputed/proposed/superseded history. Reconcile imported legacy dates with a review report; do not mass-rewrite customer dates using today's closure date.

**Complete when:** handover and acceptance on different dates produce different correct starts; sectional dates apply only to included assets; prior coverage is preserved; extension/correction propagates consistently; absent proof stays unresolved. Exact DATE values survive timezone serialization and exports.

### D07 — Complete payments only behind a verified capability

Sources: `billing.service.ts:185`, billing controller, Nest bootstrap/raw-body handling, subscription/financial schema.

1. Keep unavailable behavior until the full path is ready. Do not replace 503 with a generic 200 that drops valid events. Core pilot workflows can use an explicit approved manual billing process if automated billing is intentionally outside that release.
2. Capture bounded original request bytes and verify HMAC over those bytes using a required secret. Parse only after authentication. Validate provider event identity from the documented provider contract; do not assume one payload field always holds it. Use constant-time comparison with well-defined signature format/length validation.
3. Persist an authenticated durable inbox with provider/account/event identity and unique deduplication, payload hash, schema version, received time and processing state. Acknowledge only after durable acceptance; then process with retries and operator-visible terminal failure.
4. Bind provider subscription/customer/account to stored tenant relationships. Do not let untrusted notes choose the tenant. Handle out-of-order/duplicate events, reconciliation and unknown commit outcomes with one atomic state/audit/outbox/outcome contract.
5. Test sandbox events and reconciliation against the real provider contract; include missing config, altered whitespace/raw bytes, invalid signature, duplicate/conflicting event IDs and provider success followed by DB failure. No live charge is needed to test the implementation.

**Complete when:** valid raw events persist and produce correct exactly-once local outcomes under duplicate delivery; malformed/forged events reject; lost acknowledgement/reordered delivery recover; unsupported states remain explicit; real sandbox evidence is retained. If deferred, label this package DEFERRED and automated payments unavailable—never mark it implemented because refusal is safe.

### D08 — Integrate proof and keep repository truth current

1. Keep main canonical; verify source SHA at start/end and use immutable links in reports. Do not merge master back into main to “fix” historical findings or delete historical reports.
2. Add database-backed regressions for the actual failures above. Some existing tests assert invented objects or mock query shapes; those do not replace executing migrations and the live transaction paths.
3. Extend application CI to start actual web/API/worker with isolated services and run a supported browser journey: setup/preview/import → wrong-scope evidence rejected → upload/scanning → rejected revision → corrected approval → authorized waiver if needed → real package download and independent verification → required recipient acceptance → closure → correct aftercare dates.
4. Include failure/retry/process-crash/Redis-loss acceptance for the supporting command/file/job paths. Do not weaken earlier auth, self-approval, missing-byte, scanner, quota or PDF regression controls.
5. Update README's “No application code exists” statement and remove unsupported “all hardened” claims. Keep implementation, operational acceptance and commercial validation distinct.

**Complete when:** current manifests/migrations/API/UI agree; full checks pass on the exact implementation commit; required browser/fault/provider gates have executed evidence or remain explicitly open. A green test count does not overrule an independently failing invariant.

## Global definition of completion

A work package is **IMPLEMENTED AND VERIFIED** only when all applicable items below hold:

- Exact requirements, scope and invariants are written as executable contracts and implemented through schema → service → guarded/validated HTTP → connected UI where needed.
- The original observed failure is reproduced in a regression that fails before the repair and passes afterward. A valid positive case and neighboring tenant/role/revision/failure cases pass too.
- Data integrity tests execute the actual migrations and production-equivalent restricted database role. Both clean installation and upgrade from the supported earlier schema are exercised; no test bypasses RLS or creates missing production columns ad hoc.
- State effects, audit/outbox and durable outcome commit under the intended transaction ownership. Retries/concurrency/unknown outcomes cannot duplicate effects or bypass acceptance. External effects have stable identities and reconciliation.
- Existing records have a safe migration/backfill/review path; backward compatibility and changed API contracts are documented. No silent defaults invent scope, approval, coverage or entitlement facts.
- Exact commands, versions, source SHA, test results and meaningful artifacts are recorded. Test fixtures and real-provider acceptance are labeled accurately. No secrets or real customer data appear in evidence.
- `pnpm typecheck`, relevant builds, root tests, security/RLS/RBAC checks and required integration/browser acceptance pass for the changed slice. Infrastructure limitations are reported as NOT RUN/BLOCKED, never converted into passed evidence.
- Independent artifact checks validate real included versions and bytes; PDF success flags or database metadata alone do not establish a valid handover.
- The final report identifies completed packages, remaining blockers, deferred scope and operational prerequisites. “Source fixed”, “tests passed”, “deployed” and “production accepted” are different claims.

Overall production completion additionally requires startup/readiness, supported parser/scanner/storage images, dependency disposition, backup plus restored object-byte proof, monitored workload/failure recovery, support/incident runbooks and a real contractor acceptance exercise. These broader gates remain required even after D01–D08 are implemented.

## Copyable implementing-agent prompt

```text
Work in omniscient2002/tradecloseout on canonical main. First read AGENTS.md if present,
this handoff, the relevant current source and the retained evidence. Record the exact
starting SHA and preserve user changes. Do not work from the historical master branch.

Objective: make the supported HVAC closeout workflow truthful and recoverable: correct
scoped obligations, preserved consultant imports, qualified immutable evidence,
stage-specific readiness, authorized acceptance, and contract-based closure/aftercare.

Use D01–D08 in this handoff as implementation packages. Start with the confirmed schema
failures (client_type and snapshot_json), but repair the complete schema/DTO/rule/transaction
contract rather than merely suppressing SQL errors. Persist project attributes. Replace
the one-item checklist with reviewed versioned templates. Preserve exact import scope
and prior baseline under one tenant-bound transaction. Centralize readiness using an
existing transaction/client for final decisions. Block empty/nonexistent project readiness
and full closure based on stale/partial/unqualified acceptance. Derive warranty dates from
documented events, not administrative closure. Keep payments unavailable until raw-body
verification, durable ingestion, reconciliation and sandbox acceptance are complete.

For every package:
1. Reproduce its observed negative case using actual migrated PostgreSQL and tc_app.
2. Add a failing regression, a realistic positive workflow and adjacent role/tenant/
   revision/concurrency/failure cases. Exercise real HTTP contracts for public commands.
3. Implement schema, service, API and connected UI changes; use forward migrations and
   explicit data-repair/review reports. Do not edit applied migrations or invent defaults.
4. Preserve prior security, file-integrity, PDF, quota and authority regressions. Do not
   solve a failure by bypassing permissions, making scanners optional, weakening tests,
   fabricating evidence, or changing a test fixture to conceal a production schema gap.
5. Run appropriate checks and the actual supported end-to-end journey. Independently
   inspect downloaded artifacts. Record commands, results, source SHA and limitations.
6. Assess the global definition of completion above. Mark the package VERIFIED only
   with the required evidence; otherwise use SOURCE_IMPLEMENTED, PARTIAL, BLOCKED or
   DEFERRED with the exact remaining work. Do not report the whole SaaS production-ready
   because these targeted repairs or unit tests pass.

Deliver a coherent reviewable implementation, migration notes, regression coverage and
updated evidence/status. Continue through the authorized repair scope; do not stop at
a plan or another specification. Do not merge/publish/deploy or change remote settings
unless the current user authorization covers that action. If domain policy is unresolved,
keep a truthful blocker and document the decision needed instead of assuming acceptance.
```
