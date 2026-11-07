# Production audit fix verification — 2026-11-07

## Verdict

**Many targeted fixes work. The complete production audit is not implemented.** Independent checks also found a guest privilege escalation, malformed decisions recorded as acceptance, an in-memory OTP rate-limit regression and incomplete PDF sanitization/resource checks.

This report verifies the latest working tree against [PA01–PA32](TRADECLOSEOUT_PRODUCTION_CODE_AUDIT_2026-11-07.md) and the [agent plan](TRADECLOSEOUT_PRODUCTION_AGENT_IMPLEMENTATION_PLAN_2026-11-07.md). Historical audit/backlog files were preserved. Only verification documents were added; application source was not changed by this review.

## Executed verification

- `pnpm typecheck`: passed.
- Root `pnpm test`: passed. API **25 suites / 198 tests**, up from 24 / 178. Shared **4 suites / 44 tests**; database **9 behavioral subtests / 10 including parent**; worker **12 / 13**; archive browser **6**; PDF **3** scripted checks.
- `pnpm --filter @tradecloseout/api build`: passed, then the newly compiled application was used for HTTP probes.
- Actual Nest HTTP application with real guards, global DI interceptors, validation and error handling; fresh migrated disposable PostgreSQL and restricted runtime pool. The harness was updated to match the current bootstrap, avoiding duplicate registration of the projection interceptor.
- Real service/PostgreSQL and isolated Redis reproductions. OTP probes deliberately stopped at a DB-connection sentinel after successful challenge consumption; they did not create sessions or prove the complete login flow.
- PDF-engine and worker fallback artifact probes; catalog OpenAction and annotation Launch actions were inspected independently after rewriting. No PDF action was executed.
- A qpdf-v2 object-layout contract fixture exercised the actual source counting logic. qpdf was not installed locally; this is not an actual qpdf binary run.

The new remediation suite adds useful coverage but mostly mocks SQL/HTTP dependencies. Its fallback rate-limit test supplies a different Lua string from the one the real controller uses, which misses FV03 below. Application-browser, real provider/storage/scanner, crash/load and restore gates were not newly demonstrated. The production dependency versions/lockfile remain unchanged; the previous 7-high/4-moderate advisory audit has not been remediated by these patches.

## Targeted behavior now verified

| Prior reproduction | Current result |
|---|---|
| Guest grant for A0 reads A1 | Actual HTTP request now returns 403 PROJECT_ACCESS_DENIED. |
| Consultant sees internal project settings | Actual own-scope consultant HTTP response omits the synthetic internal settings. Date serialization/Buffer handling is repaired in source and covered by the new unit suite. |
| Versioned work-item/commissioning endpoints 404 | Both `/api/v1` routes return 200; compatibility aliases still exist. |
| Owner organisation list empty | Actual owner HTTP request returns its active membership. |
| Review submission violates requirement status constraint | Actual service/database submission succeeds and persists IN_REVIEW. |
| Pending second-approval waiver absent from work queue | Actual work queue returns the waiver; revalidation row version and review action path are also corrected in source. |
| Generic guest-grant default enum invalid | Actual service persists SUPPLIER_UPLOAD with expected default role/capabilities. Custom privilege overrides remain unsafe: FV01. |
| Guest decision contract | Actual valid ACCEPT, REJECT and ACCEPT_WITH_EXCEPTIONS commands all persist the correct decision and aggregate status. Unknown values incorrectly become acceptance: FV02. Browser source now preserves the three choices. |
| Zero-retention dashboard shows 5% | Actual zero-retention fixture now returns `retentionAtRiskPaise: '0'`. Multi-contract effective-basis work remains. |
| Older OTP delivery failure deletes newer challenge alias | Isolated Redis/controller probe preserves the newer alias and accepts its code through challenge verification. |
| Correct in-memory OTP immediately expires | Correct code now passes challenge consumption and reaches the DB sentinel. Request rate limiting remains broken: FV03. |
| Archive with missing observed size signs | Actual service/database call now rejects with ARCHIVE_STORAGE_INTEGRITY_MISMATCH. |
| Catalog JavaScript OpenAction remains after fallback rewrite | Both engine and worker fallbacks remove the tested catalog OpenAction. Annotation Launch action remains: FV04. |

