import {uuidv7} from 'uuidv7';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {TenantDbService} from '../src/database/tenant-db.service';
import {PartiesService} from '../src/modules/parties/parties.service';
import {OUTBOX_EVENT_REGISTRY} from '../../worker/src/event-registry';
jest.setTimeout(180_000);
// Synthetic commercial mechanics only: no approved HVAC pack, supplier delivery or engineering acceptance.
describe('Phase2 procurement exact money, live scope, lifecycle and atomic history',()=>{
  it('creates only eligible orders; denied/failed operations preserve every table',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const org=uuidv7(),owner=uuidv7(),project=uuidv7(),otherProject=uuidv7(),foreignOrg=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic procurement owner','ACTIVE')",[owner]);
      for(const id of [org,foreignOrg])await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Synthetic procurement fixture','Synthetic procurement fixture','KA')`,[id]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,owner]);
      for(const id of [project,otherProject])await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,$3,'Synthetic procurement project','ACTIVE',$4)`,[id,org,id===project?'PO-PRIMARY':'PO-OTHER',owner]);
      const supplier=uuidv7(),client=uuidv7(),archived=uuidv7(),deleted=uuidv7(),foreignSupplier=uuidv7();
      for(const [id,tenant,types,status,isDeleted] of [[supplier,org,['SUPPLIER_OEM'],'ACTIVE',false],
        [client,org,['CLIENT'],'ACTIVE',false],[archived,org,['SUPPLIER_OEM'],'ARCHIVED',false],
        [deleted,org,['SUPPLIER_OEM'],'ACTIVE',true],[foreignSupplier,foreignOrg,['SUPPLIER_OEM'],'ACTIVE',false]]) {
        await admin.query(`INSERT INTO parties(id,org_id,name,types,status,deleted_at)
          VALUES($1,$2,'Synthetic counterparty',$3,$4,CASE WHEN $5 THEN now() ELSE NULL END)`,[id,tenant,types,status,isDeleted]);
      }
      const asset=uuidv7(),foreignAsset=uuidv7(),retired=uuidv7(),deletedAsset=uuidv7();
      for(const [id,scope,status,isDeleted] of [[asset,project,'ACTIVE',false],[foreignAsset,otherProject,'ACTIVE',false],
        [retired,project,'RETIRED',false],[deletedAsset,project,'ACTIVE',true]]) {
        await admin.query(`INSERT INTO assets(id,org_id,project_id,tag,name,category_key,status,deleted_at,created_by)
          VALUES($1,$2,$3,$7,'Synthetic asset','SYNTHETIC',$4,CASE WHEN $5 THEN now() ELSE NULL END,$6)`,[id,org,scope,status,isDeleted,owner,id]);
      }
      const ctx:any={orgId:org,userId:owner,actorType:'USER',orgRole:'R-OWNER',requestId:uuidv7(),ip:'127.0.0.1',userAgent:'synthetic-procurement'};
      const service=new PartiesService(new TenantDbService(app));
      let sequence=0;
      const input=():any=>({poNumber:'SYNTHETIC-'+(++sequence),supplierPartyId:supplier,orderedAt:'2027-01-01',
        promisedDeliveryAt:'2027-02-01',lines:[{lineNo:1,assetCategoryKey:'SYNTHETIC',description:'Synthetic item',quantity:1,assetId:asset,
          obligations:[{docTypeKey:'DT-018',stageKey:'DELIVERY',title:'Explicit synthetic obligation, not HVAC acceptance',dueDate:'2027-02-01'}]}]});
      const counts=async()=>{
        const result=[];
        for(const table of ['procurement_orders','procurement_order_lines','supplier_document_obligations','audit_events','outbox_events']) {
          result.push(Number((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1`,[org])).rows[0].n));
        }
        return result;
      };
      for(const amount of [undefined,null,0,'9007199254740993']) {
        const body=input();if(amount!==undefined)body.totalAmountPaise=amount;
        const order=await service.createProcurementOrder(ctx,project,body);
        const row=(await admin.query('SELECT total_amount_paise FROM procurement_orders WHERE id=$1',[order.poId])).rows[0];
        expect(row.total_amount_paise).toBe(amount==null?null:String(amount));
        expect(order.obligationsCount).toBe(1);
        const event=(await admin.query("SELECT payload_json FROM outbox_events WHERE org_id=$1 AND event_type='PROCUREMENT_ORDER_ISSUED' AND payload_json->>'entityId'=$2",[org,order.poId])).rows[0];
        expect(event.payload_json).toMatchObject({orgId:org,projectId:project,entityId:order.poId,status:'ISSUED',lineCount:1,obligationCount:1});
        expect((await admin.query("SELECT count(*)::int AS n FROM audit_events WHERE org_id=$1 AND entity_id=$2 AND action='PROCUREMENT_ORDER_ISSUED'",[org,order.poId])).rows[0].n).toBe(1);
        expect((await admin.query('SELECT stage_key,status FROM supplier_document_obligations WHERE po_line_id IN (SELECT id FROM procurement_order_lines WHERE po_id=$1)',[order.poId])).rows[0]).toEqual({stage_key:'DELIVERY',status:'PENDING'});
      }
      expect(OUTBOX_EVENT_REGISTRY.PROCUREMENT_ORDER_ISSUED.category).toBe('INFORMATIONAL');
      const stable=await counts();
      for(const party of [client,archived,deleted,foreignSupplier]) {
        await expect(service.createProcurementOrder(ctx,project,{...input(),supplierPartyId:party})).rejects.toThrow('PROCUREMENT_SUPPLIER_NOT_FOUND');
        expect(await counts()).toEqual(stable);
      }
      for(const id of [foreignAsset,retired,deletedAsset]) {
        const body=input();body.lines.push({...body.lines[0],lineNo:2,assetId:id});
        await expect(service.createProcurementOrder(ctx,project,body)).rejects.toThrow('PROCUREMENT_ASSET_NOT_FOUND');
        expect(await counts()).toEqual(stable);
      }
      const mismatch=input();mismatch.lines[0].assetCategoryKey='WRONG-CATEGORY';
      await expect(service.createProcurementOrder(ctx,project,mismatch)).rejects.toThrow('PROCUREMENT_ASSET_NOT_FOUND');
      const implicitDate=input();delete implicitDate.orderedAt;implicitDate.promisedDeliveryAt='2000-01-01';
      await expect(service.createProcurementOrder(ctx,project,implicitDate))
        .rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_PROCUREMENT_DATE_ORDER'})});
      // A stale owner claim does not retain capability after a current membership demotion.
      await admin.query("UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",[org,owner]);
      await expect(service.createProcurementOrder(ctx,project,input())).rejects.toMatchObject({status:403});
      await admin.query("UPDATE memberships SET role='R-OWNER' WHERE org_id=$1 AND user_id=$2",[org,owner]);
      await admin.query("UPDATE memberships SET role='R-PROC' WHERE org_id=$1 AND user_id=$2",[org,owner]);
      await admin.query(`INSERT INTO project_members(id,org_id,project_id,user_id,role,scope_json,added_by)
        VALUES($1,$2,$3,$4,'R-PROC',$5,$4)`,[uuidv7(),org,project,owner,JSON.stringify({assetIds:[asset]})]);
      await expect(service.createProcurementOrder({...ctx,orgRole:'R-PROC',projectRole:'R-PROC',projectScope:{assetIds:[asset]}},project,input()))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROCUREMENT_MEMBER_SCOPE_UNSUPPORTED'})});
      await admin.query("UPDATE memberships SET role='R-OWNER' WHERE org_id=$1 AND user_id=$2",[org,owner]);
      for(const status of ['HANDOVER','CLOSED','SUSPENDED','CANCELLED','ARCHIVED']) {
        await admin.query('UPDATE projects SET status=$2 WHERE id=$1',[project,status]);
        await expect(service.createProcurementOrder(ctx,project,input())).rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_PROCUREMENT_LOCKED'})});
      }
      await admin.query("UPDATE projects SET status='DRAFT' WHERE id=$1",[project]);
      expect(await counts()).toEqual(stable);
      // Inject audit failure in this disposable database; order/lines/schedule/outbox must all roll back.
      await admin.query(`CREATE FUNCTION synthetic_reject_po_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='PROCUREMENT_ORDER_ISSUED' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_po_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_reject_po_audit()`);
      await expect(service.createProcurementOrder(ctx,project,input())).rejects.toThrow('SYNTHETIC_AUDIT_FAILURE');
      expect(await counts()).toEqual(stable);
      await admin.query('DROP TRIGGER synthetic_po_audit_failure ON audit_events');
      // Two actual connections prove the shared lifecycle lock observes a closure committed ahead of the PO.
      const closing=await admin.connect();await closing.query('BEGIN');
      await closing.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);
      const attempted=service.createProcurementOrder(ctx,project,input()).then(value=>({value,error:null}),error=>({value:null,error}));
      try {
        let waiting=false;
        for(let i=0;i<100&&!waiting;i++) {
          waiting=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND usename='tc_app' AND query ILIKE '%FROM projects%') AS waiting")).rows[0].waiting;
          if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
        }
        expect(waiting).toBe(true);
        await closing.query("UPDATE projects SET status='CLOSED' WHERE id=$1",[project]);await closing.query('COMMIT');
        expect((await attempted).error?.response?.code).toBe('PROJECT_PROCUREMENT_LOCKED');
        expect(await counts()).toEqual(stable);
      } finally {await closing.query('ROLLBACK');closing.release();await attempted;}
    });
  });
});
