# Production fix follow-up and next steps — 2026-11-07

## Verdict

**The five previously named FV01–FV05 cases are repaired in the tested scope.** The production programme remains partial, and three adjacent cases still fail: chained PDF actions, compressed PDF object counting in fallback mode, and expired in-memory OTP acceptance.

This follows [the previous fix verification](TRADECLOSEOUT_PRODUCTION_FIX_VERIFICATION_2026-11-07.md). It preserves that report and the [32-finding audit](TRADECLOSEOUT_PRODUCTION_CODE_AUDIT_2026-11-07.md). The [20-package implementation plan](TRADECLOSEOUT_PRODUCTION_AGENT_IMPLEMENTATION_PLAN_2026-11-07.md) remains the main delivery plan; a scoped fix does not close an entire work package.

Only verification documents were added. HTTP/database fixtures were synthetic and disposable, Redis used isolated identifiers, and local PDF fixtures contained inert action targets; no action was executed. No production deployment, customer records, real messages or payments were changed. Source fingerprints stayed stable during this pass.

## Executed checks

- `pnpm typecheck`: passed.
- Root `pnpm test`: passed; API **25 suites / 208 tests**, up from 198. Shared **4 suites / 44 tests**; database **9 subtests / 10 including parent**; worker **12 / 13**; archive browser **6**; PDF **3** scripted checks.
- API production build: passed. The freshly compiled Nest application, actual guards/interceptors/validation and restricted database role were used for the HTTP probes.
- Independent service/PostgreSQL and real Redis probes. Successful OTP challenge consumption deliberately stopped at a database sentinel; no complete session/provider lifecycle is certified by those particular probes.
- Actual engine and worker PDF fallback rewrites, followed by independent artifact inspection. qpdf was unavailable locally; its counting fix was checked with the actual parser fragment and a documented-layout fixture, not an installed binary.
- Full application browser, real provider/storage/scanner, process-fault/load and restore acceptance were not run. Dependency manifests/lockfile remain unchanged from the prior advisory audit; dependencies were not rescanned in this pass.

## Previous fixes now verified

| Finding | Result |
|---|---|
| **FV01 — guest owner escalation** | R-PROC issuing the owner/client grant now returns **403**, with no grant created. Even an owner cannot override a guest profile to R-OWNER or add org.manage: **400**. A seeded legacy unsafe guest grant cannot update the organisation: **403**. Normal owner-issued client and procurement-issued supplier grants still return **201**. |
| **FV02 — malformed decision accepted** | Unknown decision now returns **400**; the recipient remains SENT with NULL decision. ACCEPT, REJECT and ACCEPT_WITH_EXCEPTIONS still persist the correct outcomes. |
| **FV03 — in-memory request budget** | Five requests accepted; later requests return rate limiting. The prior seven-success/no-counter reproduction is repaired. Correct-code challenge consumption and the real Redis generation-safe failure cleanup remain working controls. |
| **FV04 — direct annotation Launch action** | Both engine and worker fallbacks remove the tested direct annotation action and catalog OpenAction. Chained action traversal is still incomplete: FV07. |
| **FV05 — qpdf-v2 count is zero** | The current source counting logic returns **26,001** for the same 26,001-object layout fixture. Unknown zero-count output now has a rejection branch. Actual installed-qpdf execution and complete resource containment remain acceptance work. |

Earlier controls also held: out-of-project guest reads deny; consultant internal settings are omitted; versioned routes work; owner membership discovery works; review submission and pending waiver work items succeed against PostgreSQL; zero retention stays zero; and archive missing observed size rejects.

## Remaining reproducible issues

### FV06 — P2: expired codes are accepted by the in-memory OTP store

Sources: [identity.module.ts](../apps/api/src/modules/identity/identity.module.ts), its verification `eval` implementation, and [identity.controller.ts](../apps/api/src/modules/identity/identity.controller.ts).

**Probe:** issued a fresh debug challenge through the actual controller/fallback, advanced the controlled clock by **301 seconds**, and verified the correct code. The challenge was accepted and execution reached the intentional database sentinel rather than returning OTP_EXPIRED.

The store's `get()` honors `expiresAt`, but verification and alias resolution read the Map directly with `this.store.get()`. Those lookups bypass expiration. The production Redis path uses native TTL and was not shown vulnerable by this probe.

**Implement:** use one expiration-aware challenge-store API for every challenge/alias/attempt read, issuance, supersession and consume. Prefer the A04 store abstraction over continuing to identify Lua operations by script text. Ensure expired records cannot resurrect through aliases or stale attempt records. Test the actual request/verify entry points rather than a separately invented script.

**Acceptance:** correct code before expiration succeeds; at/after the defined expiration boundary it rejects; direct and alias lookups agree; reissue/cleanup/replay/concurrency preserve generation binding; the six-request budget still works. Run the same behavioral contract against Redis and every supported fallback.

### FV07 — P1: a disallowed action survives when chained behind an allowed action

Sources: [sanitise-pdf.ts](../packages/pdf-engine/src/sanitise-pdf.ts), `sanitizePdfDoc`, used by [pdf-stream-compiler.ts](../apps/worker/src/queues/pdf-stream-compiler.ts)'s fallback.

**Actual artifact probe:** a Link annotation's `/A` is an allowed URI action. Its inline `/Next` is a Launch action with an inert target. Both fallbacks report success/safe, retain the annotation action and retain `/Next` with `/S /Launch`. The direct-Launch fixture is correctly stripped, so this is the missing recursive case rather than the old direct-action bug.