## Remaining or exposed defects requiring implementation

### FV01 — P0: procurement can issue a guest grant with organisation-owner authority

Sources: [parties.service.ts](../apps/api/src/modules/parties/parties.service.ts:161), [permission.guard.ts](../apps/api/src/common/guards/permission.guard.ts), [session-csrf.guard.ts](../apps/api/src/common/guards/session-csrf.guard.ts), shared `hasPermission`.

Profiles now fix the default enum/capability vocabulary, but the service still applies `dto.role` and `dto.capabilities` directly over the profile. Permission evaluation also treats a guest role matching an internal organisation role as an internal role grant. The new project check does not restrict tenant-level commands without a target project.

**Actual HTTP proof, entirely synthetic:**

1. An R-PROC member's direct organisation profile update returned **403**.
2. That member issued a CLIENT guest grant with `role: 'R-OWNER'` and `capabilities: ['org.manage']`; creation returned **201**.
3. A session bound to that issued grant, for an external synthetic user with no membership, updated the organisation through the real guarded HTTP route: **200**, and the changed profile was persisted.

The guest session was seeded as an authenticated fixture; real OTP delivery was not part of this check. This establishes unsafe grant issuance and runtime authority adoption, rather than claiming a provider/login flow was exercised.

**Implement next:** server-owned immutable grant profiles; reject unsupported role/capability overrides; enforce the issuer's explicit delegation ceiling for the target scope. Evaluate guest authority from its permitted guest profile/capabilities and frozen scope, never from internal organisation-role maps. Deny organisation administration to ordinary project guests. Recheck grant scope/state within protected commands.

**Acceptance:** R-PROC cannot issue R-OWNER/org.manage or any capability beyond its delegation contract; malformed profiles reject. Read-only profiles cannot acquire member-role write permissions. Exercise all grant profiles, internal-role-name collisions, direct resource routes and organisation actions through actual HTTP, with positive own-scope guest cases retained.

### FV02 — P1: unrecognized decision is persisted as ACCEPT

Source: [handover.controller.ts](../apps/api/src/modules/handover/handover.controller.ts:197).

The compatibility mapping defaults every non-rejection/non-exception string to ACCEPT. **Actual HTTP:** posting `{ decision: 'UNRECOGNIZED_VALUE' }` to a valid synthetic recipient returned **201 ACCEPTED**; the recipient row persisted `decision = 'ACCEPT'`, `status = 'ACCEPTED'`.

This is a new regression from the attempted contract repair. Valid outcomes now work, but malformed input can acquire real acceptance semantics.

**Implement next:** runtime DTO enum validation; a closed explicit alias map if compatibility is required; reject missing/unknown decision values before mutation. Preserve remarks and exception items in one canonical schema/client contract.

**Acceptance:** missing, empty, unknown, numeric and malformed nested input return a validation error with no recipient/submission/package/audit effect. The three valid decisions and explicitly supported legacy aliases retain their correct meaning.

### FV03 — P2: in-memory OTP request budget is bypassed

Sources: [identity.controller.ts](../apps/api/src/modules/identity/identity.controller.ts:68), [identity.module.ts](../apps/api/src/modules/identity/identity.module.ts:56).

The controller emits `local c = redis.call('INCR', ...)`; the fallback matches only a string containing `local count = ...`. The request script falls into the wrong branch, returns EXPIRED, and `Number('EXPIRED')` becomes NaN; `count > 5` never fires.

**Actual controller/fallback proof:** seven requests for one isolated identifier were all accepted, no 429 occurred and the rate-limit key remained absent. Correct-code verification itself is repaired. This is the development/test fallback, not a demonstrated bypass of production Redis's Lua execution.

