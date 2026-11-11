const fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {Reflector}=require('@nestjs/core');
const {of,lastValueFrom}=require('rxjs');
const root='/tmp/tc-g01-implementation';
const load=p=>require(root+'/'+p);
const {withDisposableDatabase}=load('packages/db/test/helpers/disposable-database.ts');
const {SessionCsrfGuard}=load('apps/api/src/common/guards/session-csrf.guard.ts');
const {PermissionGuard}=load('apps/api/src/common/guards/permission.guard.ts');
const {VisibilityProjectionInterceptor}=load('apps/api/src/common/interceptors/visibility-projection.interceptor.ts');
const {TenantDbService}=load('apps/api/src/database/tenant-db.service.ts');
const {AssetsController}=load('apps/api/src/modules/assets/assets.controller.ts');
const {AssetsService}=load('apps/api/src/modules/assets/assets.service.ts');
const {ChecklistsController}=load('apps/api/src/modules/checklists/checklists.controller.ts');
const {ChecklistsService}=load('apps/api/src/modules/checklists/checklists.service.ts');
const {DocumentsController}=load('apps/api/src/modules/documents/documents.controller.ts');
const {DocumentsService}=load('apps/api/src/modules/documents/documents.service.ts');
const {PartiesController}=load('apps/api/src/modules/parties/parties.controller.ts');
const {PartiesService,GUEST_GRANT_PROFILES}=load('apps/api/src/modules/parties/parties.service.ts');
const {SupplierGuestService}=load('apps/api/src/modules/parties/supplier-guest.service.ts');
const {ProjectsController}=load('apps/api/src/modules/projects/projects.controller.ts');
const {ProjectsService}=load('apps/api/src/modules/projects/projects.service.ts');
const {ReviewsController}=load('apps/api/src/modules/reviews/reviews.controller.ts');
const {HandoverController}=load('apps/api/src/modules/handover/handover.controller.ts');
const {HandoverService}=load('apps/api/src/modules/handover/handover.service.ts');
const {BillingController}=load('apps/api/src/modules/billing/billing.controller.ts');
const {hasPermission,evaluateEffectivePermission}=load('packages/shared/src/permissions.ts');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(sha!=='863e6e0c56ad4a92af2580fbcbfc179832056b2d')throw Error('SOURCE_CHANGED');
process.env.NODE_ENV='production';
process.env.AUTH_OTP_HMAC_KEY='G02-disposable-only-auth-event-key-000000000';
const evidence={started_at:new Date().toISOString(),source_sha:sha,source_checkout_status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,method:'actual source guards/controllers/services plus strict-production loopback HTTP; restricted PostgreSQL and seeded authentication fixtures, no real provider',fixtures_only:true,probes:[]};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function probe(name,fn){
  try{evidence.probes.push({name,status:'COMPLETED',result:await fn()});}
  catch(e){evidence.probes.push({name,status:'REJECTED',http_status:e.getStatus?.()??null,code:e.code??e.getResponse?.()?.code??null,message:e.message});}
}
async function main(){
await withDisposableDatabase(async({admin,app,name:dbName})=>{
  evidence.postgres=(await admin.query('SHOW server_version')).rows[0].server_version;
  evidence.migrations=(await admin.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
  evidence.runtime=(await app.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  const org=randomUUID(),foreignOrg=randomUUID(),p1=randomUUID(),p2=randomUUID(),pForeign=randomUUID();
  const supplier=randomUUID(),clientParty=randomUUID(),assetA=randomUUID(),assetB=randomUUID();
  const rA=randomUUID(),rB=randomUUID(),snapshot=randomUUID(),docA=randomUUID(),docB=randomUUID(),verA=randomUUID(),verB=randomUUID();
  const actors={};
  for(const [name,role] of Object.entries({owner:'R-OWNER',site:'R-SITE',reviewer:'R-REVIEWER',doc:'R-DOC',hybrid:'R-SITE',projectpm:'R-SITE',auditor:'R-AUDITOR',guest:'GUEST',client:'GUEST'})){
    const id=randomUUID(),session=randomUUID(),generation=randomUUID(),token='g02-fixture-'+randomUUID(),csrf='g02-csrf-'+randomUUID();
    actors[name]={id,session,generation,token,csrf,role};
    await admin.query("INSERT INTO users(id,name,status) VALUES($1,$2,'ACTIVE')",[id,'G02 '+name+' Fixture']);
    await admin.query("INSERT INTO user_identities(id,user_id,type,value) VALUES($1,$2,'EMAIL',$3)",[randomUUID(),id,name+'@g02-fixture.example.test']);
  }
  for(const [id,label]of [[org,'Scope'],[foreignOrg,'Foreign']])await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,$2,$2,'KA','ACTIVE')",[id,'G02 '+label+' Fixture']);
  await admin.query('UPDATE organisations SET doc_controller_org_wide_download=true WHERE id=$1',[org]);
  for(const a of Object.values(actors).filter(a=>a.role!=='GUEST'))await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),org,a.id,a.role]);
  for(const [id,o,code] of [[p1,org,'G02-A'],[p2,org,'G02-B'],[pForeign,foreignOrg,'G02-F']])await admin.query("INSERT INTO projects(id,org_id,code,name,created_by,status) VALUES($1,$2,$3,$3,$4,'ACTIVE')",[id,o,code,actors.owner.id]);
  for(const [id,name,type]of [[supplier,'G02 Other Supplier','SUPPLIER'],[clientParty,'G02 Client','CLIENT']])await admin.query("INSERT INTO parties(id,org_id,name,types,email,status) VALUES($1,$2,$3,ARRAY[$4]::text[],$5,'ACTIVE')",[id,org,name,type,id+'@g02-fixture.example.test']);
  await admin.query('UPDATE projects SET client_party_id=$2 WHERE id=$1',[p1,clientParty]);
  for(const [id,tag]of [[assetA,'G02-A1'],[assetB,'G02-A2']])await admin.query("INSERT INTO assets(id,org_id,project_id,tag,name,category_key,created_by) VALUES($1,$2,$3,$4,$4,'G02-AUTHZ-FIXTURE',$5)",[id,org,p1,tag,actors.owner.id]);
  await admin.query("INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by) VALUES($1,$2,$3,1,'ACTIVE','{}','{}','{}',$4,$5)",[snapshot,org,p1,'a'.repeat(64),actors.owner.id]);
  for(const [id,key]of [[rA,'G02-ASSIGNED'],[rB,'G02-UNASSIGNED']])await admin.query("INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,group_key,title,doc_type_key,mandatory) VALUES($1,$2,$3,$4,$5,'AUTHZ_FIXTURE',$5,'G02-AUTHZ-FIXTURE',false)",[id,org,p1,snapshot,key]);
  for(const [name,role]of [['site','R-SITE'],['reviewer','R-REVIEWER'],['doc','R-DOC'],['hybrid','R-QC'],['projectpm','R-PM']])await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,scope_json,added_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),org,p1,actors[name].id,role,JSON.stringify(name==='site'?{assetIds:[assetA],requirementIds:[rA]}:{}),actors.owner.id]);
  for(const [name,type,party]of [['guest','SUPPLIER_UPLOAD',supplier],['client','CLIENT_VIEW',clientParty]]){
    const id=randomUUID();actors[name].grant=id;
    const profile=GUEST_GRANT_PROFILES[type];
    await admin.query("INSERT INTO guest_grants(id,org_id,project_id,party_id,role,grant_type,capabilities,scope_json,token_hash,target_email,principal_user_id,created_by,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '1 day','ACTIVE')",[id,org,p1,party,profile.role,type,profile.capabilities,JSON.stringify({requirementIds:[rA]}),digest(randomUUID()),name+'@g02-fixture.example.test',actors[name].id,actors.owner.id]);
  }
  for(const a of Object.values(actors))await admin.query("INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,guest_grant_id,expires_at,mfa_verified,mfa_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 day',true,now())",[a.session,a.id,org,digest(a.token),digest(a.csrf),a.generation,a.grant??null]);
  for(const [doc,version,project,actor]of [[docA,verA,p1,actors.guest],[docB,verB,p2,actors.owner]]){
    const object=randomUUID();
    await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,$4,'G02-AUTHZ-FIXTURE','G02-AUTHZ-FIXTURE',$5)",[doc,org,project,doc===docA?'G02 guest fixture':'G02 nonmember project fixture',actor.id]);
    await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,size_bytes,mime,status,provider_version_id) VALUES($1,$2,'g02-fixture',$3,3,'application/pdf','PROCESSING','g02-fixture-version')",[object,org,'g02/'+object]);
    await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,review_status,issue_date,uploaded_by,uploaded_by_grant_id) VALUES($1,$2,$3,$4,1,'A',$5,'PROCESSING','NOT_SUBMITTED',CURRENT_DATE,$6,$7)",[version,org,project,doc,object,actor.id,actor.grant??null]);
    await admin.query('UPDATE documents SET latest_version_id=$1 WHERE id=$2',[version,doc]);
  }
  await admin.query('INSERT INTO document_requirements(id,org_id,project_id,document_id,requirement_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),org,p1,docA,rA]);
  const review=randomUUID();
  await admin.query("INSERT INTO reviews(id,org_id,project_id,document_version_id,reviewer_subject_type,reviewer_subject_id,reviewer_user_id) VALUES($1,$2,$3,$4,'USER',$5,$5)",[review,org,p1,verA,actors.projectpm.id]);
  const pkg=randomUUID();
  await admin.query("INSERT INTO handover_packages(id,org_id,project_id,version_no,status,requested_by) VALUES($1,$2,$3,1,'DRAFT',$4)",[pkg,org,p2,actors.owner.id]);
  const po=randomUUID(),line=randomUUID(),obligation=randomUUID();
  await admin.query("INSERT INTO procurement_orders(id,org_id,project_id,po_number,supplier_party_id,created_by) VALUES($1,$2,$3,'G02-PO',$4,$5)",[po,org,p1,supplier,actors.owner.id]);
  await admin.query("INSERT INTO procurement_order_lines(id,org_id,project_id,po_id,line_no,asset_category_key,description) VALUES($1,$2,$3,$4,1,'G02-AUTHZ-FIXTURE','Disposable authorization fixture')",[line,org,p1,po]);
  await admin.query("INSERT INTO supplier_document_obligations(id,org_id,project_id,po_line_id,doc_type_key,title,supplier_party_id,requirement_id) VALUES($1,$2,$3,$4,'G02-AUTHZ-FIXTURE','Other requirement obligation',$5,$6)",[obligation,org,p1,line,supplier,rB]);
  const db=new TenantDbService(app),reflector=new Reflector();
  const assets=new AssetsService(app),checks=new ChecklistsService(app),docs=new DocumentsService(db,{}),parties=new PartiesService(db),projects=new ProjectsService(app),handover=new HandoverService(app,{});
  async function auth(name,klass,handler,params,route,method='GET'){
    const a=actors[name];
    const req={method,path:route.replace(/:([A-Za-z]+)/g,(_,k)=>params[k]||k),route:{path:route},params:{...params},body:{},cookies:{tc_session:a.token},headers:{'x-csrf-token':a.csrf,'x-auth-generation':a.generation,'x-request-id':randomUUID()},ip:'192.0.2.41'};
    const context={switchToHttp:()=>({getRequest:()=>req}),getHandler:()=>klass.prototype[handler],getClass:()=>klass};
    await new SessionCsrfGuard(app).canActivate(context);
    await new PermissionGuard(reflector,app).canActivate(context);
    return {req,ctx:req.userContext,context};
  }
  const projectRoute='/api/v1/projects/:projectId';
  await probe('dual_permission_evaluators',async()=>({runtime:hasPermission({orgRole:'R-REVIEWER'},'package.download'),alternate:evaluateEffectivePermission('package.download',{orgRole:'R-REVIEWER',isProjectMember:false,projectStatus:'ACTIVE'}),additive_scope:hasPermission({orgRole:'R-AUDITOR',projectRole:'R-SITE'},'document.download')}));
  await probe('internal_scope_json_read',async()=>{
    const {ctx}=await auth('site',AssetsController,'getAsset',{projectId:p1,id:assetB},projectRoute+'/assets/:id');
    const result=await assets.getAsset(ctx,p1,assetB);return {read_outside_scope:result.id===assetB};
  });
  await probe('internal_scope_json_write',async()=>{
    const {ctx}=await auth('site',AssetsController,'updateAsset',{projectId:p1,id:assetB},projectRoute+'/assets/:id','PATCH');
    await assets.updateAsset(ctx,p1,assetB,{name:'G02 modified outside assigned asset scope'});
    return {persisted:(await admin.query('SELECT name FROM assets WHERE id=$1',[assetB])).rows[0].name};
  });
  await probe('supplier_reads_unassigned_requirement',async()=>{
    const {ctx}=await auth('guest',ChecklistsController,'listRequirements',{projectId:p1},projectRoute+'/requirements');
    const result=await checks.listRequirements(ctx,p1);return {count:result.length,unassigned_visible:result.some(r=>r.id===rB)};
  });
  await probe('supplier_links_document_to_unassigned_requirement',async()=>{
    const {ctx}=await auth('guest',DocumentsController,'linkBatchEvidence',{projectId:p1,documentId:docA},projectRoute+'/documents/:documentId/batch-links','POST');
    await docs.linkBatchEvidence(ctx,p1,docA,[],[rB]);
    return {link_count:(await admin.query('SELECT count(*)::int AS n FROM document_requirements WHERE document_id=$1 AND requirement_id=$2',[docA,rB])).rows[0].n,requirement_status:(await admin.query('SELECT status FROM requirements WHERE id=$1',[rB])).rows[0].status};
  });
  await probe('supplier_mints_new_grant_and_reassigns_requirement',async()=>{
    const {ctx}=await auth('guest',PartiesController,'createSupplierLink',{projectId:p1},projectRoute+'/supplier-links','POST');
    const result=await new SupplierGuestService(app).createScopedSupplierUploadLink(ctx,p1,{supplierPartyId:supplier,requirementIds:[rB]});
    const row=(await admin.query('SELECT scope_json,created_by FROM guest_grants WHERE id=$1',[result.grantId])).rows[0];
    return {new_grant_created_by_guest:row.created_by===actors.guest.id,new_grant_includes_unassigned_requirement:row.scope_json.requirementIds.includes(rB)};
  });
  await probe('supplier_accepts_unassigned_pending_obligation_without_evidence',async()=>{
    const {ctx}=await auth('guest',PartiesController,'intakeSupplierObligation',{projectId:p1,id:obligation},projectRoute+'/supplier-obligations/:id/intake','POST');
    await parties.intakeSupplierObligation(ctx,p1,obligation,{});
    return (await admin.query('SELECT status,document_version_id FROM supplier_document_obligations WHERE id=$1',[obligation])).rows[0];
  });
  await probe('client_reads_internal_member_identifiers_after_projection',async()=>{
    const {ctx,context}=await auth('client',ProjectsController,'listProjectMembers',{id:p1},'/api/v1/projects/:id/members');
    const rows=await projects.listProjectMembers(ctx,p1);
    const projected=await lastValueFrom(new VisibilityProjectionInterceptor(reflector).intercept(context,{handle:()=>of(rows)}));
    return {identifiers:projected.map(r=>r.identifier).filter(Boolean),contains_internal_contact:projected.some(r=>r.identifier==='site@g02-fixture.example.test')};
  });
  await probe('reviewer_reads_unassigned_project_package',async()=>{
    const {ctx}=await auth('reviewer',HandoverController,'getProjectPackage',{projectId:p2,id:pkg},projectRoute+'/packages/:id');
    const result=await handover.getProjectPackage(ctx,p2,pkg);return {foreign_project_package_visible:result.id===pkg,has_project_membership:!!(await admin.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2',[p2,actors.reviewer.id])).rows.length};
  });
  await probe('nested_upload_completion_uses_foreign_project_version',async()=>{
    const {ctx,req}=await auth('site',DocumentsController,'completeUpload',{projectId:p1,id:verB},projectRoute+'/document-versions/:id/complete-upload','POST');
    const result=await new DocumentsController(docs).completeUpload(req,verB,{});
    return {returned_foreign_version:result.versionId===verB,returned_foreign_document:result.documentId===docB};
  });
  await probe('direct_upload_completion_foreign_project_negative',async()=>{
    await auth('site',DocumentsController,'completeUpload',{id:verB},'/api/v1/document-versions/:id/complete-upload','POST');return {unexpected_allowed:true};
  });
  await probe('project_role_read_decision_nested',async()=>{
    const {req}=await auth('projectpm',ReviewsController,'listReviews',{projectId:p1},projectRoute+'/reviews');return {allowed:true,project_role:req.user.projectRole};
  });
  await probe('project_role_read_decision_direct',async()=>{
    await auth('projectpm',ReviewsController,'getReview',{id:review},'/api/v1/reviews/:id');return {unexpected_allowed:true};
  });
  await probe('project_qc_role_not_supported',async()=>{
    await auth('hybrid',ReviewsController,'listReviews',{projectId:p1},projectRoute+'/reviews');return {unexpected_allowed:true};
  });
  await probe('auditor_review_read_denied_by_decision_permission',async()=>{
    await auth('auditor',ReviewsController,'listReviews',{projectId:p1},projectRoute+'/reviews');return {unexpected_allowed:true};
  });
  await probe('document_download_toggle_true_not_loaded',async()=>{
    const {req}=await auth('doc',ProjectsController,'getProject',{id:p1},'/api/v1/projects/:id');
    return {database_setting:(await admin.query('SELECT doc_controller_org_wide_download FROM organisations WHERE id=$1',[org])).rows[0].doc_controller_org_wide_download,guard_setting:req.user.docControllerOrgWideDownload};
  });
  await probe('doc_controller_creates_export_without_export_permission',async()=>{
    const {ctx}=await auth('doc',HandoverController,'exportProjectArchive',{projectId:p1},projectRoute+'/archive-exports','POST');
    const result=await handover.exportProjectArchive(ctx,p1,{});return {export_permission:hasPermission({orgRole:'R-DOC'},'export.data').allowed,export_created:!!result.exportId,status:result.status,purpose_absent:true};
  });
  await probe('admin_enters_billing_management',async()=>{
    actors.admin={...actors.owner};
    await admin.query("UPDATE memberships SET role='R-ADMIN' WHERE user_id=$1 AND org_id=$2",[actors.owner.id,org]);
    const {req}=await auth('admin',BillingController,'recordTds',{id:randomUUID()},'/api/v1/billing/invoices/:id/tds','POST');return {allowed:true,role:req.auth.orgRole};
  });
  await probe('actual_production_mode_http_routes',async()=>{
    const listener=createServer();
    await new Promise(r=>listener.listen(0,'127.0.0.1',r));
    const port=listener.address().port;await new Promise(r=>listener.close(r));
    const runtime=new URL(process.env.APP_DATABASE_URL);runtime.pathname='/'+dbName;
    const env={...process.env,NODE_ENV:'production',API_PORT:String(port),APP_DATABASE_URL:runtime.toString(),
      REDIS_URL:'redis://127.0.0.1:56389',AUTH_CSRF_KEY:'g02-disposable-only-csrf-key-at-least-32',
      AUTH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,21).toString('base64'),AUTH_DELIVERY_CALLBACK_KEY:'g02-disposable-only-callback-key-at-least-32',
      FRONTEND_URL:'https://g02-fixture.example.test',PUBLIC_APP_URL:'https://g02-fixture.example.test',AUTH_TRUSTED_PROXY_CIDRS:'direct',
      DLT_SMS_URL:'https://invalid.example.test/send',DLT_SMS_STATUS_URL:'https://invalid.example.test/status',
      MAIL_GATEWAY_URL:'https://invalid.example.test/send',MAIL_STATUS_URL:'https://invalid.example.test/status',
      DLT_SMS_API_KEY:'g02-no-provider',MAIL_API_KEY:'g02-no-provider',MAIL_FROM_ADDRESS:'security@g02-fixture.example.test',
      DLT_SENDER_ID:'G02TEST',DLT_ENTITY_ID:'G02-FIXTURE',DLT_OTP_TEMPLATE_ID:'G02-OTP-FIXTURE',
      ENABLE_DEBUG_OTP:'false',ENABLE_OUTBOX_DELIVERY:'false',AWS_EC2_METADATA_DISABLED:'true'};
    const child=spawn(process.execPath,[root+'/apps/api/dist/apps/api/src/main.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let startupLog='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>startupLog=(startupLog+chunk).slice(-16000));
    const base='http://127.0.0.1:'+port;
    async function request(who,path,method='GET',body){
      const a=actors[who];
      const res=await fetch(base+path,{method,headers:{Cookie:'tc_session='+a.token,'x-csrf-token':a.csrf,
        'x-auth-generation':a.generation,'Idempotency-Key':randomUUID(),'Content-Type':'application/json',
        Origin:env.FRONTEND_URL},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      const text=await res.text();let value;try{value=JSON.parse(text);}catch{value=null;}
      return {status:res.status,value};
    }
    try{
      let ready=false;for(let i=0;i<100;i++){
        try{const r=await fetch(base+'/api/v1/auth/me',{signal:AbortSignal.timeout(1000)});if(r.status===401){ready=true;break;}}catch{}
        await new Promise(r=>setTimeout(r,100));
      }
      if(!ready)throw new Error('FIXTURE_API_BOOT_FAILED: '+startupLog.slice(-2000));
      // Restore authorization fixture state so HTTP write probes exercise fresh transitions.
      await admin.query('DELETE FROM document_requirements WHERE document_id=$1 AND requirement_id=$2',[docA,rB]);
      await admin.query("UPDATE requirements SET status='NOT_STARTED',owner_party_id=NULL WHERE id=$1",[rB]);
      await admin.query("UPDATE supplier_document_obligations SET status='PENDING',document_version_id=NULL WHERE id=$1",[obligation]);
      const outcomes={};
      const requirements=await request('guest',`/api/v1/projects/${p1}/requirements`);
      outcomes.guest_unassigned_requirements={status:requirements.status,unassigned_visible:Array.isArray(requirements.value)&&requirements.value.some(r=>r.id===rB)};
      const batch=await request('guest',`/api/v1/projects/${p1}/documents/${docA}/batch-links`,'POST',{assetIds:[],requirementIds:[rB]});
      outcomes.guest_unassigned_batch_link={status:batch.status,linked_count:batch.value?.linkedRequirementsCount};
      const link=await request('guest',`/api/v1/projects/${p1}/supplier-links`,'POST',{supplierPartyId:supplier,requirementIds:[rB]});
      outcomes.guest_mints_new_link={status:link.status,new_grant_returned:typeof link.value?.grantId==='string'};
      const intake=await request('guest',`/api/v1/projects/${p1}/supplier-obligations/${obligation}/intake`,'POST',{});
      outcomes.guest_accepts_unassigned_obligation={status:intake.status,obligation_status:intake.value?.status,version:intake.value?.documentVersionId};
      const members=await request('client',`/api/v1/projects/${p1}/members`);
      outcomes.client_member_contacts={status:members.status,private_contact_visible:Array.isArray(members.value)&&members.value.some(r=>r.identifier==='site@g02-fixture.example.test')};
      const packageResult=await request('reviewer',`/api/v1/projects/${p2}/packages/${pkg}`);
      outcomes.reviewer_unassigned_package={status:packageResult.status,package_returned:packageResult.value?.id===pkg};
      const nested=await request('site',`/api/v1/projects/${p1}/document-versions/${verB}/complete-upload`,'POST',{});
      outcomes.nested_foreign_version_complete={status:nested.status,foreign_document_returned:nested.value?.documentId===docB};
      const direct=await request('site',`/api/v1/document-versions/${verB}/complete-upload`,'POST',{});
      outcomes.direct_foreign_version_complete={status:direct.status,code:direct.value?.code};
      const exp=await request('doc',`/api/v1/projects/${p1}/archive-exports`,'POST',{});
      outcomes.doc_export_without_permission={status:exp.status,export_returned:typeof exp.value?.exportId==='string',export_status:exp.value?.status};
      const beforeAudit=Number((await admin.query('SELECT count(*) FROM auth_security_events')).rows[0].count);
      const beforeBusinessAudit=Number((await admin.query('SELECT count(*) FROM audit_events')).rows[0].count);
      const denied=await request('auditor',`/api/v1/projects/${p1}/reviews`);
      const afterAudit=Number((await admin.query('SELECT count(*) FROM auth_security_events')).rows[0].count);
      outcomes.auditor_review_read={status:denied.status,security_events_added:afterAudit-beforeAudit,business_audit_events_added:Number((await admin.query('SELECT count(*) FROM audit_events')).rows[0].count)-beforeBusinessAudit};
      const qc=await request('hybrid',`/api/v1/projects/${p1}/reviews`);
      outcomes.project_qc_read={status:qc.status};
      const pmNested=await request('projectpm',`/api/v1/projects/${p1}/reviews`);
      const pmDirect=await request('projectpm',`/api/v1/reviews/${review}`);
      outcomes.project_pm_nested_vs_direct={nested_status:pmNested.status,direct_status:pmDirect.status,existing_review_id:review};
      const badPath=await request('site','/api/v1/projects/not-a-uuid/assets');
      outcomes.malformed_project_path={status:badPath.status,code:badPath.value?.code};
      const badPackage=await request('reviewer','/api/v1/packages/not-a-uuid');
      outcomes.malformed_package_id={status:badPackage.status,code:badPackage.value?.code};
      return outcomes;
    }finally{
      if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{
        const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
      });
    }
  });
  await probe('project_removal_after_guard_does_not_fence_write',async()=>{
    const {ctx}=await auth('site',AssetsController,'updateAsset',{projectId:p1,id:assetA},projectRoute+'/assets/:id','PATCH');
    await projects.removeProjectMember({orgId:org,userId:actors.owner.id,actorType:'USER',requestId:randomUUID(),orgRole:'R-ADMIN',ip:'192.0.2.2',userAgent:'fixture'},p1,actors.site.id);
    await assets.updateAsset(ctx,p1,assetA,{name:'G02 changed after project membership removal'});
    return {membership_status:(await admin.query('SELECT status FROM project_members WHERE project_id=$1 AND user_id=$2',[p1,actors.site.id])).rows[0].status,persisted_name:(await admin.query('SELECT name FROM assets WHERE id=$1',[assetA])).rows[0].name,session_revoked:(await admin.query('SELECT revoked_at FROM sessions WHERE id=$1',[actors.site.session])).rows[0].revoked_at!==null};
  });
  await probe('foreign_tenant_project_negative',async()=>{
    const {ctx}=await auth('auditor',ProjectsController,'getProject',{id:pForeign},'/api/v1/projects/:id');
    return await projects.getProject(ctx,pForeign);
  });
  evidence.pool_reusable=!!(await app.query('SELECT 1')).rows.length;
});
evidence.finished_at=new Date().toISOString();
fs.writeFileSync('/tmp/tc-g02-audit/results.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
}
main().catch(e=>{console.error('G02_PROBE_SETUP_FAILED',e.code||'',e.message);process.exitCode=1;});
