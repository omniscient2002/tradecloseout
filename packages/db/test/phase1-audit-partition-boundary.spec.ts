import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withDisposableDatabase } from './helpers/disposable-database';
import { scoped, seedTenants } from './helpers/fixtures';

function isDenied(error: unknown): boolean {
  return (error as { code?: string })?.code === '42501';
}

async function assertRuntimeCannotUseChild(app: Pool, name: string, orgId: string): Promise<void> {
  // The identifier originates from pg_catalog and is still quoted in SQL.
  const qualified = 'public."' + name.replace(/"/g, '""') + '"';
  for (const sql of [
    `SELECT id FROM ${qualified} LIMIT 1`,
    `INSERT INTO ${qualified} DEFAULT VALUES`,
    `UPDATE ${qualified} SET action = action`,
    `DELETE FROM ${qualified}`,
    `TRUNCATE ${qualified}`,
  ]) {
    await assert.rejects(app.query(sql), isDenied,
      `Direct child access without tenant context must be denied: ${sql}`);
    await assert.rejects(scoped(app, orgId, client => client.query(sql)), isDenied,
      `Direct child access must remain denied even with valid tenant context: ${sql}`);
  }
}

async function assertPartitionContract(admin: Pool, name: string): Promise<void> {
  const { rows } = await admin.query(`
    SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           has_table_privilege('tc_app', c.oid, 'SELECT') AS can_select,
           has_table_privilege('tc_app', c.oid, 'INSERT') AS can_insert,
           has_table_privilege('tc_app', c.oid, 'UPDATE') AS can_update,
           has_table_privilege('tc_app', c.oid, 'DELETE') AS can_delete,
           has_table_privilege('tc_app', c.oid, 'TRUNCATE') AS can_truncate,
           EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = c.relname
                       AND p.policyname = 'phase1_audit_child_select') AS tenant_policy,
           EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = c.oid AND t.tgname = 'trg_phase1_audit_truncate'
                       AND NOT t.tgisinternal) AS truncate_guard
      FROM pg_class c JOIN pg_inherits i ON i.inhrelid=c.oid
     WHERE i.inhparent = 'public.audit_events'::regclass
       AND c.relname=$1
  `, [name]);
  assert.equal(rows.length, 1, `Expected attached audit child ${name}`);
  const row = rows[0];
  assert(row.rls && row.forced, `Audit child ${name} lacks forced RLS`);
  assert(row.tenant_policy, `Audit child ${name} lacks reviewed policy`);
  assert(row.truncate_guard, `Audit child ${name} lacks explicit TRUNCATE trigger`);
  for (const action of ['can_select', 'can_insert', 'can_update', 'can_delete', 'can_truncate']) {
    assert.equal(row[action], false, `Audit child ${name} unexpectedly grants ${action}`);
  }
}

async function asMigrator<T>(admin: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  let clean = false;
  try {
    await client.query('SET ROLE tc_migrator');
    const result = await work(client);
    await client.query('RESET ROLE');
    clean = true;
    return result;
  } finally {
    if (!clean) await client.query('RESET ROLE').catch(() => {});
    client.release(!clean);
  }
}

test('PH1-G26-001: fresh PG16 parent access and every existing/default child are tenant-safe and immutable', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a, b] } = await seedTenants(admin);
    const eventId = randomUUID();
    await scoped(app, a.orgId, async client => {
      const inserted = await client.query(`
        INSERT INTO audit_events
          (id,org_id,project_id,actor_type,action,entity_type,entity_id,request_id,created_at)
        VALUES ($1,$2,$3,'SYSTEM','G26_PARTITION_PROBE','PROJECT',$3,'g26-fresh','2026-11-15T10:00:00Z')
        RETURNING id`, [eventId, a.orgId, a.projectIds[0]]);
      assert.equal(inserted.rowCount, 1);
      assert.equal((await client.query('SELECT id FROM audit_events WHERE id=$1', [eventId])).rowCount, 1);
    });
    await assert.rejects(scoped(app, a.orgId, client =>
      client.query('UPDATE audit_events SET action=$1 WHERE id=$2',
        ['FORGED', eventId])), err => isDenied(err) || /AUDIT_IMMUTABLE/.test(String(err)));
    assert.equal((await app.query('SELECT id FROM audit_events WHERE id=$1', [eventId])).rowCount, 0);
    await scoped(app, b.orgId, async client => {
      assert.equal((await client.query('SELECT id FROM audit_events WHERE id=$1', [eventId])).rowCount, 0);
      await assert.rejects(client.query(`
        INSERT INTO audit_events (id,org_id,actor_type,action,entity_type,entity_id)
        VALUES ($1,$2,'SYSTEM','FORGED','PROJECT',$3)`,
      [randomUUID(), a.orgId, a.projectIds[0]]), isDenied);
    });
    const names = (await admin.query(`
      SELECT c.relname AS name
        FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
       WHERE i.inhparent='public.audit_events'::regclass ORDER BY c.relname
    `)).rows.map(row => String(row.name));
    assert(names.length >= 4);
    assert(names.includes('audit_events_default'));
    for (const name of names) {
      await assertPartitionContract(admin, name);
      await assertRuntimeCannotUseChild(app, name, a.orgId);
    }
  });
});

