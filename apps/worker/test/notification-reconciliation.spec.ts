import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants,scoped} from '../../../packages/db/test/helpers/fixtures';
import {claimNotificationBatch,dispatchDueNotifications,resolveNotificationClaim} from '../src/notification-dispatch';
import {reconcileNotificationOutcomes} from '../src/notification-reconciliation';
import {projectBusinessEventNotifications} from '../src/business-notifications';

void test('lost provider acknowledgements reconcile before any resend; attempt provenance remains fenced',async t=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[tenant]}=await seedTenants(admin),org=tenant.orgId;
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),org,userId]);
  let sendCount=0,mode:'LOST_ACCEPTANCE'|'NOT_FOUND'|'ACK'='LOST_ACCEPTANCE';
  const messages=new Map<string,{messageId:string;sequence:number}>();
  const attempts:string[]=[];
  const server=createServer(async(req,res)=>{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
   res.setHeader('content-type','application/json');
   if(req.url==='/status'){
    const message=messages.get(body.notificationId);res.end(JSON.stringify({notificationId:body.notificationId,status:message?'DELIVERED':'NOT_FOUND',sequence:message?.sequence??1,...(message?{messageId:message.messageId}:{})}));return;
   }
   sendCount++;attempts.push(String(req.headers['x-delivery-attempt']));assert.equal(req.headers['idempotency-key'],body.id);
   if(mode==='NOT_FOUND'){req.socket.destroy();return;}
   const message={messageId:'synthetic-'+body.id,sequence:mode==='ACK'?2:1};messages.set(body.id,message);
   if(mode==='LOST_ACCEPTANCE'){req.socket.destroy();return;}
   res.end(JSON.stringify({notificationId:body.id,accepted:true,messageId:message.messageId}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const keys=['NODE_ENV','NOTIFICATION_DELIVERY_URL','NOTIFICATION_DELIVERY_TOKEN','NOTIFICATION_STATUS_URL'] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{NODE_ENV:'test',NOTIFICATION_DELIVERY_URL:base+'/send',NOTIFICATION_DELIVERY_TOKEN:'synthetic-fixture-token',NOTIFICATION_STATUS_URL:base+'/status'});
  const create=async()=>{const id=randomUUID();await admin.query("INSERT INTO notifications(id,org_id,recipient_user_id,channel,event_key,payload_json,dedup_key,category) VALUES($1::uuid,$2::uuid,$3::uuid,'EMAIL','WEEKLY_OWNER_DIGEST','{\"projects\":[]}',$1::text,'OWNER_DIGEST')",[id,org,userId]);return id;};
  try{
   await t.test('HTTP acceptance with a lost acknowledgement is not delivered twice',async()=>{
    const id=await create();const first=await dispatchDueNotifications(app,false);assert.equal(first.claimed,1);assert.equal(sendCount,1);
    assert.equal((await admin.query('SELECT gateway_state FROM notifications WHERE id=$1',[id])).rows[0].gateway_state,'UNCERTAIN');
    assert.equal((await dispatchDueNotifications(app,false)).claimed,0);assert.equal(sendCount,1);
    await admin.query('UPDATE notifications SET reconcile_after=now() WHERE id=$1',[id]);assert.equal((await reconcileNotificationOutcomes(app)).resolved,1);
    const row=(await admin.query('SELECT status,gateway_state,delivery_attempts FROM notifications WHERE id=$1',[id])).rows[0];assert.equal(row.gateway_state,'DELIVERED');assert.equal(row.status,'SENT');assert.equal(row.delivery_attempts,1);
    assert.equal((await dispatchDueNotifications(app,false)).claimed,0);assert.equal(sendCount,1);
    assert.equal((await admin.query('SELECT status FROM notification_delivery_attempts WHERE notification_id=$1',[id])).rows[0].status,'DELIVERED');
   });
   await t.test('only authoritative NOT_FOUND permits retry using the same notification identity',async()=>{
    mode='NOT_FOUND';const id=await create();await dispatchDueNotifications(app,false);assert.equal(sendCount,2);
    await admin.query('UPDATE notifications SET reconcile_after=now() WHERE id=$1',[id]);assert.equal((await reconcileNotificationOutcomes(app)).resolved,1);
    mode='ACK';assert.equal((await dispatchDueNotifications(app,false)).accepted,1);assert.equal(sendCount,3);
    const history=(await admin.query('SELECT attempt_no,status,input_hash FROM notification_delivery_attempts WHERE notification_id=$1 ORDER BY attempt_no',[id])).rows;
    assert.deepEqual(history.map(r=>r.status),['NOT_FOUND','ACCEPTED']);assert.deepEqual(history.map(r=>r.attempt_no),[1,2]);assert.equal(new Set(history.map(r=>r.input_hash)).size,1);
    assert.notEqual(attempts[1],attempts[2]);
    await admin.query('UPDATE notifications SET reconcile_after=now() WHERE id=$1',[id]);assert.equal((await reconcileNotificationOutcomes(app)).resolved,1);
    assert.equal((await admin.query('SELECT gateway_state FROM notifications WHERE id=$1',[id])).rows[0].gateway_state,'DELIVERED');
   });
   await t.test('crash after send admission becomes uncertain and late lease settlement cannot overwrite reconciliation',async()=>{
    const id=await create(),claim=(await claimNotificationBatch(app,org,false))[0];assert.equal(claim.id,id);
    await admin.query("UPDATE notification_delivery_attempts SET status='SENDING' WHERE id=$1",[claim.delivery_attempt_id]);
    await admin.query("UPDATE notifications SET claim_until=now()-interval '1 second' WHERE id=$1",[id]);
    assert.equal((await claimNotificationBatch(app,org,false)).length,0);assert.equal((await admin.query('SELECT gateway_state FROM notifications WHERE id=$1',[id])).rows[0].gateway_state,'UNCERTAIN');
    assert.equal((await reconcileNotificationOutcomes(app)).resolved,1);
    assert.equal(await resolveNotificationClaim(app,claim,true),false);
    const next=(await claimNotificationBatch(app,org,false))[0];assert.equal(next.id,id);assert.notEqual(next.claim_token,claim.claim_token);
    assert.equal(await resolveNotificationClaim(app,next,false),true);
   });
   await t.test('terminal attempts and cross-tenant history are protected by the actual runtime role',async()=>{
    const {rows:[attempt]}=await admin.query("SELECT id,notification_id FROM notification_delivery_attempts WHERE org_id=$1 AND status='DELIVERED' LIMIT 1",[org]);
    await assert.rejects(scoped(app,org,c=>c.query("UPDATE notification_delivery_attempts SET settled_at=now() WHERE id=$1",[attempt.id])),/NOTIFICATION_ATTEMPT_TERMINAL_IMMUTABLE/);
    assert.equal((await scoped(app,randomUUID(),c=>c.query('SELECT id FROM notification_delivery_attempts WHERE id=$1',[attempt.id]))).rows.length,0);
   });
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));for(const key of keys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 });
});
void test('business-event projection uses authoritative entity recipients and never copies private payloads',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[a,b]}=await seedTenants(admin),submission=randomUUID();
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),a.orgId,userId]);
  await admin.query("INSERT INTO submissions(id,org_id,project_id,status,created_by) VALUES($1,$2,$3,'DRAFT',$4)",[submission,a.orgId,a.projectIds[0],userId]);
  const event={id:randomUUID(),org_id:a.orgId,project_id:a.projectIds[0],event_type:'SUBMISSION_ACCEPTED',claim_token:randomUUID(),attempts:1,
   payload_json:{entityId:submission,orgId:b.orgId,recipientUserId:randomUUID(),financialAmount:'PRIVATE-COMMERCIAL',internalNote:'SECRET'}};
  assert.equal(await projectBusinessEventNotifications(app,event),1);assert.equal(await projectBusinessEventNotifications(app,event),0);
  const {rows}=await admin.query('SELECT * FROM notifications WHERE org_id=$1',[a.orgId]);assert.equal(rows.length,1);assert.equal(rows[0].recipient_user_id,userId);assert.equal(rows[0].gateway_state,'DELIVERED');
  assert.equal(JSON.stringify(rows[0].payload_json).includes('SECRET'),false);assert.equal(JSON.stringify(rows[0].payload_json).includes('PRIVATE-COMMERCIAL'),false);
  assert.equal(await projectBusinessEventNotifications(app,{...event,id:randomUUID(),project_id:b.projectIds[0]}),0);
  await admin.query("UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2",[a.orgId,userId]);
  assert.equal(await projectBusinessEventNotifications(app,{...event,id:randomUUID()}),0);
 });
});
void test('concurrent dispatchers share a per-tenant channel budget without duplicate claims',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[tenant]}=await seedTenants(admin),org=tenant.orgId;
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),org,userId]);
  for(let i=0;i<30;i++)await admin.query("INSERT INTO notifications(id,org_id,recipient_user_id,channel,event_key,dedup_key) VALUES($1::uuid,$2,$3,'EMAIL','SYNTHETIC_BUDGET',$1::text)",[randomUUID(),org,userId]);
  const seen=new Set<string>();
  for(let wave=0;wave<10;wave++){
   const batches=await Promise.all(Array.from({length:4},()=>claimNotificationBatch(app,org,false,4)));
   for(const notice of batches.flat()){assert(!seen.has(notice.id));seen.add(notice.id);await resolveNotificationClaim(app,notice,true);}
  }
  const budgets=(await admin.query('SELECT claimed FROM notification_rate_budgets WHERE org_id=$1 AND channel=\'EMAIL\'',[org])).rows;
  assert(budgets.length>=1);assert(budgets.every(row=>row.claimed<=20));assert.equal(budgets.reduce((sum,row)=>sum+row.claimed,0),seen.size);
  // If the clock crossed a real minute boundary, each window still has its own hard cap.
  if(budgets.length===1)assert.equal(seen.size,20);
 });
});
