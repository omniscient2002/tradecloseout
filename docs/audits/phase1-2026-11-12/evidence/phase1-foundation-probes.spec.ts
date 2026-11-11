import { withDisposableDatabase } from '../../../../packages/db/test/helpers/disposable-database';
import { withTenantTransaction, consumePlanQuota, reconcileStorageQuotaOnFileStatusChange, redactSensitiveFields } from '@tradecloseout/db/tenant-tx';
import { assertMemberResourceScope, assertCurrentProjectAuthority } from '../../../../packages/db/src/project-authority';
import { TradeCloseoutScheduler } from '../../../../apps/worker/src/scheduler';
import { DocumentsService } from '../../../../apps/api/src/modules/documents/documents.service';
import { TenantDbService } from '../../../../apps/api/src/database/tenant-db.service';
import { randomUUID, createHash } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Redis from 'ioredis';
import { encryptFactor, decryptFactor, hashRecoveryCodeCandidates } from '../../../../apps/api/src/modules/identity/mfa-crypto';
import { MfaController } from '../../../../apps/api/src/modules/identity/mfa.controller';
import { IdempotencyInterceptor } from '../../../../apps/api/src/common/interceptors/idempotency.interceptor';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom } from 'rxjs';
import { PermissionGuard } from '../../../../apps/api/src/common/guards/permission.guard';
import { ReviewsController } from '../../../../apps/api/src/modules/reviews/reviews.controller';
import { ReviewsService } from '../../../../apps/api/src/modules/reviews/reviews.service';
import * as schema from '../../../../packages/db/src/schema';
import { getTableConfig } from 'drizzle-orm/pg-core';

