# PH1-G26-003 evidence

Tested source: local commit `39369323f8970320838eea246d61d6c6aa239ae7`.
Baseline: published PR #28, `b221170f3853b8994e0638f0509183db0f091c10`.
The publication PR identifies the final GitHub commit/tree and exact-head CI.
The source files' SHA-256 values are in `sha256.json`; the publication adds this
evidence without changing the tested application source or tests.

`baseline-reproduction.json` records actual original ORM SELECT-all queries
against the current migrated PostgreSQL schema: nine 42703 failures, column
drift in 34 tables, type drift in four and nullability drift in fifteen. The probe
loaded the original `packages/db/src/schema.ts` from the baseline Git blob next
to an isolated temporary script, used Drizzle `select().from(table).limit(1)`
against the task-owned migration-admin database and compared its definitions
with `pg_attribute`/`pg_attrdef`. Temporary copies were removed afterward. It
queried no external database and logged schema metadata/errors, never row data.

`catalog.json.gz` contains the full final fresh database catalog and summary of
the equal populated upgrade. Inspect with `gzip -dc catalog.json.gz`. Its
uncompressed SHA-256 is recorded in `summary.json`; it contains table/function
definitions and ACLs, no fixture/customer row values. Every category is compared
with the upgraded database by `readSchemaCatalog`, including columns, relation
ownership/RLS/partition metadata, constraints/FKs, indexes, policies, table/
sequence/schema/function/default grants and custom functions/triggers.

The final test records 72 tables / 925 ORM columns. Seventy actual SELECT-all
queries succeed as `tc_app`; `transmittals` and `transmittal_items` preserve
their existing 42501 ACL denials. Fourteen SQL-only root tables have explicit
owners/reasons in the test and `summary.json`. All 86 root tables and four audit
children remain in the SQL catalog. The protected runtime role is checked by the
standard disposable database helper; no SUPERUSER/BYPASSRLS runtime is allowed.

Local services are task-owned PostgreSQL 16 (`127.0.0.1:55443`) and Redis 7
(`127.0.0.1:56393`). Each DB test creates/drops its own random database using the
disposable administrator. Node 22.23.5, pnpm 12.4.1, qpdf 12.3.2, unzip and the
existing Playwright Chromium installation were used. No laptop authentication
files, production credentials, customer data or real provider keys were copied.

Exact command log mapping (run from the feature worktree):

| Log | Command |
|---|---|
| `install.log` | `pnpm install --frozen-lockfile --offline --store-dir /tmp/tco-phase1-pnpm-store` |
| `migrations.log` | `pnpm db:migrate` |
| `typecheck.log` | `pnpm typecheck` |
| `test-types-strict.log` | `pnpm --filter @tradecloseout/db exec tsc --noEmit --strict --esModuleInterop --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck test/phase1-orm-contract.spec.ts scripts/generate-orm.ts` |
| `build.log` | `pnpm build` |
| `orm-acceptance.log` | `ORM_CONTRACT_EVIDENCE_FILE=/tmp/tco-orm-catalog-final.json node --import tsx --test packages/db/test/phase1-orm-contract.spec.ts` |
| `generator-check.log` | `node --import tsx packages/db/scripts/generate-orm.ts --check` |
| `workspace.log` | `pnpm test` |
| `security.log` | `pnpm test:security` |
| `rbac.log` | `pnpm test:rbac` |

The initial focused test failures are retained separately. Their fixtures omitted
required `project_members.added_by` / `usage_counters.id` fields and assumed
incorrect project date/default fields; the test fixtures were corrected to the
actual catalog. Strict compilation also records the missing counter ID before
correction. No application constraint or grant was weakened. Early sandboxed
setup attempts were denied tsx IPC/loopback access (EPERM); the same commands were
rerun through the approved execution boundary against the same local fixtures.
Failed attempts are not counted as acceptance.

Database contract checks and root archive-browser tests do not establish a full
authenticated application browser journey, real provider acceptance or deployed
database operations. Independent per-ID review is pending. No merge/deployment
or formal original-finding acceptance is asserted by these implementation logs.
