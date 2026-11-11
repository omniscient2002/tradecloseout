# G03 audit evidence and reproduction

Exact application source: `863e6e0c56ad4a92af2580fbcbfc179832056b2d`, clean checkout `/tmp/tc-g01-implementation`. Documentation publication does not fix or accept that source. This assessment contains 23 OPEN findings: 20 with targeted runtime observations and three source-confirmed missing workflows. Preserve source/fixture/CI/independent/external acceptance distinctions.

`probe.cjs` is the executed script. `results.json` and `execution.txt` contain its final observations, timestamps, clean source state, runtime restricted role, 41 migration names/checksums and reusable-pool checks. `COMPLETED` denotes a returned operation, often an exposed defect; `REJECTED` denotes a caught operation failure. The script intentionally captures defects and its exit code is not a passing security-suite verdict. `finding-model.json` maps observations, source, corrections, acceptance and limits to the initial 23 IDs. `source-inventory.json` and `route-inventory.json` record selected source/service/UI and registered-route evidence, not exhaustive route-by-route behavioral proof.

The repository disposable helper creates/migrates a random database and drops only that database after the run. Administrative access seeds and inspects authorization-only fixtures; actual guards/services/API queries run as tc_app, non-superuser/no bypass RLS. The script stops its own API child. Existing loopback PostgreSQL/Redis are environment-local test services, not production.

The API child runs NODE_ENV=production with actual compiled controllers/guards/services/global filters/projection and strict CSRF/generation behavior. Sessions/MFA/identities are seeded fixtures. Traffic is loopback HTTP, with no deployed TLS/proxy/browser proof. Provider URLs are nondelivering. Invitation service adapters intentionally do not send mail. The seat-capacity probe alone uses the actual IdentityController with NODE_ENV=test, debug OTP and in-memory Redis to exercise invitation membership insertion; that is not strict-production login/provider acceptance.

Requirement/snapshot/PENDING review/PROCESSING object/CLOSED project fixtures are not a real reviewed HVAC baseline, approved evidence, valid external legal delegation or accepted project closure. No customer data, real provider credentials, actual invitation token outputs, OTPs, session headers or laptop .env/.aws/.codex files were imported or published. Test destinations and loopback credentials in the script/commands are environment-local fixtures.

`offboarding_and_role_change_lock_inversion` uses actual source transactions and independent restricted PG connections. Query wrappers only pause after the real session/member lock queries to arrange a deterministic schedule. PostgreSQL itself returns 40P01; no SQL result is mocked. The losing transaction rolls back and the pool remains usable. This is not a deployed concurrent HTTP/multi-node result.

## Commands and results

Working directory: `/tmp/tc-g01-implementation`. Temporary output directory: `/tmp/tc-g03-audit`.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH \
APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout \
MIGRATOR_DATABASE_URL=postgres://postgres:fix_disposable_pw@127.0.0.1:55439/tradecloseout \
DB_PORT=55439 NODE_ENV=test \
TS_NODE_PROJECT=/tmp/tc-g01-implementation/apps/api/tsconfig.json \
NODE_PATH=/tmp/tc-g01-implementation/node_modules:/tmp/tc-g01-implementation/apps/api/node_modules:/tmp/tc-g01-implementation/node_modules/.pnpm/node_modules \
node -r ts-node/register/transpile-only /tmp/tc-g03-audit/probe.cjs > /tmp/tc-g03-audit/execution.txt 2>&1
```

Final capture: exit 0. The script switches itself to production mode, except for the explicitly labeled seat-acceptance fixture section, and starts a production-mode API child on a random loopback port. Its HTTP child uses Redis at 127.0.0.1:56389 and PostgreSQL at 127.0.0.1:55439. The actual observations—not a blanket pass—are in results.json.

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH \
APP_DATABASE_URL=postgres://tc_app:app_local_pw@127.0.0.1:55439/tradecloseout \
MIGRATOR_DATABASE_URL=postgres://postgres:fix_disposable_pw@127.0.0.1:55439/tradecloseout \
DB_PORT=55439 NODE_ENV=test \
pnpm --filter @tradecloseout/api test --runTestsByPath \
  test/g01-member-invitation-authority-db.spec.ts \
  test/g01-invitation-db.spec.ts \
  test/g01-auth-session-transaction-fence-db.spec.ts \
  > /tmp/tc-g03-audit/existing-org-tests.txt 2>&1
```

Exit 0; 3 suites / 7 existing tests passed. These retain known controls but do not cover all G03 defects. No new full workspace, security/RLS, RBAC or browser-suite result is claimed.

The actual API/dependency build from the preceding G02 assessment used this same clean application SHA:

```sh
PATH=/tmp/tc-g01-node22-bin:$PATH pnpm --filter @tradecloseout/api... build
```

That build exited 0 (db/shared/PDF-engine/API) and its captured output is preserved as reused-g02-build.txt. All 180 emitted JS hashes in build-artifacts-sha256.txt were checked against the actual files before this G03 package was created. This is explicitly reused build provenance, not a fresh full web/worker build or new CI acceptance.

Exploratory runs first exposed a missing dashboard column for both Owner and Site. The final script adds direct source diagnostics and records PostgreSQL 42703. An initial branding probe included an empty legal name, so the database company-name constraint correctly prevented that write; the final probe uses a valid legal name to isolate unsupported state/color/logo/retention values and shows them persisted. The final run adds the deterministic lock-order probe. No application source/schema was modified, and no constraint was removed to obtain these observations.

The script intentionally pins the checkout/output paths above. Reproducing elsewhere requires a documented path substitution and the exact locked source/dependencies/services; another head must not be substituted while claiming the same result. New runs will have different fixture IDs/timestamps and may select a different deadlock victim while reproducing the same lock cycle.

`source-sha256.txt` covers selected tracked API/web/shared/database source, migrations/helper, requirements and lock/package files. `build-artifacts-sha256.txt` covers reused emitted JS. `SHA256SUMS` covers bundle bytes. These are integrity checks, not independent or external attestation. Missing deployed browser/provider/legal/retention acceptance remains blocked.
