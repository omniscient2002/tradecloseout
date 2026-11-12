import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { withDisposableDatabase } from './helpers/disposable-database';
import { seedTenants } from './helpers/fixtures';
import { withTenantTransaction } from '../src/tenant-tx';

type Settings = { org?: string; alias?: string; user?: string; token?: string };
const denied = (error: any) => ['22000', '22023', '42501'].includes(error?.code);
const identifier = (name: string) => 'public."' + name.replace(/"/g, '""') + '"';

async function context<T>(pool: Pool, settings: Settings, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org',$1,true),
      set_config('app.current_org_id',$2,true), set_config('app.current_user',$3,true),
      set_config('app.current_token_hash',$4,true)`,
    [settings.org ?? '', settings.alias ?? '', settings.user ?? '', settings.token ?? '']);
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function seedDiscovery(admin: Pool) {
  const fixture = await seedTenants(admin);
  const { userId, tenants: [a, b] } = fixture;
  for (const tenant of [a, b]) {
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role)
      VALUES ($1,$2,$3,'R-OWNER')`, [randomUUID(), tenant.orgId, userId]);
  }
  const otherUser = randomUUID();
  await admin.query(`INSERT INTO users(id,name,status) VALUES ($1,'Other principal','ACTIVE')`, [otherUser]);
  await admin.query(`INSERT INTO memberships(id,org_id,user_id,role)
    VALUES ($1,$2,$3,'R-PM')`, [randomUUID(), b.orgId, otherUser]);
  const party = randomUUID();
  await admin.query(`INSERT INTO parties(id,org_id,name,types)
    VALUES ($1,$2,'Authorization fixture',ARRAY['SUPPLIER'])`, [party, a.orgId]);
  const token = 'a'.repeat(64);
  const guestId = randomUUID();
  await admin.query(`INSERT INTO guest_grants
    (id,org_id,project_id,party_id,grant_type,role,capabilities,token_hash,expires_at,created_by,target_email)
    VALUES ($1,$2,$3,$4,'SUPPLIER_UPLOAD','SUPPLIER',ARRAY['UPLOAD'],$5,now()+interval '1 day',$6,'fixture@example.invalid')`,
  [guestId,a.orgId,a.projectIds[0],party,token,userId]);
  await admin.query(`INSERT INTO invitations(id,org_id,email,role,token_hash,expires_at,invited_by)
    VALUES ($1,$2,'fixture@example.invalid','R-PM',$3,now()+interval '1 day',$4)`,
  [randomUUID(),a.orgId,token,userId]);
  await admin.query(`INSERT INTO asset_categories(id,org_id,key,name) VALUES
    ($1,NULL,'BOUNDARY_GLOBAL','Global fixture'),($2,$3,'BOUNDARY_TENANT','Tenant fixture')`,
  [randomUUID(),randomUUID(),a.orgId]);
  return { ...fixture, otherUser, token, guestId };
}

