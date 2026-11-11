# Phase 1 execution evidence and reproduction contract

Primary assessed source: `9ed91a9e96c77c9eff967f6c845d18c38fb62ac6`. Main baseline:
`c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0`. G01 predecessor: `863e6e0c56ad4a92af2580fbcbfc179832056b2d`.
Node 22.23.4 / pnpm 12.4.1; local disposable PostgreSQL 16.15 and Redis 7;
runtime `tc_app`, checked non-superuser/NOBYPASSRLS by the DB helper. Frozen
dependencies were installed without changing the lockfile; an offline attempt lacked
metadata, and the normal online frozen install succeeded. No policy check was disabled.

## What was actually executed

From the original `/workspace/tradecloseout` main checkout:

```sh
pnpm build
pnpm test
```

Both passed. Main API: 28 suites / 249 tests. Main shared: 4 suites / 44 tests.
This main result does not verify the newer unmerged integration candidate.

From the archived PR #12 candidate with its own frozen installation and no source fixes:

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm --filter @tradecloseout/api test
pnpm test:security
pnpm test:rbac
pnpm --filter @tradecloseout/db test
pnpm --filter @tradecloseout/worker test
pnpm --filter @tradecloseout/web test
pnpm --filter @tradecloseout/api exec jest --runInBand test/g02-authorization-db.spec.ts test/g02-authorization-contract.spec.ts
pnpm --filter @tradecloseout/api exec jest --runInBand test/phase1-foundation-probes.spec.ts
```

- Candidate typecheck and build failed: existing review-authority test callers access
  fields not present on every branch of the new getVersionReviewDetail return type.
- Candidate workspace tests failed. The first workspace run included a developing
  audit harness and is not used as a clean repository test count. The harness was
  removed from normal test discovery before the clean API rerun: 10 suites failed,
  47 passed; 21 tests failed, 327 passed (57 suites / 348 tests). See checks.json.
- Security/RLS: 3 suites / 15 tests passed. RBAC helpers: 1 suite / 8 tests passed.
- DB: 10 checks passed, including fresh and prior-baseline upgrade/checksum tests.
- Worker: 16 tests passed. Browser archive/auth-storage fixtures: 10 tests passed.
- New G02 DB cases fail during seeding (missing required current_snapshot_id);
  a contract case conflicts with new denial-audit acquisition. These failures do
  not prove the intended control and must not be bypassed by weakening constraints.
- The final independent audit harness passed one Jest test with 25 local probes.
  It uses real migrated PostgreSQL, actual guards/services/interceptor, and real
  Redis for the lease overlap case. No engineering-readiness claim is made from
  synthetic authorisation fixtures or a REJECT decision on a synthetic pending review.

## Important limits and negative controls

This historical harness deliberately reproduces defects and includes assertions
that the recorded bad behavior occurs. Passing is evidence of reproduction, never
production acceptance. Convert findings into expected-safe regressions when fixing.
P07 confirms migration 0015 already permits PACKAGE_GENERATIONS; that early
hypothesis was withdrawn. P16 confirms a default audit partition exists; there is
no fabricated month-boundary insertion outage. P17 confirms transaction-local
tenant context clears. P08 is a negative-delta observation, not a claimed public
quota exploit. P13 is a transaction-helper context probe, not unauthenticated HTTP.

The portable publication harness was rerun successfully at the same source: one
Jest test / 25 probes. See portable-run-summary.txt.

No actual OTP/MFA enrollment secret is printed or retained in the JSON: the receipt
probe records only whether actual returned factor material was persisted. P09 uses
the literal value synthetic to test redaction. All tenant/user/project data is
disposable fixture data, not customer or approved HVAC engineering evidence.

The browser results exercise genuine IndexedDB/transfers against protocol fixtures,
not a deployed production API/HTTPS/MFA/provider journey. The current candidate build
blocks a clean fresh full application deployment; no security bypass or ignored TS
error was used to obtain a nominal production browser pass. Remote CI/provider,
independent human authority, actual deployment and release acceptance are unperformed.

## Reproduce the archived harness

Use Node 22/pnpm 12.4.1 and a source checkout/archive of the exact candidate. Copy
this evidence directory into the same docs/audits/phase1-2026-11-12/evidence path
in that checkout. Its portable imports resolve against that source, not main.
Install with pnpm install --frozen-lockfile. Configure MIGRATOR_DATABASE_URL and
APP_DATABASE_URL for local disposable PG16 (administrator create/drop permission;
restricted runtime role) and REDIS_URL for an isolated local Redis. Never use production.

```sh
pnpm --filter @tradecloseout/api exec jest --config ../../docs/audits/phase1-2026-11-12/evidence/jest.config.cjs --runInBand
```

Generated JSON goes to a temporary directory, or PHASE1_AUDIT_OUTPUT_DIR if set.
Run on a later fixed candidate expecting old defect assertions to change/fail.
The fixture partition probe targets the recorded 2026-11 month; update a dedicated
fixture/current-partition lookup for a later date and record that harness revision.
No production database or partition should ever be used for this test.