test('PH1-G26-001: future direct partitions and ATTACH are protected by defaults and migrator-only RLS provisioning', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a, b] } = await seedTenants(admin);
    const mayProvision = await admin.query(`
      SELECT has_function_privilege('tc_app',
        'public.phase1_create_audit_month_partition(integer,integer)', 'EXECUTE') AS allowed`);
    assert.equal(mayProvision.rows[0].allowed, false);
    await assert.rejects(app.query('SELECT public.phase1_create_audit_month_partition(2030,1)'), isDenied);

    await asMigrator(admin, async client => {
      // 0021 removes historical automatic DML grants: a newly-created table
      // must not expose data to tc_app even before it is attached.
      await client.query('CREATE TABLE public.phase1_g26_default_acl_canary (id integer)');
      for (const right of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const rights = await client.query(`
          SELECT has_table_privilege('tc_app', 'public.phase1_g26_default_acl_canary', $1) AS granted`,
        [right]);
        assert.equal(rights.rows[0].granted, false, `Future default privilege leaked ${right}`);
      }
      await client.query('DROP TABLE public.phase1_g26_default_acl_canary');

      const monthly = await client.query(
        'SELECT public.phase1_create_audit_month_partition(2030,1) AS name',
      );
      assert.equal(monthly.rows[0].name, 'audit_events_2030_01');

      // Exercise a *separately created and ATTACHED* child, not just the
      // convenience CREATE TABLE PARTITION OF path. Default ACL denies access
      // during the window before the reviewed hardener is applied.
      await client.query('CREATE TABLE public.audit_events_2031_02 (LIKE public.audit_events INCLUDING ALL)');
      await client.query(`
        ALTER TABLE public.audit_events ATTACH PARTITION public.audit_events_2031_02
        FOR VALUES FROM ('2031-02-01T00:00:00Z') TO ('2031-03-01T00:00:00Z')
      `);
    });
    await assertRuntimeCannotUseChild(app, 'audit_events_2031_02', a.orgId);
    await asMigrator(admin, async client => {
      const attached = await client.query(
        'SELECT public.phase1_create_audit_month_partition(2031,2) AS name',
      );
      assert.equal(attached.rows[0].name, 'audit_events_2031_02');
      // Maintenance is idempotent, so rerunning provisioning does not grant
      // rights or destroy a legitimate attachment.
      await client.query('SELECT public.phase1_create_audit_month_partition(2031,2)');
    });
    for (const name of ['audit_events_2030_01', 'audit_events_2031_02']) {
      await assertPartitionContract(admin, name);
      await assertRuntimeCannotUseChild(app, name, a.orgId);
    }

    // Newly created/attached monthly children remain usable *only through
    // the parent* by an authorised tenant, with the original hash metadata.
    const eventId = randomUUID();
    await scoped(app, a.orgId, async client => {
      await client.query(`
        INSERT INTO audit_events (id,org_id,actor_type,action,entity_type,entity_id,request_id,created_at)
        VALUES ($1,$2,'SYSTEM','FUTURE_PARTITION','PROJECT',$3,'g26-future','2031-02-12T00:00:00Z')
      `, [eventId, a.orgId, a.projectIds[0]]);
      assert.equal((await client.query('SELECT id FROM audit_events WHERE id=$1', [eventId])).rowCount, 1);
    });
    await scoped(app, b.orgId, async client => {
      assert.equal((await client.query('SELECT id FROM audit_events WHERE id=$1', [eventId])).rowCount, 0);
    });
  });
});

test('PH1-G26-001: real upgrade from pre-hardening SQL preserves older events and revokes existing partition access', async () => {
  let legacyOrg = '', legacyProject = '', legacyEvent = '';
  await withDisposableDatabase(async ({ admin, app }) => {
    assert(legacyOrg && legacyProject && legacyEvent, 'Legacy fixture not installed before migration');
    await assertPartitionContract(admin, 'audit_events_2026_11');
    const preserved = await scoped(app, legacyOrg, async client => client.query(
      'SELECT id,org_id,project_id,action FROM audit_events WHERE id=$1', [legacyEvent],
    ));
    assert.equal(preserved.rowCount, 1);
    assert.equal(preserved.rows[0].org_id, legacyOrg);
    assert.equal(preserved.rows[0].project_id, legacyProject);
    assert.equal(preserved.rows[0].action, 'PRE_UPGRADE_AUDIT_EVENT');
    await assertRuntimeCannotUseChild(app, 'audit_events_2026_11', legacyOrg);
    await assertPartitionContract(admin, 'audit_events_default');
  }, {
    baselineThrough: '0020_project_type_domain_alignment.sql',
    beforeUpgrade: async baseline => {
      const { tenants: [a] } = await seedTenants(baseline);
      legacyOrg = a.orgId;
      legacyProject = a.projectIds[0];
      legacyEvent = randomUUID();
      await baseline.query(`
        INSERT INTO audit_events
          (id,org_id,project_id,actor_type,action,entity_type,entity_id,request_id,created_at)
        VALUES ($1,$2,$3,'SYSTEM','PRE_UPGRADE_AUDIT_EVENT','PROJECT',$3,'legacy-g26','2026-11-18T00:00:00Z')
      `, [legacyEvent, legacyOrg, legacyProject]);
    },
  });
});
