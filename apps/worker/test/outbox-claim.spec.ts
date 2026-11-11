import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import {
  acknowledgeOutboxClaim, claimOutboxBatch, dispatchDueOutbox,
} from '../src/outbox-dispatch';

test('PH1-G24-003/004: Postgres outbox claims release locks before network I/O, fence ack and dead-letter', async t => {
  await withDisposableDatabase(async ({admin,app}) => {
    const { tenants: [a,b] } = await seedTenants(admin);
    const event = async (orgId: string, projectId: string, type: string) => {
      const id = randomUUID();
      await admin.query(`INSERT INTO outbox_events(id,org_id,project_id,event_type,payload_json)
        VALUES($1,$2,$3,$4,$5)`, [id,orgId,projectId,type,JSON.stringify({
        orgId: b.orgId,projectId: b.projectIds[0],eventId:randomUUID(),
        packageId: randomUUID(),
      })]);
      return id;
    };
    await t.test('parallel dispatchers never claim the same event; row identities override forgery', async () => {
      const first = await event(a.orgId,a.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      const second = await event(b.orgId,b.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      let count = 0;
      const seen = new Set<string>();
      const dispatcher = async (_type: string, payload: Record<string,unknown>, eventId: string) => {
        count++;
        assert(!seen.has(eventId), 'duplicate delivery during active claim');
        seen.add(eventId);
        assert.equal(payload.eventId,eventId);
        assert([a.orgId,b.orgId].includes(payload.orgId as string));
        const tenant=payload.orgId===a.orgId?a:b;
        assert.equal(payload.projectId,tenant.projectIds[0]);
        // The enqueue callback represents a 50 ms slow Redis connection.
        // Another DB client must be able to lock the same row immediately.
        const observer=await app.connect();
        try {
          await observer.query('BEGIN');
          await observer.query(`SELECT set_config('app.current_org',$1,true)`,[tenant.orgId]);
          await observer.query(`SET LOCAL lock_timeout='250ms'`);
          const {rows}=await observer.query(`SELECT id FROM outbox_events
            WHERE org_id=$1 AND id=$2 FOR UPDATE NOWAIT`,[tenant.orgId,eventId]);
          assert.equal(rows.length,1);
        } finally { await observer.query('ROLLBACK'); observer.release(); }
        await new Promise(resolve=>setTimeout(resolve,50));
      };
      const results=await Promise.all([
        dispatchDueOutbox(app,dispatcher),dispatchDueOutbox(app,dispatcher),
      ]);
      assert.equal(results.reduce((s,r)=>s+r.acknowledged,0),2);
      assert.equal(count,2);
      assert.deepEqual(seen,new Set([first,second]));
      assert.equal((await admin.query('SELECT count(*)::int n FROM outbox_events WHERE dispatched_at IS NOT NULL')).rows[0].n,2);
    });
    await t.test('short failure leaves a durable backoff and later outcome is acknowledged', async () => {
      const id=await event(a.orgId,a.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      const error=await dispatchDueOutbox(app,async()=>{throw new Error('secret gateway details must never be persisted');});
      assert.equal(error.failed,1);
      let row=(await admin.query('SELECT * FROM outbox_events WHERE id=$1',[id])).rows[0];
      assert.equal(row.attempts,1);
      assert.equal(row.failure_code,'QUEUE_DISPATCH_FAILED');
      assert.equal(row.claim_token,null);
      assert.equal(row.dispatched_at,null);
      assert(row.next_attempt_at.getTime()>Date.now());
      await admin.query(`UPDATE outbox_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[id]);
      const retried=await dispatchDueOutbox(app,async()=>{});
      assert.equal(retried.acknowledged,1);
      row=(await admin.query('SELECT * FROM outbox_events WHERE id=$1',[id])).rows[0];
      assert.equal(row.attempts,2);
      assert(row.dispatched_at instanceof Date);
    });
    await t.test('a late owner cannot acknowledge after the lease is reclaimed',async()=>{
      const id=await event(a.orgId,a.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      const old=(await claimOutboxBatch(app,a.orgId))[0];
      assert.equal(old.id,id);
      assert.equal((await claimOutboxBatch(app,a.orgId)).length,0);
      await admin.query(`UPDATE outbox_events SET claim_until=now()-interval '1 second' WHERE id=$1`,[id]);
      const fresh=(await claimOutboxBatch(app,a.orgId))[0];
      assert.notEqual(fresh.claim_token,old.claim_token);
      assert.equal(await acknowledgeOutboxClaim(app,old),false);
      assert.equal(await acknowledgeOutboxClaim(app,fresh),true);
    });
    await t.test('PH1-G24-009: malformed or future executable event is never admitted to Redis',async()=>{
      const id=await event(a.orgId,a.projectIds[0],'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN');
      let enqueued=0;
      const result=await dispatchDueOutbox(app,async()=>{enqueued++;});
      assert.equal(result.failed,1);
      assert.equal(enqueued,0);
      const row=(await admin.query('SELECT attempts,failure_code FROM outbox_events WHERE id=$1',[id])).rows[0];
      assert.equal(row.attempts,1);
      assert.equal(row.failure_code,'OUTBOX_EVENT_INVALID');
      // It cannot monopolize the queue or conceal valid events in other tenants.
      const good=await event(b.orgId,b.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      assert.equal((await dispatchDueOutbox(app,async(_type,_payload,key)=>{
        assert.equal(key,good); enqueued++;
      })).acknowledged,1);
      assert.equal(enqueued,1);
    });
    await t.test('unknown events dead-letter after bounded attempts; crashed last attempt is recovered',async()=>{
      const id=await event(a.orgId,a.projectIds[0],'UNKNOWN_EXECUTABLE_EVENT');
      for(let attempt=1;attempt<=5;attempt++){
        const result=await dispatchDueOutbox(app,async()=>{throw new Error('unexpected dispatch');});
        assert.equal(result.failed,1);
        const row=(await admin.query('SELECT * FROM outbox_events WHERE id=$1',[id])).rows[0];
        assert.equal(row.attempts,attempt);
        assert.equal(row.failure_code,'OUTBOX_EVENT_INVALID');
        if(attempt<5){
          assert.equal(row.dead_lettered_at,null);
          await admin.query(`UPDATE outbox_events SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[id]);
        }else assert(row.dead_lettered_at instanceof Date);
      }
      const crashed=await event(a.orgId,a.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      await admin.query(`UPDATE outbox_events SET attempts=5,claim_token=$2,
         claim_until=now()-interval '1 second' WHERE id=$1`,[crashed,randomUUID()]);
      assert.equal((await claimOutboxBatch(app,a.orgId)).length,0);
      const state=(await admin.query('SELECT failure_code,dead_lettered_at FROM outbox_events WHERE id=$1',[crashed])).rows[0];
      assert.equal(state.failure_code,'OUTBOX_CLAIM_EXHAUSTED');
      assert(state.dead_lettered_at instanceof Date);
      const legacy=await event(b.orgId,b.projectIds[0],'HANDOVER_PACKAGE_QUEUED');
      await admin.query(`UPDATE outbox_events SET attempts=5 WHERE id=$1`,[legacy]);
      assert.equal((await claimOutboxBatch(app,b.orgId)).length,0);
      const legacyState=(await admin.query('SELECT failure_code,dead_lettered_at FROM outbox_events WHERE id=$1',[legacy])).rows[0];
      assert.equal(legacyState.failure_code,'OUTBOX_CLAIM_EXHAUSTED');
      assert(legacyState.dead_lettered_at instanceof Date);
    });
  });
});
