import {randomUUID,createHash} from 'crypto';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants} from '../../../packages/db/test/helpers/fixtures';
import {withTenantTransaction} from '@tradecloseout/db';
import {TenantDbService} from '../src/database/tenant-db.service';
import {SessionCsrfGuard} from '../src/common/guards/session-csrf.guard';
import {DocumentsService} from '../src/modules/documents/documents.service';
import {IdentityController} from '../src/modules/identity/identity.controller';
import {isRetainedOrganisationOperation} from '@tradecloseout/shared';
jest.setTimeout(180000);
it('reviewed suspended access retains scoped reads and versioned downloads, fences writes and rechecks revoked authority',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId,tenants:[tenant,foreign]}=await seedTenants(admin),org=tenant.orgId,project=tenant.projectIds[0],session=randomUUID(),generation=randomUUID();
  const token=randomUUID(),csrf=randomUUID(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",[randomUUID(),org,userId]);
  await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,expires_at,absolute_expires_at,mfa_verified,mfa_verified_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day',now()+interval '2 days',true,now())`,[session,userId,org,hash(token),hash(csrf),generation]);
  const guard=new SessionCsrfGuard(app),db=new TenantDbService(app);
  const request=(method='GET',path=`/api/v1/projects/${project}`,params:any={id:project}):any=>({method,path,params,headers:{'x-csrf-token':csrf,'x-auth-generation':generation},cookies:{tc_session:token},ip:'127.0.0.1'});
  const evaluate=(req:any)=>guard.canActivate({switchToHttp:()=>({getRequest:()=>req})} as any);
  await admin.query("UPDATE organisations SET status='SUSPENDED',row_version=row_version+1 WHERE id=$1",[org]);
  await expect(evaluate(request())).rejects.toMatchObject({response:{code:'ORG_ACCESS_SUSPENDED'}});
  await expect(app.query('SELECT review_organisation_retained_reads($1,$2,$3,$4,now()+interval \'1 day\')',[randomUUID(),org,'BILLING','https://example.invalid/synthetic-review'])).rejects.toMatchObject({code:'42501'});
  const reviewer='synthetic_recovery_'+randomUUID().replaceAll('-',''),grant=randomUUID(),expiry=new Date(Date.now()+3600_000).toISOString();
  await admin.query(`CREATE ROLE ${reviewer} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  const operator=await admin.connect();
  try{
   await admin.query(`GRANT tc_org_recovery_reviewer TO ${reviewer}`);
   await operator.query(`SET SESSION AUTHORIZATION ${reviewer}`);
   await operator.query('SELECT review_organisation_retained_reads($1,$2,$3,$4,$5)',[grant,org,'BILLING','https://example.invalid/synthetic-reviewed-recovery',expiry]);
   await operator.query('SELECT review_organisation_retained_reads($1,$2,$3,$4,$5)',[grant,org,'BILLING','https://example.invalid/synthetic-reviewed-recovery',expiry]);
  }finally{await operator.query('RESET SESSION AUTHORIZATION');operator.release();}
  try{
   const admitted=request();await expect(evaluate(admitted)).resolves.toBe(true);expect(admitted.userContext.readOnlyOrganisation).toBe(true);
   const ctx=admitted.userContext;
   expect(await db.withTenantContext(ctx,async c=>(await c.query('SELECT id FROM projects WHERE org_id=$1 AND id=$2',[org,project])).rows[0].id)).toBe(project);
   await expect(withTenantTransaction(app,ctx,async c=>c.query("UPDATE projects SET name='Forbidden read mutation' WHERE id=$1",[project]))).rejects.toThrow('AUTH_RETAINED_ACCESS_READ_ONLY');
   await expect(db.withTenantContext({...ctx,projectWrite:true},async()=>true)).rejects.toThrow('AUTH_RETAINED_ACCESS_READ_ONLY');
   expect(await db.withTenantContext(ctx,async c=>(await c.query('SELECT id FROM projects WHERE id=$1',[foreign.projectIds[0]])).rows)).toEqual([]);
   for(const method of ['POST','PATCH','DELETE'])await expect(evaluate(request(method))).rejects.toMatchObject({response:{code:'ORG_ACCESS_SUSPENDED'}});
   await expect(evaluate(request('GET',`/api/v1/projects/${project}/future-unsafe-route`))).rejects.toMatchObject({response:{code:'ORG_ACCESS_SUSPENDED'}});
   const object=randomUUID(),document=randomUUID(),version=randomUUID();
   await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes,sha256,status,observed_size_bytes,provider_version_id) VALUES($1,$2,'synthetic-recovery',$3,'application/pdf',100,$4,'READY',100,'synthetic-version')",[object,org,object,'a'.repeat(64)]);
   await admin.query("INSERT INTO documents(id,org_id,project_id,title,category_key,doc_type_key,created_by) VALUES($1,$2,$3,'Synthetic retained file','SYNTHETIC','SYNTHETIC',$4)",[document,org,project,userId]);
   await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,issue_date,uploaded_by) VALUES($1,$2,$3,$4,1,'R1',$5,'READY',CURRENT_DATE,$6)",[version,org,project,document,object,userId]);
   const signer=jest.fn().mockResolvedValue('https://example.invalid/synthetic-download');
   const download=request('GET',`/api/v1/document-versions/${version}/download-url`,{id:version});await evaluate(download);
   expect(await new DocumentsService(db,{createSignedDownloadUrl:signer} as any).getDownloadUrl({...download.userContext,projectId:project},version)).toMatchObject({versionId:version,downloadUrl:'https://example.invalid/synthetic-download'});
   expect(signer).toHaveBeenCalledWith(expect.objectContaining({objectKey:object,versionId:'synthetic-version'}));
   expect((await new IdentityController(app,{} as any,{} as any,{} as any).getOrgs(admitted)).map((o:any)=>o.id)).toContain(org);
   await admin.query("UPDATE sessions SET mfa_verified_at=now()-interval '13 hours' WHERE id=$1",[session]);
   await expect(db.withTenantContext(ctx,async()=>true)).rejects.toThrow('AUTH_RETAINED_ACCESS_MFA_REQUIRED');
   await admin.query('UPDATE sessions SET mfa_verified_at=now() WHERE id=$1',[session]);
   await admin.query("UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2",[org,userId]);
   await expect(evaluate(request())).rejects.toThrow();await expect(db.withTenantContext(ctx,async()=>true)).rejects.toThrow();
   await admin.query("UPDATE memberships SET status='ACTIVE' WHERE org_id=$1 AND user_id=$2",[org,userId]);
   await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1",[userId]);await expect(evaluate(request())).rejects.toThrow();
   await admin.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[userId]);
   const revoker=await admin.connect();let pendingRead:Promise<unknown>|undefined;
   try{
    await revoker.query(`SET SESSION AUTHORIZATION ${reviewer}`);await revoker.query('BEGIN');
    await revoker.query('SELECT revoke_organisation_retained_reads($1)',[grant]);
    let callbackRan=false;
    pendingRead=db.withTenantContext(ctx,async()=>{callbackRan=true;return true;});
    await new Promise(resolve=>setTimeout(resolve,75));expect(callbackRan).toBe(false);
    await revoker.query('COMMIT');
    await expect(pendingRead).rejects.toThrow('AUTH_ORGANISATION_INACTIVE');
   }finally{await revoker.query('ROLLBACK');await revoker.query('RESET SESSION AUTHORIZATION');revoker.release();}
   await expect(evaluate(request())).rejects.toThrow();await expect(db.withTenantContext(ctx,async()=>true)).rejects.toThrow('AUTH_ORGANISATION_INACTIVE');
   expect((await admin.query("SELECT count(*)::int AS n FROM auth_security_events WHERE org_id=$1 AND event_type='ORG_RETAINED_READ'",[org])).rows[0].n).toBeGreaterThan(0);
   expect(isRetainedOrganisationOperation('POST',`/api/v1/projects/${project}/archive-exports`)).toBe(false);
   const expireOperator=await admin.connect();
   try{
    await expireOperator.query(`SET SESSION AUTHORIZATION ${reviewer}`);
    await expireOperator.query('SELECT review_organisation_retained_reads($1,$2,$3,$4,clock_timestamp()+interval \'1500 milliseconds\')',[randomUUID(),org,'POLICY','https://example.invalid/synthetic-short-expiry']);
   }finally{await expireOperator.query('RESET SESSION AUTHORIZATION');expireOperator.release();}
   await admin.query('SELECT pg_sleep(1.6)');
   await expect(db.withTenantContext(ctx,async()=>true)).rejects.toThrow('AUTH_ORGANISATION_INACTIVE');
   const versionOperator=await admin.connect();
   try{await versionOperator.query(`SET SESSION AUTHORIZATION ${reviewer}`);await versionOperator.query('SELECT review_organisation_retained_reads($1,$2,$3,$4,$5)',[randomUUID(),org,'POLICY','https://example.invalid/synthetic-version-binding',expiry]);}
   finally{await versionOperator.query('RESET SESSION AUTHORIZATION');versionOperator.release();}
   await admin.query("UPDATE organisations SET status='ACTIVE',row_version=row_version+1 WHERE id=$1",[org]);
   const active=request();await evaluate(active);expect(active.userContext.readOnlyOrganisation).toBe(false);
   expect(await db.withTenantContext(active.userContext,async c=>(await c.query("SELECT current_setting('app.retained_organisation_read',true) AS mode")).rows[0].mode)).not.toBe('true');
   await admin.query("UPDATE organisations SET status='SUSPENDED',row_version=row_version+1 WHERE id=$1",[org]);
   await expect(evaluate(request())).rejects.toThrow();
  }finally{await admin.query(`DROP ROLE ${reviewer}`);}
 });
});
