# PH1-G26-003: migrated SQL and ORM contract

This is the implementation handoff for original finding **PH1-G26-003**, based on
PR #28 at `b221170f3853b8994e0638f0509183db0f091c10`. It is a candidate repair
for independent review. The publication PR records the final source SHA and
exact-head CI; no independent acceptance, merge or deployment is asserted here.

## Reproduced failure and correction

The baseline's 72 represented tables were checked against a fresh PostgreSQL 16
database built from this branch's unchanged migrations. There were 34 tables
with missing/nonexistent columns, four with type differences, and fifteen with
nullability differences. Nine actual Drizzle SELECT-all queries failed with
undefined-column errors. These measurements replace the old audit's 33-table
count; the full before-results retain the actual table and field names.

`packages/db/src/schema.ts` now describes every migrated column of all 72
represented tables: 925 columns, including SQL types, nullability and exact
server default expressions. Missing fields are added and nonexistent fields are
removed. Renamed fields follow their actual SQL name: examples include
`phoneE164`, project-member `createdAt`/`updatedAt`, and version `uploaderComment`.
Other existing property names remain stable. Corrected SQL types include CITEXT,
BIGINT and DATE. BIGINT values use JavaScript bigint without Number conversion.

The schema is generated from a newly created disposable migrated database,
never from a production URL's existing schema. The existing exported table names
define the supported projection inventory. Generation preserves property names
for existing SQL columns and fails for unknown column types, missing represented
tables, duplicate properties or unexpected exports. It does not run implicitly
at application startup or write database DDL.

## One DDL authority and deliberate exclusions

Append-only SQL migrations own all database DDL. The ORM is an application column
projection, not a second migration source. Previously partial ORM foreign keys
and indexes could imply a different schema, including missing composite tenant
constraints. Those declarations are removed rather than silently treated as the
database definition. Do not use Drizzle schema push or migration generation on
these projections. No such workflow or relational-query consumer exists in this
repository. The full workspace build checks existing consumers of the exports.
The actual single-column primary-key identity is mirrored for Drizzle; its
constraint name and enforcement remain SQL-owned. Unexpected composite or absent
keys fail generation explicitly instead of being misrepresented.

All 86 root SQL tables are accounted for. Fourteen have dedicated raw-SQL stores
and deliberately have no Drizzle export: `audit_chain_positions`, `audit_events`,
`billing_tax_configs`, `bulk_import_jobs`, `digital_signatures`,
`invoice_sequences`, `mfa_attempt_budgets`, `mfa_enrollment_proposals`,
`mfa_recovery_codes`, `otp_challenges`, `quality_inspections`,
`schema_migrations`, `seasonal_commissioning_schedules`, and `tab_worksheets`.
The test contains per-table reasons and requires exact inventory equality;
adding a table requires an explicit projection or reviewed exclusion. Partitions
are SQL-owned children, not additional ORM models. Their definitions and ACLs
remain included in fresh/upgrade catalog comparison.

All 72 SELECT-all projections are executed against PostgreSQL. Seventy also run
under the verified restricted `tc_app` role. The two existing ACL-protected
transmittal tables are queried as migration administrator to validate their
projections, and actual runtime queries must fail with 42501. No grant is added
to turn them into successful runtime reads. This documents the existing ACL
boundary; it does not certify a transmittal application workflow.

## Original acceptance and retained evidence

| Original requirement | Verification |
|---|---|
| Columns/types/nullability/defaults | All represented fields match the real PG catalog; every supported table receives a real Drizzle SELECT-all query. |
| Constraints/indexes/FKs | All SQL PK/unique/check/FK definitions, deferrability and validation state, indexes and validity are inventoried and compared across fresh and upgraded schemas. These remain enforced in SQL. |
| Policies/grants | All public table/sequence ACLs, schema ACLs, default ACLs, RLS flags/policies, owners, triggers, custom functions and function ACLs are compared, including partition metadata. No runtime privilege changes. |
| Fresh/upgrade equivalence | A real populated 0005 baseline is upgraded with the actual migrator. The complete catalog must equal fresh. Historical ledger names/checksums/timestamps and legacy tenant project rows are preserved. Every supported ORM query also executes on the upgraded database. |
| Correct reads/writes | Restricted ORM writes exercise required fields, server defaults, JSON, text arrays, CITEXT case-insensitive matching, DATE/NULL and exact bigint beyond Number's safe range. Cross-tenant writes, wrong-project composite FKs and invalid status CHECKs still reject. |
| Repeatability | `generate-orm.ts --check` regenerates in memory against a separate disposable database and fails on source drift. The contract regression is automatically included in the existing DB/root test commands. |

Commands, before-results, final logs and catalog-only artifacts are retained in
`docs/evidence/phase1-g26-003-20261113/`. Authorization fixtures are synthetic
database metadata, not engineering documents or provider success receipts.

```sh
node --import tsx packages/db/scripts/generate-orm.ts --check
node --import tsx --test packages/db/test/phase1-orm-contract.spec.ts
pnpm --filter @tradecloseout/db exec tsc --noEmit --esModuleInterop --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck test/phase1-orm-contract.spec.ts scripts/generate-orm.ts
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm test
pnpm test:security
pnpm test:rbac
```

Use Node 22 / pinned pnpm 12.4.1 and the repository's disposable administrator
and restricted runtime URL contracts. Regeneration is an explicit developer
operation using the same first command with `--write`; review the resulting diff.
Unchanged historical migration checksums are verified by the existing DB suite.

## Review boundary

The independent reviewer should assess the full original G26-003 requirements,
the deliberate SQL-owned DDL boundary, corrected field/type contracts, every
SQL-only exclusion, both actual query inventories and populated upgrade evidence
at the published SHA. This repair does not resolve the separate ownership,
universal command-authority, queue recovery or production database operations
findings. No live provider or deployed database was used. The full authenticated
application browser journey is not claimed by database and archive-browser tests.
