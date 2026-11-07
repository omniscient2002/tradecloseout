import { withDisposableDatabase } from '/home/cassandra/tradecloseout/packages/db/test/helpers/disposable-database';
import { seedTenants } from '/home/cassandra/tradecloseout/packages/db/test/helpers/fixtures';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire('/home/cassandra/tradecloseout/apps/api/package.json');
const root = '/home/cassandra/tradecloseout/apps/api/dist/apps/api/src/modules/';
const { CommissioningService } = require(root + 'commissioning/commissioning.service.js');
const { WarrantyAndBillingService } = require(root + 'billing/warranty-and-billing.service.js');
const { TradeCloseoutScheduler } = require('/home/cassandra/tradecloseout/apps/api/dist/apps/worker/src/scheduler.js');
const { isIndiaQuietHour } = require('@tradecloseout/shared');
async function main() {
 await withDisposableDatabase(async ({admin, app}) => {
  const {userId, tenants} = await seedTenants(admin);
  const orgId = tenants[0].orgId, projectId = tenants[0].projectIds[0];
  const ctx = {orgId,userId,actorType:'USER',orgRole:'R-OWNER',requestId:randomUUID()};
  const c = new CommissioningService(app), w = new WarrantyAndBillingService(app);
  const inspection = await c.recordQualityInspection(ctx,projectId,{itrNumber:'PROBE-1',title:'Synthetic inspection',stageKey:'INSTALLATION',checklistItems:[{itemNo:1,description:'Synthetic check',result:'PASS'}]});
  const signed = await c.signInspectionWitness(ctx,projectId,inspection.id,{partyName:'Unverified synthetic consultant',representativeName:'Someone else',role:'CONSULTANT'});
  console.log(JSON.stringify({probe:'witness_without_delegation',outcome:signed.lastSigned}));
  const schedule = await c.createSeasonalSchedule(ctx,projectId,{season:'SUMMER_PEAK',targetDate:'2027-06-01'});
  try {
    console.log(JSON.stringify({probe:'seasonal_empty_completion',outcome:await c.updateSeasonalSchedule(ctx,projectId,schedule.id,{status:'COMPLETED'})}));
  } catch (err: any) {
    console.log(JSON.stringify({probe:'seasonal_empty_completion',rejected:true,code:err.response?.code || err.message}));
  }
  try {
    const tab = await c.recordTabWorksheet(ctx,projectId,{systemType:'WATER_SIDE',worksheetType:'Synthetic',readings:[{terminalOrTag:'T1',designFlow:100,actualFlow:-10,unit:'GPM'}]});
    console.log(JSON.stringify({probe:'negative_actual_flow',status:tab.status,storedActualFlow:tab.readings[0].actualFlow}));
  } catch (err: any) {
    console.log(JSON.stringify({probe:'negative_actual_flow',rejected:true,code:err.response?.code || err.message}));
  }
  const assetId = randomUUID();
  await admin.query(`INSERT INTO assets (id,org_id,project_id,tag,name,category_key,warranty_start_basis,created_by) VALUES ($1,$2,$3,'PROBE-A','Synthetic asset','HVAC','HANDOVER',$4)`,[assetId,orgId,projectId,userId]);
  const base={assetId,eventType:'REGISTRATION',oemReference:'SYNTHETIC-1',registeredAt:'2026-11-07',warrantyStart:'2026-11-07',warrantyEnd:'2027-11-07',basis:'HANDOVER'};
  await w.recordWarrantyEvent(ctx,projectId,base);
  const extension=await w.recordWarrantyEvent(ctx,projectId,{...base,eventType:'EXTENSION',oemReference:'SYNTHETIC-2',warrantyEnd:'2028-11-07'});
  const dates=(await admin.query('SELECT warranty_end FROM assets WHERE id=$1',[assetId])).rows[0];
  console.log(JSON.stringify({probe:'confirmed_extension',extension,assetDates:dates}));
  console.log(JSON.stringify({probe:'subscription_without_row',outcome:await w.getSubscription(ctx)}));
  if (isIndiaQuietHour()) {
   for (let i=0;i<25;i++) await admin.query(`INSERT INTO notifications(id,org_id,recipient_user_id,channel,event_key,payload_json,status,dedup_key,created_at) VALUES($1,$2,$3,'SMS','SYNTHETIC','{}','QUEUED',$4,now()-interval '1 hour')`,[randomUUID(),orgId,userId,'probe-'+i]);
   const inAppId=randomUUID();
   await admin.query(`INSERT INTO notifications(id,org_id,recipient_user_id,channel,event_key,payload_json,status,dedup_key) VALUES($1,$2,$3,'IN_APP','SYNTHETIC','{}','QUEUED','probe-in-app')`,[inAppId,orgId,userId]);
   const sent=await new TradeCloseoutScheduler(app,{}).dispatchQueuedNotifications();
   console.log(JSON.stringify({probe:'quiet_hour_head_of_line_block',sent,inAppStatus:(await admin.query('SELECT status FROM notifications WHERE id=$1',[inAppId])).rows[0].status}));
  }
 });
}
main().catch(error=>{console.error(error);process.exitCode=1});