The sanitizer checks the annotation's immediate action and enumerates indirect dictionaries. Inline nested dictionaries are not necessarily separate indirect objects, so a disallowed nested action escapes that enumeration. No PDF action was executed, and no viewer exploit is claimed.

**Implement:** define an allowed-action policy and inspect the complete reachable object graph: dictionaries, arrays, references, annotation actions and action chains. Resolve references with a visited set and explicit traversal-depth/object/time limits. Remove or reject prohibited actions and references. If chained actions are not a product requirement, remove `/Next` rather than partly supporting it. Apply the same policy to every sanitizer and independently inspect the rewritten output.

**Acceptance:** allowed action → prohibited direct/indirect/array action chain, cycles, alternate annotation types and nested additional actions. Retain positive navigation fixtures where policy allows them. Test both actual qpdf and fallback pipelines and confirm the artifact, not merely the function's safe flag.

### FV08 — P1: compressed PDF object streams bypass fallback object ceilings

Sources: [sanitise-pdf.ts](../packages/pdf-engine/src/sanitise-pdf.ts)'s regex-based fallback count and [pdf-stream-compiler.ts](../apps/worker/src/queues/pdf-stream-compiler.ts)'s `pageCount * 10` approximation.

**Actual artifact probe:** a valid one-page local fixture contains **25,014 parsed indirect objects**, above the configured **25,000** ceiling, stored using object streams. Both fallbacks return success/safe. The engine reports **502** objects; the worker reports **10**.

Counting textual `n n obj` tokens counts object-stream containers rather than the objects inside them. Multiplying page count cannot enforce an indirect-object budget. This is separate from the corrected qpdf-v2 output parser.

**Implement:** remove approximate counters from safety decisions. Use the actual parsed object inventory under a constrained process, or require a verified scanner/tool with an enforced resource budget. A count performed after unrestricted parsing does not itself bound peak memory/CPU, so enforce OS/process/whole-job memory/time/input/decompression budgets too. Production fallback policy should be explicit and fail safely when guarantees are unavailable.

**Acceptance:** compressed and uncompressed forms with the same object inventory behave identically at/below/above the ceiling; malformed compressed objects, large streams and deeply nested/cyclic structures terminate within budgets. Report the actual observed count and terminal failure. Verify no artifact/job becomes READY/accepted after a failed resource check.

## Broader remaining work after these patches

The files implementing the following areas were not materially completed by the current nine-file remediation delta:

| Area | Remaining production implementation |
|---|---|
| Dependencies — PA11/A05 | Prior high/moderate advisory paths remain on unchanged versions. Upgrade/replace with compatibility and reachability checks; spreadsheet limits do not fix the dependency. |
| Durable commands/audit — PA14/PA16/A06 | Atomically bind mutation, audit, outbox and durable outcome; recover unknown commit outcomes. Complete event coverage for every material command. |
| Evidence qualification — PA15/A07 | One asset/identity/requirement/procedure-revision qualification contract across readiness, package, passport and commercial views. |
| Jobs/files — PA17–PA19/A08 | Durable logical execution/reconciliation, bounded parsers/transfers/temp budgets, Redis/process recovery and operator-visible terminal states. |
| Configuration/CI/recovery — PA21–PA23/PA32/A18–A20 | Validated production startup, real dependency readiness, supported-tool images, full application browser journey, metrics/alerts, object-byte restore, workload/failure rehearsals. |
| Offline/product truth — PA24/PA25/A10/A15/A17 | Stale signed-URL refresh, cross-tab ownership/actor checks and browser cases; remove active billing sample facts and show real unavailable/error states. |
| HVAC execution — PA27–PA31/A11–A14/A17 | Persisted reviewed imports; material/lot/serial trace; approved procedures/witness/calibration/TAB/retest; functional/seasonal return visits; sectional aftercare/commercial evidence and connected UI. |

The full PA01–PA32 assessments in the previous verification remain applicable except for the targeted FV dispositions above. No entire production gate or all 20 packages is certified complete by this follow-up.

## Next steps for the implementing agent

1. **Repair FV07/FV08 as one parser-safety slice.** Own the complete PDF action/object/resource contract rather than adding another shallow check. Add the exact inline-chain and object-stream artifact fixtures plus positive documents. Run with installed qpdf and fallback modes.
2. **Repair FV06 through the challenge-store contract.** Make all reads honor expiration and keep the now-working rate limit and generation race tests. Include boundary-time tests through the controller.
3. **Complete A05 dependency remediation.** Record exact current paths/versions, compatibility tests and remaining justified exposure. Avoid broad audit suppression.
4. **Implement A06–A08 foundations.** Atomic command outcomes, complete transactional audit, scoped evidence and durable job recovery should precede claims that a green unit suite proves reliable closeout.
5. **Run an actual integrated closeout acceptance gate.** Browser → API → versioned storage → scanner → worker → independent review → package download → authorized acceptance, followed by process/Redis failure and restore evidence. Fix canonical route/schema/permission contracts as a whole when the journey finds drift.
6. **Continue deeper contractor capabilities with A11–A17.** Use permissioned contractor examples and engineer-reviewed procedures. Keep sectional aftercare and seasonal completion accountable; do not turn deferred work or raw measurements into acceptance.

For each slice, retain the old passing regressions, the new negative fixture, a valid positive case, migration/operating implications and exact executed evidence. The [follow-up evidence](TRADECLOSEOUT_PRODUCTION_FOLLOWUP_EVIDENCE_2026-11-07.json) records current outcomes and stable source fingerprints.
