# G03 local audit evidence

Reviewed source: `c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`.

These are audit reproductions, not fixed-behaviour regression tests. The archived
harness deliberately expects some defective behaviour at the reviewed source. Do
not use a passing reproduction as production acceptance. Convert findings into
positive/negative regression tests when implementing fixes; later corrected source
is expected to invalidate the corresponding historical defect assertions.

## Recorded validation

- Node 22.23.4, pnpm 12.4.1, PostgreSQL 16.15; restricted `tc_app` role.
- `pnpm typecheck`: passed; output in `typecheck.txt`.
- Existing suites: 4 passed, 72 tests; output in `existing-tests.txt`.
- Reproduction harness: one Jest test containing 34 probes, passed; individual
  observations in `probe-results.json`, original output in `probes.txt`.
- The database helper creates and migrates a fresh random disposable database,
  verifies the runtime role is not superuser/BYPASSRLS, and removes only that DB.
- Fixture identities/data are synthetic. Service/guard probes are not a deployed
  HTTP/browser test or real email/SMS/provider acceptance.

Original commands, from the repository root after activating Node 22/pnpm 12.4.1:

```sh
pnpm typecheck
pnpm --filter @tradecloseout/api exec jest --runInBand test/modules/auth-iam.spec.ts test/discovery-lifecycle-foundations.spec.ts test/hvac-production-reaudit-remediation.spec.ts test/production-reaudit-remediation.spec.ts
pnpm --filter @tradecloseout/api exec jest --config /workspace/work/g03-audit/jest.config.cjs --runInBand
```

The last command used the original session-local harness. The adjacent version
preserves the probes but replaces absolute imports/configuration with paths relative
to this repository, and writes generated JSON to a temporary directory by default.
To reproduce this portable version on the reviewed source plus these audit files:

```sh
# Set MIGRATOR_DATABASE_URL and APP_DATABASE_URL to environment-local disposable
# PostgreSQL 16 services. The administrator must create/drop disposable databases;
# runtime access must use the restricted application role. Never use production.
pnpm --filter @tradecloseout/api exec jest --config ../../docs/groups/G03/evidence/jest.config.cjs --runInBand
```

Optionally set `G03_AUDIT_OUTPUT_DIR` to select a writable evidence directory.
The captured output retains original session paths; it is not a new remote CI run.
No build/full-workspace/security/browser/provider/deployment acceptance is claimed.

Negative controls confirm sequential last-owner demotion is blocked, a second owner
is rejected by the existing index, tenant mismatch is denied and cross-tenant profile
rows are hidden by RLS. Preserve these controls while fixing the remaining gaps.

The G03 register remains OPEN/NO_GO. Adding the audit does not enable G03 coordinator
dispatch or alter the existing G01 coordination policy.
