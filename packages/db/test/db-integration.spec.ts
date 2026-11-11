import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { withDisposableDatabase, migrateDatabase } from './helpers/disposable-database';
import { scoped, seedTenants } from './helpers/fixtures';
import { reconcileStorageQuotaOnFileStatusChange } from '../src/tenant-tx';

void test('Disposable PostgreSQL migration, isolation and audit regression tests', async t => {
  await withDisposableDatabase(async ({ admin, app, url }) => {
    const { userId, tenants: [a, b] } = await seedTenants(admin);
    await t.test('DB-02: upgrading the 0005 baseline converges to the fresh schema', async () => {
      const schema = async (pool: typeof admin) => ({
        columns: (await pool.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
          FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows,
        constraints: (await pool.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' ORDER BY c.relname,k.conname`)).rows,
        policies: (await pool.query(`SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`)).rows,
      });
      const fresh = await schema(admin);
      await withDisposableDatabase(async ({ admin: upgraded }) => {
        assert.deepEqual(await schema(upgraded), fresh);
      }, { baselineThrough: '0005_add_project_contract_columns.sql' });
    });
    await t.test('DB-01: fresh ledger matches every actual SQL checksum, reruns and concurrent runners do not change it', async () => {
      const directory = path.resolve(__dirname, '../migrations');
      const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
      const before = (await admin.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name')).rows;
      assert.deepEqual(before.map(row => row.name), files);
      for (const row of before) assert.equal(row.checksum, createHash('sha256').update(await readFile(path.join(directory, row.name))).digest('hex'));
      await Promise.all([migrateDatabase(url), migrateDatabase(url)]);
      assert.deepEqual((await admin.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name')).rows, before);
    });
    await t.test('DB-03: mismatched and unknown ledger entries reject migration', async () => {
      const original = (await admin.query('SELECT name, checksum FROM schema_migrations ORDER BY name LIMIT 1')).rows[0];
      await admin.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', ['0'.repeat(64), original.name]);
      await assert.rejects(migrateDatabase(url), /MIGRATION_CHECKSUM_MISMATCH/);
      await admin.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [original.checksum, original.name]);
      await admin.query(`INSERT INTO schema_migrations (name, checksum, applied_at) VALUES ('unknown.sql', $1, now())`, ['0'.repeat(64)]);
      await assert.rejects(migrateDatabase(url), /UNKNOWN_APPLIED_MIGRATIONS/);
      await admin.query(`DELETE FROM schema_migrations WHERE name = 'unknown.sql'`);
    });
    await t.test('DB-06/07: real runtime role reads own tenant and rejects an otherwise valid foreign write with RLS SQLSTATE', async () => {
      assert.equal((await app.query('SELECT * FROM projects')).rowCount, 0);
      await scoped(app, a.orgId, async client => {
        const rows = (await client.query('SELECT id FROM projects ORDER BY id')).rows;
        assert.equal(rows.length, 2);
        assert.deepEqual(new Set(rows.map(row => row.id)), new Set(a.projectIds));
      });
      await assert.rejects(scoped(app, a.orgId, client => client.query(
        `INSERT INTO projects (id, org_id, code, name, created_by) VALUES ($1, $2, 'VALID_INSERT', 'Valid project', $3)`,
        [randomUUID(), b.orgId, userId],
      )), (error: any) => error.code === '42501' && /row-level security/.test(error.message));
      await scoped(app, a.orgId, async client => {
        assert.equal((await client.query('UPDATE projects SET name = $1 WHERE id = $2', ['Foreign mutation', b.projectIds[0]])).rowCount, 0);
      });
      assert.equal((await app.query('SELECT * FROM projects')).rowCount, 0);
    });
    await t.test('DB-10: tenant-table inventory catches disabled RLS as well as unforced RLS', async () => {
      const catalog = (await admin.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)`)).rows;
      // These are deliberately global platform/security ledgers, not tenant data tables.
      const global = new Set(['organisations']);
      const tenantTables = catalog.filter(row => !global.has(row.relname));
      assert(tenantTables.length > 30);
      for (const row of tenantTables) {
        assert(row.relrowsecurity, `${row.relname} has RLS disabled`);
        assert(row.relforcerowsecurity, `${row.relname} has unforced RLS`);
      }
    });
    await t.test('PH1-G26-001: direct audit partitions deny tc_app and enforce RLS', async () => {
      const partitions = (await admin.query(`
        SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
               has_table_privilege('tc_app', c.oid, 'SELECT') AS can_select,
               has_table_privilege('tc_app', c.oid, 'INSERT') AS can_insert,
               has_table_privilege('tc_app', c.oid, 'UPDATE') AS can_update,
               has_table_privilege('tc_app', c.oid, 'DELETE') AS can_delete,
               has_table_privilege('tc_app', c.oid, 'TRUNCATE') AS can_truncate
          FROM pg_inherits i
          JOIN pg_class c ON c.oid=i.inhrelid
         WHERE i.inhparent='public.audit_events'::regclass
         ORDER BY c.relname`)).rows;
      assert(partitions.length >= 4, 'Expected the three dated audit partitions and default');
      for (const child of partitions) {
        assert(child.rls && child.forced, `No enforced child RLS: ${child.relname}`);
        for (const privilege of ['can_select','can_insert','can_update','can_delete','can_truncate']) {
          assert.equal(child[privilege], false, `Direct child privilege: ${child.relname} ${privilege}`);
        }
        const childName = '"' + String(child.relname).replace(/"/g, '""') + '"';
        for (const sql of [
          `SELECT id FROM public.${childName} LIMIT 1`,
          `INSERT INTO public.${childName} DEFAULT VALUES`,
          `UPDATE public.${childName} SET action=action`,
          `DELETE FROM public.${childName}`,
          `TRUNCATE TABLE public.${childName}`,
        ]) {
          await assert.rejects(app.query(sql), (error: any) => error.code === '42501');
        }
      }
      // The adjacent AUDIT-02/03/04 test covers permitted parent insert/read.
    });

    await t.test('PH1-G26-002/G24-007: quota SQL commits typed bigint changes in real PG16', async () => {
      await scoped(app, a.orgId, async client => {
        await reconcileStorageQuotaOnFileStatusChange(client, a.orgId, 1234n, 'MARKED_READY');
        const read = async () => (await client.query(
          `SELECT value FROM usage_counters WHERE org_id=$1
            AND metric='STORAGE_BYTES' AND period='ALL_TIME'`, [a.orgId],
        )).rows[0].value;
        assert.equal(BigInt(await read()), 1234n);
        await reconcileStorageQuotaOnFileStatusChange(client, a.orgId, 234n, 'DELETED_OR_PURGED');
        assert.equal(BigInt(await read()), 1000n);
      });
      await scoped(app, b.orgId, async client => {
        assert.equal((await client.query(`SELECT value FROM usage_counters
          WHERE metric='STORAGE_BYTES' AND period='ALL_TIME'`)).rowCount, 0);
      });
    });

    await t.test('DB-08: direct cross-project procurement insert fails the intended composite FK', async () => {
      const partyId = randomUUID();
      await admin.query(`INSERT INTO parties (id, org_id, name, types) VALUES ($1, $2, 'Test supplier', ARRAY['SUPPLIER'])`, [partyId, a.orgId]);
      const poId = randomUUID();
      await admin.query(`INSERT INTO procurement_orders (id, org_id, project_id, po_number, supplier_party_id) VALUES ($1,$2,$3,'PO_TEST',$4)`, [poId, a.orgId, a.projectIds[0], partyId]);
      await assert.rejects(scoped(app, a.orgId, client => client.query(`INSERT INTO procurement_order_lines
        (id, org_id, project_id, po_id, line_no, asset_category_key, description)
        VALUES ($1,$2,$3,$4,1,'HVAC','Test line')`, [randomUUID(), a.orgId, a.projectIds[1], poId])),
        (error: any) => error.code === '23503' && error.constraint === 'procurement_order_lines_composite_po_fk');
    });
    await t.test('DB-07: shared catalogue rows are readable, foreign rows and global writes are blocked', async () => {
      const globalId = randomUUID();
      await admin.query(`INSERT INTO asset_categories (id,org_id,key,name) VALUES
        ($1,NULL,'SHARED','Global category'),($2,$3,'PRIVATE','Tenant B category')`, [globalId,randomUUID(),b.orgId]);
      await scoped(app, a.orgId, async client => {
        assert.deepEqual((await client.query('SELECT id FROM asset_categories')).rows, [{ id: globalId }]);
        assert.equal((await client.query(`UPDATE asset_categories SET name='Invalid change' WHERE id=$1`, [globalId])).rowCount, 0);
      });
      await assert.rejects(scoped(app, a.orgId, client => client.query(`INSERT INTO asset_categories (id,org_id,key,name)
        VALUES ($1,NULL,'FORGED','Invalid global')`, [randomUUID()])), (error: any) => error.code === '42501');
    });
    await t.test('AUDIT-02/03/04: nonempty chain rejects update/delete and detects privileged payload tampering', async () => {
      for (let index = 0; index < 3; index++) await scoped(app, a.orgId, client => client.query(`INSERT INTO audit_events
        (id, org_id, actor_type, action, entity_type, entity_id, after_json, request_id)
        VALUES ($1,$2,'SYSTEM','TEST_APPEND','PROJECT',$3,$4,'db-regression')`, [randomUUID(), a.orgId, a.projectIds[0], JSON.stringify({ index })]));
      const check = async () => (await admin.query(`SELECT chain_seq, prev_hash, hash,
        encode(digest(prev_hash || '||' || jsonb_build_object(
          'id',id,'org_id',org_id,'project_id',project_id,'actor_type',actor_type,'actor_user_id',actor_user_id,
          'action',action,'entity_type',entity_type,'entity_id',entity_id,'before_json',before_json,'after_json',after_json,
          'request_id',request_id,'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex') AS computed
        FROM audit_events WHERE org_id = $1 ORDER BY chain_seq`, [a.orgId])).rows;
      const events = await check();
      assert.equal(events.length, 3);
      events.forEach((event, index) => {
        assert.equal(event.hash, event.computed);
        if (index) assert.equal(event.prev_hash, events[index - 1].hash);
      });
      for (const mutation of ['UPDATE audit_events SET action = action', 'DELETE FROM audit_events']) {
        await assert.rejects(scoped(app, a.orgId, client => client.query(mutation)), /AUDIT_IMMUTABLE/);
      }
      // Simulate a privileged DDL attacker disabling both parent and cloned
      // child mutation controls. The verifier must still detect hash damage.
      await admin.query('ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable');
      await admin.query('ALTER TABLE audit_events DISABLE TRIGGER trg_phase1_audit_immutable');
      try { await admin.query(`UPDATE audit_events SET after_json = '{"tampered":true}' WHERE org_id = $1`, [a.orgId]); }
      finally {
        await admin.query('ALTER TABLE audit_events ENABLE TRIGGER trg_phase1_audit_immutable');
        await admin.query('ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable');
      }
      assert((await check()).every(event => event.hash !== event.computed));
    });
    await t.test('N30: canonical tenant alias validation rejects conflicting tenant settings', async () => {
      // 1. Both unset -> returns empty
      const unsetRows = (await app.query('SELECT * FROM procurement_orders')).rows;
      assert.equal(unsetRows.length, 0);

      // 2. Both equal -> valid access
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [a.orgId]);
        const rows = (await client.query('SELECT * FROM procurement_orders')).rows;
        assert(Array.isArray(rows));
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // 3. Different aliases -> throws TENANT_ALIAS_MISMATCH
      const mismatchClient = await app.connect();
      try {
        await mismatchClient.query('BEGIN');
        await mismatchClient.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $2, true)`, [a.orgId, b.orgId]);
        await assert.rejects(
          mismatchClient.query('SELECT * FROM procurement_orders'),
          /TENANT_ALIAS_MISMATCH/,
        );
        await mismatchClient.query('ROLLBACK');
      } finally {
        mismatchClient.release();
      }
    });
  });
});