test('PH1-G26-007: canonical tenant acceptance on fresh PostgreSQL 16', async t => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a,b], token, guestId } = await seedDiscovery(admin);
    const matched = { org:a.orgId, alias:a.orgId };
    const conflicting = { org:a.orgId, alias:b.orgId, user:userId, token };

    await t.test('both legacy spellings, equal UUID values, absent and malformed context', async () => {
      for (const settings of [matched, {org:a.orgId}, {alias:a.orgId},
        {org:a.orgId.toUpperCase(),alias:a.orgId}]) {
        await context(app, settings, async client => {
          assert.equal((await client.query('SELECT public.current_app_org_id() AS id')).rows[0].id,a.orgId);
          assert.equal((await client.query('SELECT id FROM projects')).rowCount,2);
        });
      }
      await context(app, {}, async client => {
        assert.equal((await client.query('SELECT public.current_app_org_id() AS id')).rows[0].id,null);
        assert.equal((await client.query('SELECT id FROM projects')).rowCount,0);
      });
      for (const settings of [conflicting,{org:'not-a-uuid',alias:a.orgId},{alias:'not-a-uuid'}]) {
        await assert.rejects(context(app, settings, client => client.query('SELECT public.current_app_org_id()')), error => {
          assert(denied(error));
          assert(!String(error).includes(a.orgId) && !String(error).includes('not-a-uuid'), 'error discloses setting');
          return true;
        });
      }
    });

    await t.test('catalogue proof and real restricted SELECT/UPDATE/DELETE on EVERY tenant table and partition', async () => {
      const tables = (await admin.query(`SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,
        has_table_privilege('tc_app',c.oid,'SELECT') AS readable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS
        (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped)
        ORDER BY c.relname`)).rows;
      assert(tables.length > 60);
      const policies = (await admin.query(`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
        FROM pg_policies WHERE schemaname='public'`)).rows;
      const catalogueTables = new Set(['config_versions','asset_categories','notification_templates','retention_policies']);
      for (const table of tables) {
        assert(table.relrowsecurity && table.relforcerowsecurity, table.relname);
        const entries = policies.filter(p => p.tablename === table.relname);
        const guard = entries.find(p => p.policyname === 'canonical_tenant_context');
        assert(guard, `${table.relname}: missing context guard`);
        assert.equal(guard.permissive,'RESTRICTIVE');
        assert.equal(guard.roles,'{tc_app}');
        assert.equal(guard.cmd,'ALL');
        assert.equal(guard.qual,'app_tenant_context_is_valid()');
        assert.equal(guard.with_check,'app_tenant_context_is_valid()');
        for (const p of entries.filter(p => p !== guard)) {
          assert(!/app\.current_org/.test((p.qual??'')+(p.with_check??'')), `${table.relname}: raw alias`);
          if (p.policyname === 'audit_chain_positions_migrator') {
            assert.equal(table.relname,'audit_chain_positions');
            assert.equal(p.roles,'{tc_migrator}');
            assert.equal(table.readable,false);
          } else if (p.policyname === 'memberships_self_discovery') {
            assert.equal(table.relname,'memberships');
            assert.equal(p.cmd,'SELECT');
            assert.equal(p.qual,"(user_id = (NULLIF(current_setting('app.current_user'::text, true), ''::text))::uuid)");
          } else if (p.policyname === 'guest_grants_token_lookup') {
            assert.equal(table.relname,'guest_grants');
            assert.equal(p.cmd,'SELECT');
            assert.equal(p.qual,"((token_hash = NULLIF(current_setting('app.current_token_hash'::text, true), ''::text)) AND (status = 'ACTIVE'::text) AND (expires_at > now()))");
          } else if (p.policyname === 'shared_catalogue_read') {
            assert(catalogueTables.has(table.relname));
            assert.equal(p.cmd,'SELECT');
            assert.equal(p.qual,'((org_id IS NULL) OR (org_id = current_app_org_id()))');
          } else {
            assert.equal(p.qual,'(org_id = current_app_org_id())', `${table.relname}/${p.policyname}`);
            if (p.cmd === 'ALL') assert.equal(p.with_check,'(org_id = current_app_org_id())');
            else assert.equal(p.cmd,'SELECT', `${table.relname}: unreviewed command`);
          }
        }
        // The table inventory comes from PostgreSQL, includes direct child names,
        // and never skips ACL-denied protected tables. Empty tables still receive
        // exact predicate/role/command assertions above; seeded positives below
        // exercise actual USING and WITH CHECK behavior, rather than mistaking
        // zero rows on an empty relation for proof of a policy.
        for (const settings of [{},conflicting,{org:'malformed'},matched,{alias:b.orgId}]) {
          const active = settings === matched ? a.orgId : 'alias' in settings && settings.alias === b.orgId && !('org' in settings) ? b.orgId : undefined;
          for (const command of ['SELECT','UPDATE','DELETE']) {
            const sql = command === 'SELECT'
              ? `SELECT org_id FROM ${identifier(table.relname)} WHERE org_id IS NOT NULL`
              : command === 'UPDATE'
                ? `UPDATE ${identifier(table.relname)} SET org_id=org_id WHERE ($1::uuid IS NULL OR org_id<>$1) RETURNING org_id`
                : `DELETE FROM ${identifier(table.relname)} WHERE ($1::uuid IS NULL OR org_id<>$1) RETURNING org_id`;
            try {
              const result = await context(app, settings, client => client.query(sql,command==='SELECT'?[]:[active??null]));
              if (command === 'SELECT' && active) assert(result.rows.every(row=>row.org_id===active),table.relname);
              else assert.equal(result.rowCount,0,`${table.relname}/${command}: leaked/modified tenant data`);
            } catch (error) {
              // The audit parent's statement trigger rejects even zero-row
              // mutations. That is an immutable-ledger denial, separately from
              // tenant enforcement. No constraint/aborted-transaction errors
              // qualify as evidence of a protected operation.
              const immutable = table.relname === 'audit_events' && command !== 'SELECT' &&
                (error as any)?.code === 'P0001' && String(error).includes('AUDIT_IMMUTABLE:');
              if (!denied(error) && !immutable) throw error;
              if (command==='SELECT' && table.readable && active) throw error;
            }
          }
        }
      }
      t.diagnostic(`Inventoried and executed 15 restricted operations on each of ${tables.length} actual tenant relations: ${tables.map(r=>r.relname).join(', ')}`);
    });

    await t.test('self memberships discovered across orgs; writes require the active tenant', async () => {
      await context(app,{user:userId},async client=>{
        assert.equal((await client.query('SELECT id FROM memberships')).rowCount,2);
        assert.equal((await client.query('DELETE FROM memberships RETURNING id')).rowCount,0);
        assert.equal((await client.query("UPDATE memberships SET role='R-OWNER' RETURNING id")).rowCount,0);
      });
      await context(app,{...matched,user:userId},async client=>{
        assert.equal((await client.query('SELECT id FROM memberships')).rowCount,2);
        assert.equal((await client.query('DELETE FROM memberships WHERE org_id=$1 RETURNING id',[b.orgId])).rowCount,0);
        assert.equal((await client.query("UPDATE memberships SET role='R-PM' WHERE org_id=$1 RETURNING id",[a.orgId])).rowCount,1);
      });
      await assert.rejects(context(app,conflicting,client=>client.query('SELECT * FROM memberships')),denied);
    });

    await t.test('explicit organisation bootstrap works with the legacy single alias, without a self-write exception',async()=>{
      const org=randomUUID();
      const principal=randomUUID();
      await context(app,{org,user:principal},async client=>{
        await client.query("INSERT INTO users(id,name,status) VALUES ($1,'Bootstrap fixture','ACTIVE')",[principal]);
        await client.query(`INSERT INTO organisations(id,legal_name,display_name,state)
          VALUES ($1,'Bootstrap fixture','Bootstrap fixture','MH')`,[org]);
        await client.query('INSERT INTO org_profiles(org_id) VALUES ($1)',[org]);
        await client.query(`INSERT INTO memberships(id,org_id,user_id,role)
          VALUES ($1,$2,$3,'R-OWNER')`,[randomUUID(),org,principal]);
        assert.equal((await client.query('SELECT id FROM memberships WHERE org_id=$1',[org])).rowCount,1);
      });
      await assert.rejects(context(app,{user:userId},client=>client.query(`INSERT INTO memberships(id,org_id,user_id,role)
        VALUES ($1,$2,$3,'R-PM')`,[randomUUID(),a.orgId,userId])),denied);
    });

    await t.test('guest bootstrap remains read-only, active and unexpired; invitations stay tenant-scoped', async () => {
      await context(app,{token},async client=>{
        assert.deepEqual((await client.query('SELECT id FROM guest_grants')).rows,[{id:guestId}]);
        assert.equal((await client.query('SELECT id FROM invitations')).rowCount,0);
        assert.equal((await client.query("UPDATE guest_grants SET status='REVOKED' RETURNING id")).rowCount,0);
        assert.equal((await client.query('DELETE FROM guest_grants RETURNING id')).rowCount,0);
        assert.equal((await client.query('DELETE FROM invitations RETURNING id')).rowCount,0);
        // The actual guest exchange binds BOTH aliases after token discovery.
        await client.query(`SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)`,[a.orgId]);
        assert.equal((await client.query('SELECT id FROM invitations')).rowCount,1);
        assert.equal((await client.query('UPDATE guest_grants SET failed_otp_count=failed_otp_count+1 RETURNING id')).rowCount,1);
      });
      await context(app,{token:'b'.repeat(64)},async client=>assert.equal((await client.query('SELECT * FROM guest_grants')).rowCount,0));
      for (const update of ["status='REVOKED'","status='ACTIVE', expires_at=now()-interval '1 day'"]) {
        await admin.query(`UPDATE guest_grants SET ${update} WHERE id=$1`,[guestId]);
        await context(app,{token},async client=>assert.equal((await client.query('SELECT * FROM guest_grants')).rowCount,0));
      }
      await admin.query("UPDATE guest_grants SET status='ACTIVE', expires_at=now()+interval '1 day' WHERE id=$1",[guestId]);
      await assert.rejects(context(app,conflicting,client=>client.query('SELECT * FROM guest_grants')),denied);
    });

    await t.test('real WITH CHECK on valid inserts and tenant transfers; shared catalogue stays immutable globally',async()=>{
      for (const settings of [{},conflicting,matched]) {
        await assert.rejects(context(app,settings,client=>client.query(`INSERT INTO projects
          (id,org_id,code,name,created_by) VALUES ($1,$2,'FOREIGN','Authorization fixture',$3)`,[randomUUID(),b.orgId,userId])),denied);
      }
      await context(app,matched,async client=>{
        assert.equal((await client.query(`INSERT INTO projects(id,org_id,code,name,created_by)
          VALUES ($1,$2,'OWN','Authorization fixture',$3) RETURNING id`,[randomUUID(),a.orgId,userId])).rowCount,1);
      });
      await assert.rejects(context(app,matched,client=>client.query('UPDATE projects SET org_id=$1 WHERE id=$2',[b.orgId,a.projectIds[0]])),denied);
      await context(app,{},async client=>{
        assert.equal((await client.query("SELECT id FROM asset_categories WHERE key LIKE 'BOUNDARY_%'")).rowCount,1);
        assert.equal((await client.query("DELETE FROM asset_categories WHERE org_id IS NULL RETURNING id")).rowCount,0);
      });
      await assert.rejects(context(app,{},client=>client.query(`INSERT INTO asset_categories(id,key,name)
        VALUES ($1,'BOUNDARY_NEW_GLOBAL','Must be denied')`,[randomUUID()])),denied);
      await assert.rejects(context(app,conflicting,client=>client.query('SELECT * FROM asset_categories')),denied);
    });

    await t.test('all custom SECURITY DEFINER functions and future partition provisioner preserve their boundaries',async()=>{
      const definers=(await admin.query(`SELECT p.oid::regprocedure::text AS signature,
        has_function_privilege('tc_app',p.oid,'EXECUTE') AS executable,pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef ORDER BY 1`)).rows;
      assert.deepEqual(definers.map(r=>[r.signature,r.executable]),[
        ['phase1_audit_expected_head(uuid)',true],['phase1_register_audit_position()',false]]);
      assert(definers.every(r=>!r.definition.includes('app.current_org')));
      await context(app,matched,async client=>assert.equal((await client.query('SELECT * FROM public.phase1_audit_expected_head($1)',[a.orgId])).rowCount,1));
      for (const settings of [{},conflicting,{org:b.orgId}]) {
        await assert.rejects(context(app,settings,client=>client.query('SELECT * FROM public.phase1_audit_expected_head($1)',[a.orgId])),denied);
      }
      await assert.rejects(app.query('SELECT public.phase1_create_audit_month_partition(2035,2)'),denied);
      await admin.query('SET ROLE tc_migrator');
      try { await admin.query('SELECT public.phase1_create_audit_month_partition(2035,2)'); }
      finally { await admin.query('RESET ROLE'); }
      const future=(await admin.query(`SELECT policyname,qual,with_check,permissive FROM pg_policies
        WHERE tablename='audit_events_2035_02' ORDER BY policyname`)).rows;
      assert.equal(future.length,2);
      assert.equal(future[0].policyname,'canonical_tenant_context');
      assert.equal(future[0].permissive,'RESTRICTIVE');
      assert.equal(future[1].qual,'(org_id = current_app_org_id())');
      for (const settings of [{},matched,conflicting]) {
        await assert.rejects(context(app,settings,client=>client.query('SELECT * FROM public.audit_events_2035_02')),denied);
      }
    });

    await t.test('real single-connection pool clears transaction context after commit, rollback and a SQL error',async()=>{
      const single=new Pool({...app.options,max:1});
      const actor={orgId:a.orgId,userId,actorType:'SYSTEM' as const,requestId:randomUUID()};
      try {
        const pids=new Set<number>();
        for (const mode of ['commit','rollback','sql-error']) {
          const work=()=>withTenantTransaction(single,actor,async client=>{
            pids.add((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
            await client.query("SELECT set_config('app.current_token_hash',$1,true)",[token]);
            assert.equal((await client.query('SELECT id FROM projects')).rowCount,2);
            if(mode==='rollback') throw new Error('CALLBACK_ROLLBACK');
            if(mode==='sql-error') await client.query('SELECT 1/0');
          });
          if(mode==='commit') await work(); else await assert.rejects(work);
          const clean=await single.query(`SELECT pg_backend_pid() AS pid,
            public.current_app_org_id() AS org, nullif(current_setting('app.current_user',true),'') AS actor,
            nullif(current_setting('app.current_token_hash',true),'') AS token`);
          pids.add(clean.rows[0].pid);
          assert.equal(clean.rows[0].org,null);assert.equal(clean.rows[0].actor,null);assert.equal(clean.rows[0].token,null);
          assert.equal((await single.query('SELECT id FROM projects')).rowCount,0);
          await context(single,{alias:b.orgId},async client=>assert.equal((await client.query('SELECT id FROM projects')).rowCount,2));
        }
        assert.equal(pids.size,1,'must prove reuse of the same backend');
      } finally { await single.end(); }
    });
  });
});

