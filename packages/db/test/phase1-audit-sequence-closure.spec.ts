import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withDisposableDatabase } from './helpers/disposable-database';
import { scoped, seedTenants } from './helpers/fixtures';

const GENESIS = 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
const forge = '9'.repeat(63) + '8';

async function append(
  client: PoolClient, org: string, project: string, request: string,
  fields: Record<string, unknown> = {},
) {
  const { rows } = await client.query(
    `INSERT INTO audit_events
      (id,org_id,project_id,actor_type,action,entity_type,entity_id,
       request_id,chain_seq,prev_hash,hash,created_at)
     VALUES ($1,$2,$3,'SYSTEM','G26_SEQUENCE_PROBE','PROJECT',$3,
             $4,$5,$6,$7,$8) RETURNING id,chain_seq,prev_hash,hash,created_at`,
    [
      randomUUID(), org, project, request, fields.chain_seq ?? '9223372036854775000',
      fields.prev_hash ?? forge, fields.hash ?? forge,
      fields.created_at ?? '2026-11-15T09:00:00.000Z',
    ],
  );
  return rows[0] as {
    id: string; chain_seq: string; prev_hash: string; hash: string; created_at: Date;
  };
}
async function head(client: PoolClient, org: string) {
  const { rows } = await client.query(
    'SELECT event_count,head_seq,head_hash FROM public.phase1_audit_expected_head($1)', [org],
  );
  return rows[0] as { event_count: string; head_seq: string | null; head_hash: string | null };
}

test('PH1-G26-008: forged sequence/hash/time cannot override trusted position, registry is protected', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a, b] } = await seedTenants(admin);
    const event = await scoped(app, a.orgId, client => append(client, a.orgId, a.projectIds[0], 'seq-forge'));
    assert.notEqual(event.chain_seq, '9223372036854775000');
    assert.notEqual(event.prev_hash, forge);
    assert.equal(event.prev_hash, GENESIS);
    assert.notEqual(event.hash, forge);
    assert.notEqual(event.created_at.toISOString(), '2026-11-15T09:00:00.000Z');

    const stored = await admin.query(
      'SELECT chain_seq,org_id,event_id,event_created_at,prev_hash,event_hash FROM audit_chain_positions WHERE event_id=$1',
      [event.id],
    );
    assert.equal(stored.rowCount, 1);
    assert.equal(String(stored.rows[0].chain_seq), String(event.chain_seq));
    assert.equal(stored.rows[0].event_hash, event.hash);
    assert.equal(stored.rows[0].prev_hash, GENESIS);
    const expected = await scoped(app, a.orgId, client => head(client, a.orgId));
    assert.equal(expected.event_count, '1');
    assert.equal(expected.head_seq, String(event.chain_seq));
    assert.equal(expected.head_hash, event.hash);

    // Explicitly prevent querying, forging or modifying the registry through
    // the runtime DB role; only the audited trigger may register a position.
    for (const sql of [
      'SELECT chain_seq FROM audit_chain_positions',
      "INSERT INTO audit_chain_positions(chain_seq,event_id,event_created_at,prev_hash,event_hash) VALUES (1,gen_random_uuid(),now(),'GENESIS','deadbeef')",
      'UPDATE audit_chain_positions SET event_hash=event_hash',
      'DELETE FROM audit_chain_positions',
      'TRUNCATE audit_chain_positions',
    ]) {
      await assert.rejects(app.query(sql),
        (err: any) => err.code === '42501');
    }
    await assert.rejects(app.query('SELECT * FROM public.phase1_audit_expected_head($1)', [a.orgId]),
      (err: any) => err.code === '42501');
    await assert.rejects(scoped(app, b.orgId, client =>
      client.query('SELECT * FROM public.phase1_audit_expected_head($1)', [a.orgId])),
    (err: any) => err.code === '42501');
    assert.equal((await scoped(app, b.orgId, client => head(client, b.orgId))).event_count, '0');
  });
});