jest.setTimeout(180000);
test('Phase 1 source-pinned foundation observations on fresh PG16/restricted tc_app',async()=>{
 const results:any[]=[];
 await withDisposableDatabase(async({admin,app})=>{
  async function fixture(){
   const org=randomUUID(),user=randomUUID(),project=randomUUID();
   await admin.query("INSERT INTO users(id,name) VALUES($1,'Foundation Fixture')",[user]);
   await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Foundation Fixture','Foundation Fixture','MH')",[org]);
   await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),org,user]);
   await admin.query("INSERT INTO projects(id,org_id,code,name,created_by,status) VALUES($1,$2,'P1-AUDIT','Foundation Project',$3,'ACTIVE')",[project,org,user]);
   const ctx:any={orgId:org,userId:user,orgRole:'R-OWNER',actorType:'MEMBER',projectId:project,ip:'127.0.0.1',userAgent:'fixture',requestId:randomUUID()};
   return {org,user,project,ctx};
  }
  async function scoped(ctx:any,fn:(c:any)=>Promise<any>){return withTenantTransaction(app,ctx,fn);}
  async function probe(id:string,name:string,fn:()=>Promise<any>){
   try{results.push({id,name,observed:await fn()});}catch(e:any){results.push({id,name,error:e.code||e.response?.code||e.constructor.name,message:e.message});}
  }
  async function audit(f:any){
   await scoped(f.ctx,async c=>c.query("INSERT INTO audit_events(id,org_id,actor_type,actor_user_id,action,entity_type,entity_id,request_id,ip,after_json) VALUES($1,$2,'USER',$3,'FOUNDATION_FIXTURE','ORGANISATION',$2,'fixture','127.0.0.1','{\"internal_note\":\"synthetic audit note\"}')",[randomUUID(),f.org,f.user]));
  }
  const scheduler=new TradeCloseoutScheduler(app,{} as any);
  await probe('P01','audit child partitions expose direct privileges without RLS',async()=>{
   return (await app.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete
    FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
    WHERE i.inhparent='audit_events'::regclass ORDER BY c.relname`)).rows;
  });
  await probe('P02','unscoped child partition read reveals tenant audit data',async()=>{
   const f=await fixture();await audit(f);
   const parent=await app.query('SELECT count(*)::int AS n FROM audit_events');
   const child=await app.query("SELECT count(*)::int AS n FROM audit_events_2026_11 WHERE org_id=$1",[f.org]);
   return {parentRows:parent.rows[0].n,childRows:child.rows[0].n};
  });
  await probe('P03','direct child UPDATE bypasses parent append-only control',async()=>{
   const f=await fixture();await audit(f);
   const r=await app.query("UPDATE audit_events_2026_11 SET ip='192.0.2.77' WHERE org_id=$1",[f.org]);
   const v=await scheduler.verifyAuditHashChainIntegrity();return {changed:r.rowCount,verifierAccepted:v.verifiedEvents>0};
  });
  await probe('P04','direct child DELETE removes audit history and verifier accepts missing tail',async()=>{
   const f=await fixture();await audit(f);
   const r=await app.query('DELETE FROM audit_events_2026_11 WHERE org_id=$1',[f.org]);
   await scheduler.verifyAuditHashChainIntegrity();return {deleted:r.rowCount,verifierAccepted:true};
  });
  await probe('P05','caller-supplied audit sequence can break hash ordering',async()=>{
   const f=await fixture();
   for(const seq of [1000000,1])await scoped(f.ctx,async c=>c.query("INSERT INTO audit_events(id,org_id,actor_type,action,entity_type,request_id,chain_seq) VALUES($1,$2,'USER','FIXTURE','ORGANISATION','fixture',$3)",[randomUUID(),f.org,seq]));
   let rejects=false;try{await scheduler.verifyAuditHashChainIntegrity();}catch{rejects=true;}
   await app.query('DELETE FROM audit_events_2026_11 WHERE org_id=$1',[f.org]);
   return {inserted:2,verifierRejects:rejects};
  });
  await probe('P06','storage quota reconciliation assigns text to bigint column',async()=>{
   const f=await fixture();return scoped(f.ctx,c=>reconcileStorageQuotaOnFileStatusChange(c,f.org,10n,'MARKED_READY'));
  });
  await probe('P07','migration 0015 already permits the package quota metric',async()=>{
   const f=await fixture();await scoped(f.ctx,c=>consumePlanQuota(c,f.org,'PACKAGE_GENERATIONS','2026-11',1n,10n));return {accepted:true};
  });
  await probe('P08','negative quota delta releases unrelated consumed usage',async()=>{
   const f=await fixture();await scoped(f.ctx,c=>consumePlanQuota(c,f.org,'SEATS','ALL_TIME',5n,10n));
   await scoped(f.ctx,c=>consumePlanQuota(c,f.org,'SEATS','ALL_TIME',-4n,10n));
   return (await admin.query('SELECT value::text FROM usage_counters WHERE org_id=$1',[f.org])).rows[0];
  });
  await probe('P09','nested credential-shaped fields survive audit redaction',async()=>{
   return redactSensitiveFields({token:'synthetic',nested:{otp:'synthetic'},authToken:'synthetic'});
  });
  await probe('P10','raw event payload can replace trusted outbox envelope fields',async()=>{
   const f=await fixture();await withTenantTransaction(app,f.ctx,async(c,emit)=>{emit({eventType:'PROJECT_CREATED',entityType:'PROJECT',entityId:f.project,afterJson:{orgId:'synthetic-forged-org',actorUserId:'synthetic-forged-actor'}});});
   return (await admin.query("SELECT payload_json->>'orgId' AS envelope_org,payload_json->>'actorUserId' AS envelope_actor FROM outbox_events WHERE org_id=$1",[f.org])).rows[0];
  });
  await probe('P11','unknown restrictive member scope fails open',async()=>{
   const f=await fixture();assertMemberResourceScope({...f.ctx,orgRole:'R-SITE',projectScope:{onlyAssets:['not-this-asset']}},'asset',{id:randomUUID()},true);return {allowed:true};
  });
  await probe('P12','malformed readOnly scope is ignored',async()=>{
   const f=await fixture();assertMemberResourceScope({...f.ctx,orgRole:'R-SITE',projectScope:{readOnly:'true'}},'asset',{id:randomUUID()},true);return {allowed:true};
  });
  await probe('P13','project authority treats a stale Owner role as current without membership check',async()=>{
   const f=await fixture();await admin.query("UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",[f.org,f.user]);
   await scoped(f.ctx,c=>assertCurrentProjectAuthority(c,f.ctx));return {allowed:true};
  });
  await probe('P14','live session fence allows suspended organisation after guard context was built',async()=>{
   const f=await fixture();const id=randomUUID(),generation=randomUUID(),hash=createHash('sha256').update(id).digest('hex');
   await admin.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,active_org_id,auth_generation,expires_at,absolute_expires_at) VALUES($1,$2,$3,$3,$4,$5,now()+interval '1 day',now()+interval '2 days')",[id,f.user,hash,f.org,generation]);
   await admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1",[f.org]);
   return scoped({...f.ctx,sessionId:id,authGeneration:generation},async c=>{await c.query("UPDATE projects SET name='Stale suspension mutation' WHERE org_id=$1 AND id=$2",[f.org,f.project]);return {committed:true};});
  });
  await probe('P15','owner digest tenant discovery sees zero owners under restricted RLS',async()=>{
   await fixture();return {rows:(await app.query("SELECT o.id FROM organisations o JOIN memberships m ON m.org_id=o.id AND m.role='R-OWNER' AND m.status='ACTIVE' WHERE o.status='ACTIVE'")).rowCount};
  });
  await probe('P16','default audit partition exists, preventing a false month-boundary outage finding',async()=>{
   return {exists:(await admin.query("SELECT to_regclass('audit_events_default') IS NOT NULL AS ok")).rows[0].ok};
  });
  await probe('P17','transaction-local tenant context resets after commit',async()=>{
   const f=await fixture();await scoped(f.ctx,async c=>c.query('SELECT 1'));return {rows:(await app.query('SELECT count(*)::int AS n FROM projects')).rows[0].n};
  });
  await probe('P18','scheduler lease expires while original owner still runs, allowing overlapping work',async()=>{
   const redis=new Redis(process.env.REDIS_URL||'redis://127.0.0.1:6379');
   const s=new TradeCloseoutScheduler(app,redis as any),key='phase1-fixture-'+randomUUID();let unlock!:()=>void,entered!:()=>void,count=0;
   const wait=new Promise<void>(r=>unlock=r),ready=new Promise<void>(r=>entered=r);
   try{
    const first=s.runWithLeaderLock(key,1,async()=>{count++;entered();await wait;});
    await ready;await new Promise(r=>setTimeout(r,1200));
    await s.runWithLeaderLock(key,1,async()=>{count++;});unlock();await first;return {concurrentExecutions:count};
   }finally{unlock?.();await redis.del('lock:sched:'+key);await redis.quit();}
  });
  await probe('P19','expired previous MFA key blocks decryption of current-key factors',async()=>{
   const keys=['AUTH_MFA_ENCRYPTION_KEY','AUTH_MFA_ENCRYPTION_KEY_PREVIOUS','AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
   try{
    process.env.AUTH_MFA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS=Buffer.alloc(32,8).toString('base64');process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT=new Date(Date.now()+60000).toISOString();
    const encrypted=encryptFactor('SYNTHETICFACTOR');process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT=new Date(Date.now()-60000).toISOString();
    return {decrypted:decryptFactor(encrypted)};
   }finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
  });
  await probe('P20','expired previous MFA key also blocks current recovery-code lookup',async()=>{
   const keys=['AUTH_MFA_ENCRYPTION_KEY','AUTH_MFA_ENCRYPTION_KEY_PREVIOUS','AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
   try{
    process.env.AUTH_MFA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS=Buffer.alloc(32,8).toString('base64');process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT=new Date(Date.now()-60000).toISOString();
    return {candidates:hashRecoveryCodeCandidates('SYNTHETIC').length};
   }finally{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
  });
  await probe('P21','generic idempotency persists real MFA enrollment secret as plaintext',async()=>{
   const f=await fixture(),id=randomUUID(),generation=randomUUID(),token=randomUUID(),hash=createHash('sha256').update(token).digest('hex');
   await admin.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,active_org_id,auth_generation,expires_at,absolute_expires_at) VALUES($1,$2,$3,$3,$4,$5,now()+interval '1 day',now()+interval '2 days')",[id,f.user,hash,f.org,generation]);
   const req:any={method:'POST',baseUrl:'',route:{path:'/api/v1/auth/mfa/enroll/start'},headers:{'idempotency-key':randomUUID()},cookies:{tc_session:token},body:{},params:{},query:{},ip:'127.0.0.1',auth:{userId:f.user,activeOrgId:f.org,sessionId:id,authGeneration:generation},userContext:{actorType:'USER'}};
   const res:any={statusCode:201,status:()=>res};const controller=new MfaController(app);
   const context:any={switchToHttp:()=>({getRequest:()=>req,getResponse:()=>res}),getHandler:()=>controller.beginEnrollment,getClass:()=>MfaController};
   const obs=await new IdempotencyInterceptor(app,new Reflector()).intercept(context,{handle:()=>defer(()=>controller.beginEnrollment(req))});
   const response:any=await lastValueFrom(obs);
   const stored=(await admin.query("SELECT response_json->>'manualSetupKey' AS secret FROM idempotency_keys WHERE org_id=$1",[f.org])).rows[0];
   return {secretPersisted:typeof stored?.secret==='string',sameAsReturned:stored?.secret===response.manualSetupKey};
  });
  await probe('P22','document list and detail ignore the current documentIds subset',async()=>{
   const f=await fixture(),a=randomUUID(),b=randomUUID(),scope={documentIds:[a]};
   await admin.query("UPDATE memberships SET role='R-DOC' WHERE org_id=$1 AND user_id=$2",[f.org,f.user]);
   await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,scope_json,added_by) VALUES($1,$2,$3,$4,'R-DOC',$5,$4)",[randomUUID(),f.org,f.project,f.user,JSON.stringify(scope)]);
   for(const d of [a,b])await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'Synthetic restricted document','DT-001','HVAC',$4)",[d,f.org,f.project,f.user]);
   const ctx:any={...f.ctx,actorType:'USER',orgRole:'R-DOC',projectRole:'R-DOC',projectScope:scope};
   const svc=new DocumentsService(new TenantDbService(app),{} as any);
   const list=await svc.listDocuments(ctx,f.project);const detail=await svc.getDocument(ctx,b);
   return {listed:list.length,restrictedListed:list.some((r:any)=>r.id===b),restrictedDetailReturned:Boolean(detail)};
  });
  await probe('P23','document delete ignores supported mode READ_ONLY resource restriction',async()=>{
   const f=await fixture(),doc=randomUUID(),scope={mode:'READ_ONLY'};
   await admin.query("UPDATE memberships SET role='R-PM' WHERE org_id=$1 AND user_id=$2",[f.org,f.user]);
   await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,scope_json,added_by) VALUES($1,$2,$3,$4,'R-PM',$5,$4)",[randomUUID(),f.org,f.project,f.user,JSON.stringify(scope)]);
   await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'Synthetic readonly document','DT-001','HVAC',$4)",[doc,f.org,f.project,f.user]);
   const ctx:any={...f.ctx,actorType:'USER',orgRole:'R-PM',projectRole:'R-PM',projectScope:scope};
   await new DocumentsService(new TenantDbService(app),{} as any).deleteDocument(ctx,doc);
   return {deleted:(await admin.query('SELECT deleted_at IS NOT NULL AS value FROM documents WHERE id=$1',[doc])).rows[0].value};
  });
  await probe('P24','bulk review guard and service permit decision after project membership removal',async()=>{
   const f=await fixture(),doc=randomUUID(),version=randomUUID(),object=randomUUID(),review=randomUUID(),uploader=randomUUID();
   await admin.query("INSERT INTO users(id,name) VALUES($1,'Synthetic Other Uploader')",[uploader]);
   await admin.query("UPDATE memberships SET role='R-QC' WHERE org_id=$1 AND user_id=$2",[f.org,f.user]);
   await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-QC','REMOVED',$4)",[randomUUID(),f.org,f.project,f.user]);
   await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'Synthetic pending submittal','DT-001','HVAC',$4)",[doc,f.org,f.project,uploader]);
   await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes) VALUES($1,$2,'fixture',$3,'application/pdf',0)",[object,f.org,randomUUID()]);
   await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,issue_date,uploaded_by,review_status) VALUES($1,$2,$3,$4,1,'R1',$5,current_date,$6,'IN_REVIEW')",[version,f.org,f.project,doc,object,uploader]);
   await admin.query('UPDATE documents SET latest_version_id=$1 WHERE id=$2',[version,doc]);
   await admin.query("INSERT INTO reviews(id,org_id,project_id,document_version_id,reviewer_subject_type,reviewer_subject_id,reviewer_user_id) VALUES($1,$2,$3,$4,'USER',$5,$5)",[review,f.org,f.project,version,f.user]);
   const ctx:any={...f.ctx,actorType:'USER',orgRole:'R-QC',projectId:undefined};
   const req:any={user:{orgId:f.org,userId:f.user,orgRole:'R-QC'},userContext:ctx,params:{},body:{reviewIds:[review]},method:'POST',path:'/api/v1/reviews/bulk-decisions',ip:'127.0.0.1'};
   const allowed=await new PermissionGuard(new Reflector(),app).canActivate({switchToHttp:()=>({getRequest:()=>req}),getClass:()=>ReviewsController,getHandler:()=>ReviewsController.prototype.bulkDecisions} as any);
   const result=await new ReviewsService(new TenantDbService(app)).bulkDecisions(req.userContext,{reviewIds:[review],decision:'REJECT',comment:'Synthetic authority-only fixture rejection'});
   return {guardAllowed:allowed,projectResolved:Boolean(req.userContext.projectId),resultSuccess:result.results[0].success,decision:(await admin.query('SELECT decision FROM reviews WHERE id=$1',[review])).rows[0].decision};
  });
  await probe('P25','Drizzle table columns disagree with the complete migrated schema',async()=>{
   const diffs:any[]=[];
   for(const value of Object.values(schema)){
    let cfg:any;try{cfg=getTableConfig(value as any);}catch{continue;}
    const actual=(await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[cfg.name])).rows.map(r=>r.column_name);
    const expected=cfg.columns.map((c:any)=>c.name);const missing=expected.filter((c:string)=>!actual.includes(c)),extra=actual.filter((c:string)=>!expected.includes(c));
    if(missing.length||extra.length)diffs.push({table:cfg.name,definedButAbsent:missing,migratedButUndefined:extra});
   }
   return diffs;
  });
  const output=process.env.PHASE1_AUDIT_OUTPUT_DIR||join(tmpdir(),'tradecloseout-phase1-audit');
  mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'foundation-probes.json'),JSON.stringify({sourceSha:'9ed91a9e96c77c9eff967f6c845d18c38fb62ac6',probes:results},null,2));
 });
 console.log(JSON.stringify(results,null,2));
 expect(results).toHaveLength(25);
 const get=(id:string)=>results.find(r=>r.id===id);
 expect(get('P02').observed).toEqual({parentRows:0,childRows:1});
 expect(get('P03').observed).toEqual({changed:1,verifierAccepted:true});
 expect(get('P04').observed.deleted).toBe(1);
 expect(get('P06').error).toBe('42804');
 expect(get('P07').observed.accepted).toBe(true);
 expect(get('P18').observed.concurrentExecutions).toBe(2);
 expect(get('P21').observed).toEqual({secretPersisted:true,sameAsReturned:true});
 expect(get('P22').observed).toEqual({listed:2,restrictedListed:true,restrictedDetailReturned:true});
 expect(get('P23').observed.deleted).toBe(true);
 expect(get('P24').observed).toEqual({guardAllowed:true,projectResolved:false,resultSuccess:true,decision:'REJECT'});
});
