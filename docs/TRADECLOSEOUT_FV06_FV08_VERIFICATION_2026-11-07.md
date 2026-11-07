# FV06–FV08 verification — 2026-11-07

## Result

**All three latest reported cases are repaired in independent reproductions.** The larger production programme is still incomplete; these results close the named regressions, not every acceptance condition in the [production implementation plan](TRADECLOSEOUT_PRODUCTION_AGENT_IMPLEMENTATION_PLAN_2026-11-07.md).

This supplements [the previous follow-up](TRADECLOSEOUT_PRODUCTION_FOLLOWUP_AND_NEXT_STEPS_2026-11-07.md). Historical documents were preserved. This review added only verification documents and used isolated database/Redis fixtures and inert local PDFs. No customer records, production deployment, real delivery or PDF action execution was involved.

## Independent recheck results

| Finding | Current result |
|---|---|
| **FV06: in-memory OTP expiry** | A challenge checked after a controlled 301-second clock advance now returns OTP_EXPIRED. The same controller/store accepts a fresh correct challenge through the challenge layer, enforces five requests before rate limiting, and preserves generation-safe cleanup. Session creation was intentionally stopped at a DB sentinel; these probes do not prove the complete delivery/login lifecycle. |
| **FV07: inline chained PDF action** | Both engine and worker fallbacks remove the tested Launch action behind an allowed URI action. The allowed annotation remains, its prohibited chained action does not, and catalog OpenAction is removed. The original direct-Launch fixture remains clean. No action was executed. |
| **FV08: compressed object ceiling** | The same one-page object-stream PDF is observed as **25,014 indirect objects** by both fallbacks. Both report `safe: false` above the **25,000** ceiling. The previous reported counts of 502 and 10 are replaced with the actual inventory. |

The existing qpdf-v2 counting fixture still reports **26,001** entries correctly. qpdf is absent locally, so this is a parser-layout fixture rather than an actual qpdf binary run.

The domain controls also held: actual PostgreSQL review submission persisted IN_REVIEW, the pending waiver appeared in the work queue, the default supplier grant used canonical profile fields, zero retention stayed zero, and an archive without observed size rejected.

## Executed verification

- `pnpm typecheck`: passed.
- Root `pnpm test`: passed.
- API: **25 suites / 213 tests**, up from 208.
- Shared: **4 suites / 44 tests**.
- Database: **9 behavioral subtests**, 10 including parent.
- Worker: **12 behavioral subtests**, 13 including parent.
- Browser: **6 archive-verifier tests**.
- PDF: **3 scripted checks**, plus the separate artifact probes above.
- `pnpm --filter @tradecloseout/api build`: passed; newly compiled identity code was used for the controller/store checks.

Four existing files changed since the previous verification: identity module, remediation tests, worker PDF compiler and shared PDF sanitizer. Inventoried source fingerprints stayed stable during this check. Unchanged guest privilege/decision HTTP routes were not independently rerun this pass; their regression tests passed and their relevant source remains unchanged.

## Remaining production acceptance and next work

No new failure was observed in these executed rechecks. This was not another full-project audit. The unchanged broader gaps in [PA01–PA32](TRADECLOSEOUT_PRODUCTION_CODE_AUDIT_2026-11-07.md) and the previous verification still require implementation or operating evidence.

1. **Finish A05 dependency remediation.** The dependency manifests/lockfile did not change in this slice. Resolve the previously recorded advisory paths with compatibility/reachability checks; this pass did not rerun the registry audit.
2. **Finish A06–A08 reliability foundations.** Atomic business/audit/outbox/command outcomes, durable job reconciliation, failure recovery and parser/transfer/temp-space budgets remain. Correct post-parse object counting does not itself bound memory/CPU already consumed while parsing; enforce process-level limits and actual tool-image acceptance.
3. **Prove the R2/R3 integrated journey.** Run the actual application browser → API → versioned storage → ClamAV → worker → independent review → package download → authorized acceptance flow. Include installed qpdf, realistic files, process/Redis failures, observable terminal states and independently hashed downloaded/restored bytes.
4. **Complete production configuration and operation.** Validate required startup configuration/runtime role/capabilities, readiness, release/rollback, monitoring/alerts, resource fairness, restore and workload envelopes. No production deployment, load or restore acceptance was certified by this pass.
5. **Continue the deep HVAC packages A11–A17.** Persisted reviewed imports, material/serial trace, approved inspection/TAB procedures, witness/calibration/retest, functional/seasonal return visits, sectional aftercare/commercial evidence and their connected user interfaces remain larger product work.

Keep the now-passing FV01–FV08 fixtures as regression controls when implementing those packages. Mark work complete only with its API/UI/schema and failure-path acceptance, not solely from a rising test count.

Exact outputs, harness sources and source hashes are retained in [the evidence file](TRADECLOSEOUT_FV06_FV08_EVIDENCE_2026-11-07.json).