test('PH1-G26-008: two transactions serialize same tenant, distinct tenants progress independently, rollback never registers a gap', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a,b] } = await seedTenants(admin);
    const first = await app.connect(), second = await app.connect(), crossTenant = await app.connect();
    const open = async (client: PoolClient, org: string) => {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)", [org],
      );
    };
    try {
      await open(first, a.orgId);
      await open(second, a.orgId);
      await open(crossTenant, b.orgId);
      const eventA1 = await append(first, a.orgId, a.projectIds[0], 'uncommitted-first');
      let secondFinished = false;
      const secondPromise = append(second, a.orgId, a.projectIds[0], 'blocked-second')
        .then(result => { secondFinished = true; return result; });
      // B's own tenant must progress even while A's advisory lock is held.
      const eventB = await append(crossTenant, b.orgId, b.projectIds[0], 'other-org');
      await crossTenant.query('COMMIT');
      const checkWaiting = new Promise<void>(resolve => setTimeout(resolve, 80));
      await checkWaiting;
      assert.equal(secondFinished, false, 'same-tenant second insert must wait for first commit');
      await first.query('COMMIT');
      const eventA2 = await secondPromise;
      await second.query('COMMIT');
      assert(BigInt(eventA2.chain_seq) > BigInt(eventA1.chain_seq));
      assert.equal(eventA2.prev_hash, eventA1.hash);
      assert.equal(eventB.prev_hash, GENESIS);
      assert.notEqual(eventB.chain_seq, eventA1.chain_seq);
      assert.notEqual(eventB.chain_seq, eventA2.chain_seq);
    } finally {
      await Promise.all([first,second,crossTenant].map(async client => {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }));
    }

    const before = await scoped(app, a.orgId, client => head(client, a.orgId));
    const rolled = await app.connect();
    let rollbackSeq = '';
    try {
      await open(rolled, a.orgId);
      const orphan = await append(rolled, a.orgId, a.projectIds[0], 'rolled-back');
      rollbackSeq = orphan.chain_seq;
      await rolled.query('ROLLBACK');
    } finally {
      await rolled.query('ROLLBACK').catch(() => {});
      rolled.release();
    }
    const afterRollback = await scoped(app, a.orgId, client => head(client, a.orgId));
    assert.deepEqual(afterRollback, before, 'rolled-back events cannot advance durable ledger head');
    assert.equal((await admin.query('SELECT 1 FROM audit_chain_positions WHERE chain_seq=$1', [rollbackSeq])).rowCount, 0);
    const after = await scoped(app, a.orgId, client => append(client, a.orgId, a.projectIds[0], 'after-gap'));
    assert(BigInt(after.chain_seq) > BigInt(rollbackSeq), 'sequence gaps from rollbacks are allowed');
    assert.equal(after.prev_hash, before.head_hash);
    const registered = await scoped(app, a.orgId, client => head(client, a.orgId));
    assert.equal(BigInt(registered.event_count), BigInt(before.event_count) + 1n);
    assert.equal(registered.head_hash, after.hash);
  });
});

test('PH1-G26-008: legacy upgrade preserves original hashes and adds positions without rewriting history', async () => {
  let saved: { id: string; hash: string; prev_hash: string; chain_seq: string } | null = null;
  let org = '';
  await withDisposableDatabase(async ({ admin, app }) => {
    assert(saved, 'pre-upgrade position was not captured');
    const original = (await admin.query(
      'SELECT id,chain_seq,prev_hash,hash FROM audit_events WHERE id=$1', [saved.id],
    )).rows[0];
    assert.equal(String(original.chain_seq), saved.chain_seq);
    assert.equal(original.hash, saved.hash);
    assert.equal(original.prev_hash, saved.prev_hash);
    const registered = (await admin.query(
      'SELECT chain_seq,event_hash FROM audit_chain_positions WHERE event_id=$1', [saved.id],
    )).rows[0];
    assert.equal(String(registered.chain_seq), saved.chain_seq);
    assert.equal(registered.event_hash, saved.hash);
    const expected = await scoped(app, org, client => head(client, org));
    assert.equal(expected.head_hash, saved.hash);
    assert.equal(expected.head_seq, saved.chain_seq);
  }, {
    baselineThrough: '0043_phase1_future_audit_partition_provision.sql',
    beforeUpgrade: async baseline => {
      const { tenants: [tenant] } = await seedTenants(baseline);
      org = tenant.orgId;
      const { rows } = await baseline.query(
        `INSERT INTO audit_events (id,org_id,project_id,actor_type,action,entity_type,entity_id,request_id)
         VALUES ($1,$2,$3,'SYSTEM','LEGACY_G26_CHAIN','PROJECT',$3,'before-0044')
         RETURNING id,chain_seq,prev_hash,hash`,
        [randomUUID(), org, tenant.projectIds[0]],
      );
      saved = {
        id: rows[0].id, chain_seq: String(rows[0].chain_seq),
        prev_hash: rows[0].prev_hash, hash: rows[0].hash,
      };
    },
  });
});

test('PH1-G26-008: forward migration refuses a historically altered hash instead of silently backfilling', async () => {
  await assert.rejects(withDisposableDatabase(async () => {
    assert.fail('corrupt pre-upgrade audit chain must not migrate');
  }, {
    baselineThrough: '0043_phase1_future_audit_partition_provision.sql',
    beforeUpgrade: async baseline => {
      const { tenants: [a] } = await seedTenants(baseline);
      const eventId = randomUUID();
      await baseline.query(
        `INSERT INTO audit_events(id,org_id,project_id,actor_type,action,entity_type,entity_id,request_id)
         VALUES ($1,$2,$3,'SYSTEM','BEFORE_CORRUPTION','PROJECT',$3,'g26-corrupt')`,
        [eventId, a.orgId, a.projectIds[0]],
      );
      await baseline.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
      try {
        await baseline.query('UPDATE audit_events SET after_json=$2 WHERE id=$1',
          [eventId, JSON.stringify({ tampered: true })]);
      } finally {
        await baseline.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
      }
    },
  }), /AUDIT_CHAIN_LEGACY_RECONCILIATION_REQUIRED/);
});
