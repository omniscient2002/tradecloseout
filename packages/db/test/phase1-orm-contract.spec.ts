import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { is, SQL, eq } from 'drizzle-orm';
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../src/schema';
import { withDisposableDatabase } from './helpers/disposable-database';
import { scoped, seedTenants } from './helpers/fixtures';
import { readSchemaCatalog, type CatalogColumn } from './helpers/schema-catalog';

// These tables have dedicated raw-SQL consumers and no public Drizzle projection.
// An added table must be represented or explicitly reviewed here; never ignore drift.
const sqlOnlyTables = {
  audit_chain_positions: 'Protected registry; runtime has only the tenant-checked function.',
  audit_events: 'Partitioned append-only ledger written through the trusted audit transaction.',
  billing_tax_configs: 'Raw-SQL billing configuration, no ORM consumer.',
  bulk_import_jobs: 'Raw-SQL staged import workflow, no ORM consumer.',
  digital_signatures: 'Disabled signing integration; no ORM consumer.',
  invoice_sequences: 'Raw-SQL serialized invoice numbering.',
  mfa_attempt_budgets: 'Dedicated committed attempt-budget transactions.',
  mfa_enrollment_proposals: 'Dedicated session-generation-bound enrollment store.',
  mfa_recovery_codes: 'Dedicated one-use recovery store.',
  otp_challenges: 'Dedicated identity challenge store.',
  quality_inspections: 'Raw-SQL inspection workflow, no ORM consumer.',
  schema_migrations: 'Migration administrator ledger; never an application ORM model.',
  seasonal_commissioning_schedules: 'Raw-SQL aftercare workflow, no ORM consumer.',
  tab_worksheets: 'Raw-SQL TAB worksheet workflow, no ORM consumer.',
};

const tables = Object.entries(schema).map(([exportName, table]) => {
  assert(is(table, PgTable), `Unexpected ORM export: ${exportName}`);
  return { exportName, table, config: getTableConfig(table) };
});
const dialect = new PgDialect();
const normalizeType = (type: string) => type.replace(/\s+/g, '').toLowerCase();

async function checkProjections(admin: Pool, app: Pool, columns: CatalogColumn[], orgId: string) {
  assert.equal(new Set(tables.map(t => t.config.name)).size, tables.length);
  assert.deepEqual([...new Set(columns.map(c => c.table_name))].sort(),
    [...tables.map(t => t.config.name), ...Object.keys(sqlOnlyTables)].sort(),
    'Every root SQL table must have a projection or a documented SQL-only owner');
  let columnCount = 0;
  let runtimeQueries = 0;
  const denied: string[] = [];
  for (const { table, config } of tables) {
    const actual = columns.filter(column => column.table_name === config.name);
    assert.deepEqual(config.columns.map(column => column.name).sort(), actual.map(column => column.name).sort(),
      `${config.name}: missing or nonexistent ORM columns`);
    // Avoid misleading partial/incorrect DDL. Migrations are the sole DDL owner.
    for (const key of ['indexes', 'foreignKeys', 'checks', 'primaryKeys', 'uniqueConstraints', 'policies'] as const) {
      assert.equal(config[key].length, 0, `${config.name}: ${key} belong to SQL migrations`);
    }
    for (const column of config.columns) {
      const expected = actual.find(c => c.name === column.name)!;
      const field = `${config.name}.${column.name}`;
      assert.equal(normalizeType(column.getSQLType()), normalizeType(expected.type), `${field}: SQL type`);
      assert.equal(column.notNull, expected.not_null, `${field}: nullability`);
      assert.equal(column.primary, expected.primary_key, `${field}: primary-key identity`);
      assert.equal(column.hasDefault, expected.default_sql !== null, `${field}: default presence`);
      const defaultSql = is(column.default, SQL) ? dialect.sqlToQuery(column.default).sql : column.default ?? null;
      assert.equal(defaultSql, expected.default_sql, `${field}: default expression`);
      assert.equal(column.generated, undefined, `${field}: generated column needs explicit support`);
      columnCount++;
    }
    // These are actual Drizzle SELECT-all queries. Even empty tables resolve every
    // referenced name/type in PG, unlike a static manifest or hand-written SELECT 1.
    await drizzle(admin).select().from(table).limit(1);
    const allowed = (await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed',
      ['tc_app', `public.${config.name}`, 'SELECT'])).rows[0].allowed;
    if (allowed) {
      await scoped(app, orgId, client => drizzle(client).select().from(table).limit(1));
      runtimeQueries++;
    } else {
      await assert.rejects(drizzle(app).select().from(table).limit(1),
        (error: any) => (error.cause?.code ?? error.code) === '42501');
      denied.push(config.name);
    }
  }
  return { tables: tables.length, columns: columnCount, runtimeQueries, denied };
}

