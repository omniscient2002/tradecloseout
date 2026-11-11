# G02 targeted audit evidence

Source: `863e6e0c56ad4a92af2580fbcbfc179832056b2d`, clean checkout `/tmp/tc-g01-implementation`. All files in this folder were generated as local assessment artifacts and are published with the G02 documentation handoff. No application patch, new CI run, independent approval, real provider acceptance or production deployment is represented.

`results.json` contains final observed outcomes, applied migration names/checksums, source SHA/clean status, runtime role, timestamps and pool reuse. `execution.txt` is the same successful run's stdout. `COMPLETED` denotes returned operations, often exposing a defect; it is not a security-pass verdict. The probe catches individual rejection outcomes so an exit code of zero is not a green test-suite certification. Expected and observed behavior is interpreted per stable ID in the report.

The executed `probe.cjs` uses exact TS guards/controllers/services through ts-node and actual compiled API strict-production HTTP routes after the successful build below. It uses the repository disposable-database helper: creates a random test DB, migrates, seeds authorization-only data, queries through tc_app, stops its own API child and drops its own DB. Administrative access is used only for fixture setup/inspection. Seeded sessions/MFA/grants are not actual login, independent signatory or identity verification evidence. Minimal snapshots/requirements are not reviewed HVAC baselines; PROCESSING objects are not approved evidence. HTTP runs locally without deployed TLS, browsers or real providers. The script restores affected fixture rows before HTTP writes so linking/intake exercise fresh transitions. The project-removal probe deliberately schedules guard approval, committed removal and a stale-context service write; it is not a concurrent HTTP test.

The executed scripts intentionally pin `/tmp/tc-g01-implementation` and write results under `/tmp/tc-g02-audit`. Reproduction requires that exact clean source checkout and installed locked dependencies, or an explicitly documented path substitution. Do not substitute another application head while claiming these observations are reproduced. Reproduction runs will have new fixture IDs/timestamps.

Only environment-local fixture credentials appear in the command below. The loopback services already existed for this session; none are production services. No laptop .env/.aws/.codex files, customer data, actual invitation tokens, provider credentials or authorization headers were copied into this evidence.

## Final commands

Working directory for these commands was `/tmp/tc-g01-implementation`. Output destinations existed under `/tmp/tc-g02-audit`.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH pnpm --filter @tradecloseout/api... build > /tmp/tc-g02-audit/build.txt 2>&1
```

Exit 0; database/shared/PDF-engine dependencies and Nest API built. This is not a fresh complete web/worker production build.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH pnpm test:rbac > /tmp/tc-g02-audit/existing-rbac-tests.txt 2>&1
```

Exit 0; one existing helper suite, eight tests passed. This was a limited independent invocation, not the full workspace/security/browser suite.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH \
APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout \
MIGRATOR_DATABASE_URL=postgres://postgres:fix_disposable_pw@127.0.0.1:55439/tradecloseout \
DB_PORT=55439 NODE_ENV=test \
TS_NODE_PROJECT=/tmp/tc-g01-implementation/apps/api/tsconfig.json \
NODE_PATH=/tmp/tc-g01-implementation/node_modules:/tmp/tc-g01-implementation/apps/api/node_modules:/tmp/tc-g01-implementation/node_modules/.pnpm/node_modules \
node -r ts-node/register/transpile-only /tmp/tc-g02-audit/probe.cjs > /tmp/tc-g02-audit/execution.txt 2>&1
```

Exit 0 after the fresh build. The script switches its own runtime and spawned API to NODE_ENV=production, uses isolated test Redis at 127.0.0.1:56389 and nondelivering provider URLs, and records 41 migrated files. Runtime is tc_app, non-superuser/no bypass RLS; pool reusable=true. The complete observations are in results.json. No real scanner, storage upload/download or signing/payment/delivery was exercised.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH \
TS_NODE_PROJECT=/tmp/tc-g01-implementation/apps/api/tsconfig.json \
NODE_PATH=/tmp/tc-g01-implementation/node_modules:/tmp/tc-g01-implementation/apps/api/node_modules:/tmp/tc-g01-implementation/node_modules/.pnpm/node_modules \
node -r ts-node/register/transpile-only /tmp/tc-g02-audit/inventory.cjs > /tmp/tc-g02-audit/inventory-execution.txt 2>&1
```

Exit 0. The inventory is source reflection, not a route-by-route behavioral certification. 196 routes; 12 without SessionCsrfGuard; no protected business route missing permission metadata under the script's predicate. The field `explicit_public_count` counts routes without that guard, including independently authenticated webhook/receipt routes; its name does not certify unauthenticated safety. The capability-disagreement list compares key presence only, not scope equivalence.

The existing RBAC/inventory invocations preceded the final build/probe on unchanged tracked source. An exploratory fixture setup used the long ORM setting column name and failed; the final harness uses the real migrated column `doc_controller_org_wide_download`. No source/schema fix or bypass was made to obtain the final results.

`environment.json` records published_to_github=false at the original probe/packaging time, before the user subsequently authorized GitHub publication; that captured evidence is preserved. Publication does not change the observed source, probe results or acceptance status.

`source-sha256.txt` hashes the selected tracked API/shared/database source, migrations, helper and lock/package files. `build-artifacts-sha256.txt` hashes emitted JS from the fresh API/dependency build. `SHA256SUMS` hashes the evidence bundle files. Hash manifests are integrity aids, not external attestation.