The new unit test passes its own `local count` script instead of exercising `requestOtp`'s actual script, so it does not catch this mismatch.

**Implement next:** replace script-text classification with the challenge-store interface specified in A04, or require Redis. Test the real request/verify entry points against both supported stores. Validate finite numeric rate results and fail safely on a malformed store response.

### FV04 — P1: PDF fallbacks retain annotation Launch actions

Sources: [sanitise-pdf.ts](../packages/pdf-engine/src/sanitise-pdf.ts:17), [pdf-stream-compiler.ts](../apps/worker/src/queues/pdf-stream-compiler.ts:149).

Catalog OpenAction removal works. However, deleting a dictionary key named Launch does not remove an action dictionary whose **`/S` value is `/Launch`**. Annotation `/A` references remain, while only page-level `/A` is removed.

**Actual artifact proof:** a PDF with a synthetic inert Link annotation pointing to a Launch action was processed by each fallback. Both returned successful/safe results, retained the annotation action reference and retained one `/S /Launch` dictionary. No action was executed, and this does not claim a viewer exploit was demonstrated.

**Implement next:** apply an explicit allowed-action/annotation policy through the complete reachable PDF object graph, including annotation actions and chained actions. Remove/reject disallowed action subtypes and their references; verify rewritten output independently. Keep valid document navigation according to policy. Consolidate duplicated sanitizers rather than patching only one.

**Acceptance:** catalog/page/annotation/indirect/chained JavaScript, Launch, OpenAction/AA, embedded files and allowed navigation fixtures, both with real qpdf and in fallback mode. Inspect outputs rather than only checking a claimed stripped count or successful save.

### FV05 — P1 resource gap: qpdf-v2 object counting returns zero

Source: [sanitise-pdf.ts](../packages/pdf-engine/src/sanitise-pdf.ts:79).

The old `objects` command-key request and basic encryption truthiness were repaired. The new counter looks for `parsed.qpdf[1].objects`, but the documented qpdf-v2 representation places `obj:...` entries directly in the qpdf object dictionary.

**Contract-fixture proof:** executing the current counting code with a v2-shaped dictionary containing 26,001 object entries returned **0**. This is a source/parser contract test, not a run of installed qpdf. The object ceiling therefore needs correction and actual supported-tool-image verification before it can be credited.

**Implement next:** parse and validate an explicit supported qpdf JSON schema, count its actual object entries and fail on unknown output shape. Enforce process memory/time limits independently of a post-parse count. Test real installed qpdf versions in CI plus malformed/truncated output and over-budget files.

## All PA01–PA32 dispositions

“Scoped repair” credits the named defect; it does not certify an entire A/XP work package or production gate. “Partial” includes real improvements with acceptance or authority gaps still open. Unchanged capability/operating gaps remain open.