test('PH1-G26-007: reproduce both defects before a real populated 0045→0046 upgrade, preserving original ledger',async t=>{
  let fixture: Awaited<ReturnType<typeof seedDiscovery>>;
  let ledger: unknown;
  await withDisposableDatabase(async({admin,app})=>{
    assert.deepEqual((await admin.query("SELECT name,checksum,applied_at FROM schema_migrations WHERE name<'0046' ORDER BY name")).rows,ledger);
    const {userId,tenants:[a,b]}=fixture;
    await assert.rejects(context(app,{org:a.orgId,alias:b.orgId},client=>client.query('SELECT * FROM projects')),denied);
    await context(app,{user:userId},async client=>{
      assert.equal((await client.query('SELECT * FROM memberships')).rowCount,2);
      assert.equal((await client.query('DELETE FROM memberships RETURNING id')).rowCount,0);
    });
    assert.equal((await admin.query('SELECT * FROM memberships')).rowCount,3,'upgrade preserves memberships');
    assert.equal((await admin.query('SELECT * FROM projects')).rowCount,4,'upgrade preserves projects');
  },{baselineThrough:'0045_phase1_audit_legacy_chain_rls_backfill.sql',beforeUpgrade:async baseline=>{
    fixture=await seedDiscovery(baseline);
    const runtimeURL=new URL(process.env.APP_DATABASE_URL!);
    runtimeURL.pathname=new URL(baseline.options.connectionString!).pathname;
    const runtime=new Pool({connectionString:runtimeURL.toString()});
    try {
      const {userId,tenants:[a,b]}=fixture;
      await context(runtime,{org:a.orgId,alias:b.orgId},async client=>assert.equal((await client.query('SELECT * FROM projects')).rowCount,2));
      await context(runtime,{user:userId},async client=>assert.equal((await client.query('DELETE FROM memberships RETURNING id')).rowCount,2));
      t.diagnostic('REPRODUCED on original 0045: conflicting aliases exposed 2 projects; user-only context deleted 2 own cross-org memberships (rolled back).');
    } finally {await runtime.end();}
    ledger=(await baseline.query('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name')).rows;
  }});
});
