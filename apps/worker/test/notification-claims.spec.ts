import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { claimNotificationBatch, resolveNotificationClaim, dispatchDueNotifications } from '../src/notification-dispatch';

void test('PH1-G24-005: bounded/fenced notification delivery with per-recipient recovery', async t => {
  await withDisposableDatabase(async ({admin,app})=>{
    const {userId,tenants:[a,b]}=await seedTenants(admin);
    const create=async (orgId:string,channel='EMAIL')=>{
      const id=randomUUID();
      await admin.query(`INSERT INTO notifications
        (id,org_id,recipient_user_id,channel,event_key,payload_json,dedup_key)
        VALUES($1,$2,$3,$4,'NOTIFICATION_RETRY_TEST','{}',$5)`,
      [id,orgId,userId,channel,id]);
      return id;
    };
    await t.test('slow provider does not hold DB locks; concurrent workers never double-claim',async()=>{
      const id=await create(a.orgId);
      let opened!:()=>void,finish!:()=>void;
      const began=new Promise<void>(resolve=>{opened=resolve;});
      const delay=new Promise<void>(resolve=>{finish=resolve;});
      const first=dispatchDueNotifications(app,false,async notif=>{
        assert.equal(notif.id,id); opened();await delay;
        return true;
      });
      await began;
      const observer=await app.connect();
      try {
        await observer.query('BEGIN');
        await observer.query(`SELECT set_config('app.current_org',$1,true)`,[a.orgId]);
        await observer.query(`SET LOCAL lock_timeout='300ms'`);
        const {rows}=await observer.query(`SELECT id FROM notifications
            WHERE org_id=$1 AND id=$2 FOR UPDATE NOWAIT`,[a.orgId,id]);
        assert.equal(rows.length,1);
      }finally{await observer.query('ROLLBACK');observer.release();}
      const concurrent=await dispatchDueNotifications(app,false,async()=>{
        throw new Error('another worker must not send same claim');
      });
      assert.equal(concurrent.claimed,0);
      finish();
      const firstResult=await first;
      assert.equal(firstResult.accepted,1);
      const {rows:[row]}=await admin.query(`SELECT status,gateway_state,delivery_attempts,
        sent_at FROM notifications WHERE id=$1`,[id]);
      assert.equal(row.status,'SENT');
      assert.equal(row.gateway_state,'ACCEPTED');
      assert.equal(row.delivery_attempts,1);
      assert(row.sent_at instanceof Date);
    });
    await t.test('provider timeout/rejection retries same ID with backoff and bounded terminal failure',async()=>{
      const id=await create(a.orgId);
      for(let attempts=1;attempts<=5;attempts++){
        const r=await dispatchDueNotifications(app,false,async notif=>{
          assert.equal(notif.id,id);
          if(attempts===1) throw new Error('provider response lost');
          return false;
        });
        assert.equal(r.claimed,1);
        assert.equal(r.failed,1);
        const {rows:[state]}=await admin.query(`SELECT delivery_attempts,status,gateway_state,
          claim_token,claim_until,dead_lettered_at,failure_code,next_attempt_at
            FROM notifications WHERE id=$1`,[id]);
        assert.equal(state.delivery_attempts,attempts);
        assert.equal(state.claim_token,null);
        assert.equal(state.failure_code,'DELIVERY_PROVIDER_UNCONFIRMED');
        if(attempts<5){
          assert.equal(state.status,'QUEUED');
          assert.equal(state.gateway_state,'PENDING');
          assert.equal(state.dead_lettered_at,null);
          assert(state.next_attempt_at.getTime()>Date.now());
          await admin.query(`UPDATE notifications SET next_attempt_at=now()-interval '1 second'
            WHERE id=$1`,[id]);
        }else{
          assert.equal(state.status,'FAILED');
          assert.equal(state.gateway_state,'FAILED');
          assert(state.dead_lettered_at instanceof Date);
        }
      }
      assert.equal((await dispatchDueNotifications(app,false,async()=>true)).claimed,0);
    });
    await t.test('lease expiry reclaims with a new token; old acknowledger is fenced',async()=>{
      const id=await create(a.orgId);
      const old=(await claimNotificationBatch(app,a.orgId,false))[0];
      assert.equal(old.id,id);
      assert.equal((await claimNotificationBatch(app,a.orgId,false)).length,0);
      await admin.query(`UPDATE notifications SET claim_until=now()-interval '1 second' WHERE id=$1`,[id]);
      const newer=(await claimNotificationBatch(app,a.orgId,false))[0];
      assert.notEqual(newer.claim_token,old.claim_token);
      assert.equal(await resolveNotificationClaim(app,old,true),false);
      assert.equal(await resolveNotificationClaim(app,newer,true),true);
      const {rows:[row]}=await admin.query(`SELECT status,delivery_attempts FROM notifications WHERE id=$1`,[id]);
      assert.equal(row.status,'SENT');assert.equal(row.delivery_attempts,2);
    });
    await t.test('quiet hours defer SMS before LIMIT; email and other tenants make progress',async()=>{
      for(let i=0;i<27;i++) await create(a.orgId,'SMS');
      const email=await create(a.orgId,'EMAIL');
      const other=await create(b.orgId,'EMAIL');
      const seen:string[]=[];
      const result=await dispatchDueNotifications(app,true,async n=>{seen.push(n.id);return true;});
      assert.equal(result.accepted,2);
      assert.deepEqual(new Set(seen),new Set([email,other]));
      const {rows:[sms]}=await admin.query(`SELECT count(*)::int n FROM notifications
        WHERE org_id=$1 AND channel='SMS' AND status='QUEUED' AND delivery_attempts=0`,[a.orgId]);
      assert.equal(sms.n,27);
      const noStarve=await create(b.orgId);
      const failure=await create(a.orgId);
      const counts=await dispatchDueNotifications(app,false,async n=>n.id===noStarve);
      assert(counts.accepted>=1);
      assert((await admin.query(`SELECT status FROM notifications WHERE id=$1`,[noStarve])).rows[0].status==='SENT');
      assert((await admin.query(`SELECT status FROM notifications WHERE id=$1`,[failure])).rows[0].status==='QUEUED');
    });
    await t.test('crashed fifth claim and pre-existing exhausted claims get explicit dead letter',async()=>{
      const old=await create(a.orgId);
      const unused=await create(b.orgId);
      await admin.query(`UPDATE notifications SET delivery_attempts=5,claim_token=$2,
        claim_until=now()-interval '1 second' WHERE id=$1`,[old,randomUUID()]);
      await admin.query(`UPDATE notifications SET delivery_attempts=5 WHERE id=$1`,[unused]);
      assert.equal((await claimNotificationBatch(app,a.orgId,false)).some(n=>n.id===old),false);
      assert.equal((await claimNotificationBatch(app,b.orgId,false)).some(n=>n.id===unused),false);
      for(const id of [old,unused]){
        const {rows:[s]}=await admin.query(`SELECT status,gateway_state,dead_lettered_at,failure_code
            FROM notifications WHERE id=$1`,[id]);
        assert.equal(s.status,'FAILED');
        assert.equal(s.gateway_state,'FAILED');
        assert.equal(s.failure_code,'DELIVERY_ATTEMPTS_EXHAUSTED');
        assert(s.dead_lettered_at instanceof Date);
      }
    });
  });
});
