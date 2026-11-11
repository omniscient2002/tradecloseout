# Evidence, boundaries and replay

Source: `36c8efb94ce2ed77ef016ef58ad44d494bfc6e84`. Tests ran on 2026-11-11 UTC in an environment-local extracted candidate with Node22, pnpm12.4.1, PostgreSQL16, Redis, qpdf, unzip and Playwright Chromium. No application modifications are proposed. The documentation branch is based on main and is **not** the tested application candidate.

## Results and what they establish

| Check | Result | Evidence / boundary |
|---|---|---|
| Frozen dependency installation | PASS | [install.log](install.log); no lockfile regeneration |
| Typecheck and production build | PASS | [typecheck.log](typecheck.log), [build.log](build.log) |
| Clean workspace regressions | PASS | [test.log](test.log); API383/63 suites, shared71/5, DB13, worker31, archive/auth-storage browser10, PDF checks; run before adding the audit harness |
| Negative security and role matrix | PASS | [security.log](security.log) 15 tests; [rbac.log](rbac.log) 8 tests |
| API/worker actual-source observations | 45 observations / one Jest test | [probe-results.json](probe-results.json), [probes.log](probes.log); includes positive controls and rejected paths |
| Browser actual queue-module observations | 2 passing observation tests | [offline-results.json](offline-results.json), [offline-probes.log](offline-probes.log) |
| Existing selected application contracts | 6 PASS | [application-browser.log](application-browser.log), [execution record](application-browser-execution.json); two live auth flows, two function contracts, two intercepted-response browser flows |
| Portable evidence-directory replay | PASS | [portable-probes.log](portable-probes.log), [portable-offline.log](portable-offline.log), separate replay JSON files |
| Source GitHub CI metadata | success reported | [source-ci.json](source-ci.json); source app CI and group protocol; first-page PR-triggered run metadata, not external acceptance |
| Source inventory and scope | recorded | [source-inventory.json](source-inventory.json), [scope.json](scope.json), [prior-source-drift.json](prior-source-drift.json) |

The API harness uses actual service/worker functions, current sessions, restricted runtime PostgreSQL and a fresh randomly named database migrated by the administrator. It seeds only synthetic mechanical relationships. Upload signing/finalization receipts and clean scanner responses are explicitly synthetic fixtures. The new browser tests execute the actual queue and API-client modules, Chromium, IndexedDB and Blobs against a local HTTP protocol fixture. They do not use a real S3 provider or complete server workflow. Duplicate completion *requests* do not prove duplicate committed effects.

PDF probes use harmless bounded fixtures: an inert `void 0;` page action and a finite compressed-object inventory. No viewer JavaScript execution, malware or exploit delivery is attempted. R45 runs the actual incident CLI only against the disposable database and verifies rollback. Genuine engineering evidence, OEM coverage, legal consent and finance/provider acceptance are absent and remain explicit release gates.

## Read-only source verification

The inventory contains tracked source/spec/config blob identities; it is a file inventory, not executed coverage or a claim every line is proven correct. The reports reference exact pinned lines. AGENTS and collaboration policy references are pinned to main separately because they are absent from this older application branch.

Use an **isolated** checkout or `git archive` of the source SHA, copy this entire evidence directory into the same repository-relative location, and install frozen dependencies. Do not run these probes against a customer or production database. The database helper requires migrator create/drop privileges and checks runtime/migrator target consistency. Runtime queries must use the restricted `tc_app` role.

```bash
python docs/audits/remaining-phases-2026-11-12/evidence/verify-source.py /path/to/extracted-candidate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:security
pnpm test:rbac
```

Configure `APP_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `REDIS_URL` and `PLAYWRIGHT_BROWSERS_PATH` using environment-local test services; do not copy real secrets or print credentials. qpdf/unzip must be on PATH. Do not use the documentation branch's app source to reproduce a different candidate's observations.

## Replay the exact published harnesses

Run from the extracted candidate root. Outputs default to `/tmp`, or set the result variables to a safe scratch directory. These probes **record current behavior**, including defects; PASS means the observation harness completed without unexpected errors, not that the application passed a production requirement. After fixes, convert the relevant outcomes into asserting regression tests and update evidence for the new SHA.

```bash
pnpm --filter @tradecloseout/api exec jest --runInBand --config ../../docs/audits/remaining-phases-2026-11-12/evidence/jest.audit.config.cjs
pnpm --filter @tradecloseout/web exec playwright test --config ../../docs/audits/remaining-phases-2026-11-12/evidence/playwright.audit.config.ts
```

- [remaining-probes.spec.ts](remaining-probes.spec.ts): `R01`–`R45`; default result `/tmp/tradecloseout-remaining-probe-results.json`, override `REMAINING_PROBE_RESULTS`.
- [offline-probes.spec.ts](offline-probes.spec.ts): `B01`/`B02`; default result `/tmp/tradecloseout-remaining-offline-results.json`, override `OFFLINE_PROBE_RESULTS`.
- [run-application-browser.ts](run-application-browser.ts): run `pnpm exec tsx docs/audits/remaining-phases-2026-11-12/evidence/run-application-browser.ts` after build with ports3001/3002 available. Creates a disposable DB, boots actual production-built Next and API, executes only `E2E-G01` selected contracts, stops processes and cleans the DB. Uses explicit test-only OTP/delivery fixtures. Runtime logs default to `/tmp/tradecloseout-remaining-app-browser`, override `AUDIT_EXECUTION_DIR`; do not publish raw auth/OTP logs.

## Coverage and exclusions

Review followed the supplied group map across public controllers/DTOs, service transactions, shared domain code, schema/migrations, worker execution, frontend/queue modules, specifications, CI, infrastructure and operational scripts. Source-confirmed gaps are separately labeled; they are not runtime exploit demonstrations. Unwired alternative helpers are described as divergence/future wiring risk, without claiming a live HTTP bypass. Fixture-only and native status records never establish qualified business evidence.

No Terraform plan/apply, production deployment, real external delivery, genuine HVAC commissioning, legal signing, actual billing issuance/charging, full mobile survival test, complete core business browser E2E, real backup/PITR/object restore, independent security review or production load certification was performed. Those are acceptance tasks in the reports, not implicit successes. The checksum manifest proves bundle byte consistency, not author identity or trust of an entire replaced bundle.