void test('PH1-G26-003: every ORM projection matches real fresh and upgraded PostgreSQL', async t => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a, b] } = await seedTenants(admin);
    const fresh = await readSchemaCatalog(admin);
    const results = await checkProjections(admin, app, fresh.columns, a.orgId);
    t.diagnostic(`Fresh PostgreSQL: ${JSON.stringify(results)}; SQL-only roots: ${Object.keys(sqlOnlyTables).length}`);

    await t.test('real ORM writes/reads preserve defaults, exact bigint, arrays, citext, dates and NULL', async () => {
      const memberId = randomUUID();
      const projectMemberId = randomUUID();
      const invitationId = randomUUID();
      await scoped(app, a.orgId, async client => {
        const db = drizzle(client);
        const [member] = await db.insert(schema.memberships).values({
          id: memberId, orgId: a.orgId, userId, role: 'R-OWNER',
        }).returning();
        assert.equal(member.status, 'ACTIVE');
        assert(member.createdAt instanceof Date);
        const [projectMember] = await db.insert(schema.projectMembers).values({
          id: projectMemberId, orgId: a.orgId, projectId: a.projectIds[0], userId, role: 'PM', addedBy: userId,
        }).returning();
        assert(projectMember.createdAt instanceof Date);
        assert(projectMember.updatedAt instanceof Date);
        const [invitation] = await db.insert(schema.invitations).values({
          id: invitationId, orgId: a.orgId, email: 'Orm@Example.invalid', phoneE164: '+919999999990',
          role: 'R-QC', invitedBy: userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
        }).returning();
        assert.equal(invitation.phoneE164, '+919999999990');
        // The actual citext operator remains case insensitive; it is not modeled as TEXT.
        assert.equal((await db.select().from(schema.invitations)
          .where(eq(schema.invitations.email, 'orm@example.invalid'))).length, 1);
        const [profile] = await db.insert(schema.orgProfiles).values({ orgId: a.orgId }).returning();
        assert.deepEqual(profile.addressJson, {});
        assert.equal(profile.signatoryName, null);
        assert.equal(profile.watermarkEnabled, false);
        const [usage] = await db.insert(schema.usageCounters).values({
          id: randomUUID(), orgId: a.orgId, metric: 'STORAGE_BYTES', period: 'ORM_PARITY', value: 9007199254740993n,
        }).returning();
        assert.equal(usage.value, 9007199254740993n);
        const [project] = await db.update(schema.projects).set({ retentionBps: 525,
          startDate: '2026-11-13', targetHandoverDate: null }).where(eq(schema.projects.id, a.projectIds[0])).returning();
        assert.equal(project.retentionBps, 525);
        assert.equal(project.startDate, '2026-11-13');
        assert.equal(project.targetHandoverDate, null);
        const [party] = await db.insert(schema.parties).values({ id: randomUUID(), orgId: a.orgId,
          name: 'ORM scope fixture', types: ['SUPPLIER'] }).returning();
        assert.deepEqual(party.types, ['SUPPLIER']);
      });
      await scoped(app, b.orgId, async client => {
        assert.equal((await drizzle(client).select().from(schema.projectMembers)
          .where(eq(schema.projectMembers.id, projectMemberId))).length, 0);
      });
    });

    await t.test('SQL constraints and tenant authority remain enforced on ORM writes', async () => {
      const state = (code: string) => (error: any) => (error.cause?.code ?? error.code) === code;
      await assert.rejects(scoped(app, a.orgId, client => drizzle(client).insert(schema.projects).values({
        id: randomUUID(), orgId: b.orgId, code: 'FOREIGN', name: 'Foreign', createdBy: userId,
      })), state('42501'));
      await assert.rejects(scoped(app, a.orgId, client => drizzle(client).insert(schema.projectMembers).values({
        id: randomUUID(), orgId: a.orgId, projectId: b.projectIds[0], userId, role: 'PM', addedBy: userId,
      })), state('23503'));
      await assert.rejects(scoped(app, a.orgId, client => drizzle(client).insert(schema.projects).values({
        id: randomUUID(), orgId: a.orgId, code: 'INVALID', name: 'Invalid', createdBy: userId, status: 'INVENTED',
      })), state('23514'));
    });

    await t.test('populated 0005 upgrade converges including all SQL security/constraint metadata and ORM queries', async () => {
      let legacy: Awaited<ReturnType<typeof seedTenants>>;
      let ledger: unknown[];
      await withDisposableDatabase(async ({ admin: upgraded, app: upgradedApp }) => {
        const catalog = await readSchemaCatalog(upgraded);
        assert.deepEqual(catalog, fresh);
        const upgradedResults = await checkProjections(upgraded, upgradedApp, catalog.columns, legacy.tenants[0].orgId);
        assert.deepEqual(upgradedResults, results);
        const rows = await scoped(upgradedApp, legacy.tenants[0].orgId, client =>
          drizzle(client).select().from(schema.projects));
        assert.deepEqual(new Set(rows.map(row => row.id)), new Set(legacy.tenants[0].projectIds));
        assert.deepEqual((await upgraded.query("SELECT name,checksum,applied_at FROM schema_migrations WHERE name <= '0005_add_project_contract_columns.sql' ORDER BY name")).rows, ledger);
        t.diagnostic(`Populated upgrade: ${JSON.stringify(upgradedResults)}; full catalog equal to fresh.`);
        if (process.env.ORM_CONTRACT_EVIDENCE_FILE) {
          await writeFile(process.env.ORM_CONTRACT_EVIDENCE_FILE, JSON.stringify({
            results, upgradedResults, sqlOnlyTables, catalog,
          }, null, 2) + '\n');
        }
      }, {
        baselineThrough: '0005_add_project_contract_columns.sql',
        beforeUpgrade: async baseline => {
          legacy = await seedTenants(baseline);
          ledger = (await baseline.query('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name')).rows;
        },
      });
    });
  });
});