| Finding | Current status | What remains |
|---|---|---|
| PA01 guest scope | Partial | Original A0→A1 read denied; unsafe issued guest authority remains FV01. Canonical command/resource policy is incomplete. |
| PA02 external projection | Partial | Tested consultant fields/date handling repaired and interceptor DI registered; heuristic/nested audience contracts and full role matrix remain. |
| PA03 versioned routes | Scoped repair | API aliases work; Next-proxy/browser and connected screen acceptance remain. |
| PA04 membership discovery | Scoped repair | Actual active membership returned. Full multi-org/switch/revocation matrix remains. |
| PA05 review submission | Scoped repair | Actual database transition succeeds. Full state vocabulary/review lifecycle remains elsewhere. |
| PA06 work queue | Partial | Pending waiver visibility, revalidation version and review path improved; every next command/responsibility and full UI journey are not verified. |
| PA07 grant profiles | Partial | Default profile persists; arbitrary privileged overrides/internal-role adoption are FV01. |
| PA08 recipient wire contract | Partial | Valid accept/reject/exceptions persist; unknown input is accepted: FV02. Browser suite not run. |
| PA09 retention projection | Partial | Zero fixed; latest-one-contract selection/effective variation basis and projection consistency remain. |
| PA10 OTP lifecycle | Partial | Real Redis failure-cleanup race repaired and fallback verify reaches DB; fallback request budget broken: FV03. Provider/session acceptance remains. |
| PA11 dependencies | Open | Production package versions and lockfile unchanged. Parser byte/row options do not resolve advisory matches. |
| PA12 archive missing facts | Scoped repair | Missing observed size now rejects; full signed-download byte verification and legacy-data migration remain. |
| PA13 request schemas | Open | Inline/interfaces still dominate; new permissive mapping illustrates missing runtime validation. |
| PA14 durable commands | Open | No atomic command ledger/unit-of-work outcome implementation. |
| PA15 scoped qualification | Open | No canonical immutable qualification model/consolidated lifecycle across read models. |
| PA16 audit completeness | Open | Missing per-command event contracts/transactional coverage and actor metadata work remain. |
| PA17 durable executions | Open | Queue dispatch/execution reconciliation, durable terminal/operator recovery not implemented. |
| PA18 parser/sanitization | Partial | Tested OpenAction removal repaired; FV04/FV05 and complete format/process containment remain. |
| PA19 resource/recovery budgets | Open | No complete transfer deadlines, aggregate temp/process budgets and fault recovery proof. |
| PA20 messaging lifecycle | Open | Provider receipt/callback/delivery states, explicit audiences and bounded retries remain. |
| PA21 configuration/readiness | Open | No complete bootstrap validation, role/capability readiness and secret-safe diagnostics. |
| PA22 application CI journey | Open | Added 20 mostly mocked tests; full application browser/pipeline/fault suite not wired. |
| PA23 object recovery | Open | No demonstrated object/version restore, hash retrieval, RPO and runtime recovery journey. |
| PA24 truthful billing UI | Open | Active billing page still hardcodes sample company/profile/plan facts and hides failures. |
| PA25 offline recovery | Open | Cross-tab lease, stale URL refresh, actor-boundary rechecks and browser matrix unchanged. |
| PA26 schema drift | Open | Declared schema/state reconciliation and populated upgrades not completed; no new migrations. |
| PA27 HVAC commissioning | Open | Routes fixed; procedures, witness authority, calibration, retest and functional/seasonal lifecycle remain. |
| PA28 persisted imports | Partial | Added 10 MB/5,000-row guards and parser options; row limit occurs after parsing, dependency/isolation and reviewed persistent preview/commit remain. |
| PA29 material trace | Open | Receipt/lot/serial allocation/substitution/return-to-installed-unit workflow remains. |
| PA30 sectional aftercare | Open | Sectional acceptance, warranty conflicts, service/claim/commercial exception lifecycle remain. |
| PA31 connected UX | Open | New backend capabilities lack complete daily contractor/mobile/search/accessibility journeys. |
| PA32 operated deployment | Open | Release/rollback, observability/SLO/capacity/failure-rehearsal evidence remains. |

## Next action for the implementing agent

1. **FV01 first:** close grant privilege amplification and internal-role adoption; use actual low-privilege issuer and guest sessions for regression tests.
2. **FV02:** reject unknown/missing decisions; retain the three now-working valid outcomes.
3. **FV04/FV05:** complete PDF action handling and supported-tool JSON/resource checks, with independent output inspection.
4. **FV03:** stop interpreting Lua via text matching; verify real request budgets through the supported stores.
5. Continue the existing A01–A20 plan for the unchanged production capabilities. Do not mark it complete from this remediation slice or the test count.

The [verification evidence](TRADECLOSEOUT_PRODUCTION_FIX_VERIFICATION_EVIDENCE_2026-11-07.json) retains exact probe results, harness sources and source fingerprints. No deployment or customer acceptance was performed.
