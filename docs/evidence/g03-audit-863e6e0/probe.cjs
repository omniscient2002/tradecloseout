const fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {Reflector}=require('@nestjs/core');
const root='/tmp/tc-g01-implementation';
const load=p=>require(root+'/'+p);
const {withDisposableDatabase}=load('packages/db/test/helpers/disposable-database.ts');
const {SessionCsrfGuard}=load('apps/api/src/common/guards/session-csrf.guard.ts');
const {PermissionGuard}=load('apps/api/src/common/guards/permission.guard.ts');
const {OrganisationsController}=load('apps/api/src/modules/organisations/organisations.controller.ts');
const {OrganisationsService}=load('apps/api/src/modules/organisations/organisations.service.ts');
const {IdentityController}=load('apps/api/src/modules/identity/identity.controller.ts');
const {InMemoryRedis}=load('apps/api/src/modules/identity/identity.module.ts');
const {hasPermission}=load('packages/shared/src/permissions.ts');
const {AppModule}=load('apps/api/src/app.module.ts');
const {registeredHttpRoutes}=load('apps/api/src/common/security/route-inventory.ts');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(sha!=='863e6e0c56ad4a92af2580fbcbfc179832056b2d')throw Error('SOURCE_CHANGED');
process.env.NODE_ENV='production';
process.env.AUTH_OTP_HMAC_KEY='g03-disposable-only-auth-event-key-000000000';
process.env.AUTH_CSRF_KEY='g03-disposable-only-csrf-key-at-least-32';
process.env.FRONTEND_URL='https://g03-fixture.example.test';
const digest=s=>createHash('sha256').update(s).digest('hex');
const evidence={started_at:new Date().toISOString(),source_sha:sha,source_checkout_status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,method:'real restricted PostgreSQL with actual guards/services and strict-production loopback HTTP; seeded sessions and non-delivering provider fixtures; no real external acceptance',fixtures_only:true,probes:[]};
async function probe(name,fn){try{evidence.probes.push({name,status:'COMPLETED',result:await fn()});}catch(e){evidence.probes.push({name,status:'REJECTED',http_status:e.getStatus?.()??null,code:e.code??e.getResponse?.()?.code??null,message:e.message});}}
async function main(){await withDisposableDatabase(async({admin,app,name:dbName})=>{
 evidence.postgres=(await admin.query('SHOW server_version')).rows[0].server_version;
 evidence.runtime=(await app.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 evidence.migrations=(await admin.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
 const org=randomUUID(),foreignOrg=randomUUID(),p1=randomUUID(),p2=randomUUID(),closed=randomUUID();
 const actors={};
 async function addActor(name,role,orgId=org,status='ACTIVE'){
  const a={id:randomUUID(),session:randomUUID(),generation:randomUUID(),token:'g03-fixture-'+randomUUID(),csrf:'g03-csrf-'+randomUUID(),role,orgId};actors[name]=a;
  await admin.query('INSERT INTO users(id,name,status) VALUES($1,$2,$3)',[a.id,'G03 '+name+' Fixture',status]);
  await admin.query("INSERT INTO user_identities(id,user_id,type,value,verified_at) VALUES($1,$2,'EMAIL',$3,now())",[randomUUID(),a.id,name+'@g03-fixture.example.test']);
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),orgId,a.id,role]);
  await admin.query("INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,expires_at,mfa_verified,mfa_verified_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day',true,now())",[a.session,a.id,orgId,digest(a.token),digest(a.csrf),a.generation]);return a;
 }
 for(const [id,label]of [[org,'Primary'],[foreignOrg,'Foreign']]){await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,$2,$2,'KA','ACTIVE')",[id,'G03 '+label+' Fixture']);await admin.query('INSERT INTO org_profiles(org_id,pan) VALUES($1,$2)',[id,'ABCDE1234F']);}
 for(const [name,role]of Object.entries({owner:'R-OWNER',admin:'R-ADMIN',peer:'R-ADMIN',site:'R-SITE',depart:'R-QC',billing:'R-BILLING',self:'R-SITE',pending:'R-SITE'}))await addActor(name,role);
 for(const [id,code,status]of [[p1,'G03-A','ACTIVE'],[p2,'G03-B','ACTIVE'],[closed,'G03-CLOSED','CLOSED']])await admin.query('INSERT INTO projects(id,org_id,code,name,status,created_by) VALUES($1,$2,$3,$3,$4,$5)',[id,org,code,status,actors.owner.id]);
 for(const [project,name,role]of [[p1,'site','R-SITE'],[p1,'depart','R-QC'],[p1,'self','R-SITE'],[p2,'depart','R-QC'],[closed,'depart','R-QC']])await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)",[randomUUID(),org,project,actors[name].id,role,actors.owner.id]);
 const snapshots={};for(const project of [p1,p2,closed]){const id=randomUUID();snapshots[project]=id;await admin.query("INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by) VALUES($1,$2,$3,1,'ACTIVE','{}','{}','{}',$4,$5)",[id,org,project,'b'.repeat(64),actors.owner.id]);}
 const reqs={};
 for(const [key,project,assignee,reviewer]of [['qc',p1,'depart','R-QC'],['other',p1,'owner','R-PM'],['third',p1,'owner','R-SAFETY'],['closed',closed,'depart','R-QC'],['self',p2,'self','R-SITE']]){const id=randomUUID();reqs[key]=id;await admin.query("INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,group_key,title,doc_type_key,mandatory,owner_user_id,reviewer_role) VALUES($1,$2,$3,$4,$5,'AUTHZ_FIXTURE',$5,'G03-AUTHZ-FIXTURE',false,$6,$7)",[id,org,project,snapshots[project],'G03-'+key,actors[assignee].id,reviewer]);}
 const docs=[];for(let i=0;i<2;i++){const d=randomUUID(),v=randomUUID(),o=randomUUID();docs.push({d,v});await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'G03 authorization fixture','G03-AUTHZ-FIXTURE','G03-AUTHZ-FIXTURE',$4)",[d,org,p1,actors.owner.id]);await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,size_bytes,mime,status,provider_version_id) VALUES($1,$2,'g03-fixture',$3,3,'application/pdf','PROCESSING','g03-fixture-version')",[o,org,'g03/'+o]);await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,review_status,issue_date,uploaded_by) VALUES($1,$2,$3,$4,1,'A',$5,'PROCESSING','NOT_SUBMITTED',CURRENT_DATE,$6)",[v,org,p1,d,o,actors.owner.id]);}
 for(const [doc,key]of [[docs[0].d,'qc'],[docs[1].d,'other'],[docs[1].d,'third']])await admin.query('INSERT INTO document_requirements(id,org_id,project_id,document_id,requirement_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),org,p1,doc,reqs[key]]);
 const review=randomUUID(),pkg=randomUUID(),submission=randomUUID();
 await admin.query("INSERT INTO reviews(id,org_id,project_id,document_version_id,reviewer_subject_type,reviewer_subject_id,reviewer_user_id) VALUES($1,$2,$3,$4,'USER',$5,$5)",[review,org,p1,docs[0].v,actors.depart.id]);
 await admin.query("INSERT INTO handover_packages(id,org_id,project_id,version_no,status,requested_by) VALUES($1,$2,$3,1,'DRAFT',$4)",[pkg,org,p1,actors.depart.id]);
 await admin.query("INSERT INTO submissions(id,org_id,project_id,status,created_by,submitted_by) VALUES($1,$2,$3,'SENT',$4,$4)",[submission,org,p2,actors.pending.id]);
 await admin.query("INSERT INTO audit_events(id,org_id,project_id,actor_type,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,$3,'USER',$4,'G03_AUTHORIZATION_FIXTURE','PROJECT',$3,$5,$6)",[randomUUID(),org,p2,actors.owner.id,JSON.stringify({internal_notes:'G03 INTERNAL FIXTURE',contract_value_paise:'123456789'}),randomUUID()]);
 const service=new OrganisationsService(app),reflector=new Reflector();
 function ctx(who,orgId=actors[who].orgId){const a=actors[who];return {orgId,userId:a.id,sessionId:a.session,authGeneration:a.generation,orgRole:a.role,actorType:'MEMBER',requestId:randomUUID(),ip:'192.0.2.42',userAgent:'G03 fixture'};}
 async function auth(who,handler,params,route,method='GET'){
 const a=actors[who],req={method,path:route.replace(/:([A-Za-z]+)/g,(_,k)=>params[k]||k),route:{path:route},params:{...params},body:{},cookies:{tc_session:a.token},headers:{'x-csrf-token':a.csrf,'x-auth-generation':a.generation,'x-request-id':randomUUID()},ip:'192.0.2.42'};
 const context={switchToHttp:()=>({getRequest:()=>req}),getHandler:()=>OrganisationsController.prototype[handler],getClass:()=>OrganisationsController};await new SessionCsrfGuard(app).canActivate(context);await new PermissionGuard(reflector,app).canActivate(context);return req.userContext;
 }
 async function resetDepart(){await admin.query("UPDATE memberships SET status='ACTIVE' WHERE org_id=$1 AND user_id=$2",[org,actors.depart.id]);await admin.query('UPDATE sessions SET revoked_at=NULL,mfa_verified=true,mfa_verified_at=now() WHERE id=$1',[actors.depart.session]);await admin.query("UPDATE requirements SET owner_user_id=$2 WHERE id=ANY($1::uuid[])",[[reqs.qc,reqs.closed],actors.depart.id]);await admin.query("UPDATE reviews SET reviewer_subject_id=$2,reviewer_user_id=$2 WHERE id=$1",[review,actors.depart.id]);await admin.query('UPDATE handover_packages SET requested_by=$2 WHERE id=$1',[pkg,actors.depart.id]);}
 const fullProfile={brandColor:'#123456',watermarkEnabled:false,allowSelfApproval:false,defaultRetentionMonths:96};
    const listener=createServer();
    await new Promise(r=>listener.listen(0,'127.0.0.1',r));
    const port=listener.address().port;await new Promise(r=>listener.close(r));
    const runtime=new URL(process.env.APP_DATABASE_URL);runtime.pathname='/'+dbName;
    const env={...process.env,NODE_ENV:'production',API_PORT:String(port),APP_DATABASE_URL:runtime.toString(),
      REDIS_URL:'redis://127.0.0.1:56389',AUTH_CSRF_KEY:'g03-disposable-only-csrf-key-at-least-32',
      AUTH_MFA_ENCRYPTION_KEY:Buffer.alloc(32,21).toString('base64'),AUTH_DELIVERY_CALLBACK_KEY:'g03-disposable-only-callback-key-at-least-32',
      FRONTEND_URL:'https://g03-fixture.example.test',PUBLIC_APP_URL:'https://g03-fixture.example.test',AUTH_TRUSTED_PROXY_CIDRS:'direct',
      DLT_SMS_URL:'https://invalid.example.test/send',DLT_SMS_STATUS_URL:'https://invalid.example.test/status',
      MAIL_GATEWAY_URL:'https://invalid.example.test/send',MAIL_STATUS_URL:'https://invalid.example.test/status',
      DLT_SMS_API_KEY:'g03-no-provider',MAIL_API_KEY:'g03-no-provider',MAIL_FROM_ADDRESS:'security@g03-fixture.example.test',
      DLT_SENDER_ID:'G03TEST',DLT_ENTITY_ID:'G03-FIXTURE',DLT_OTP_TEMPLATE_ID:'G03-OTP-FIXTURE',
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
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/v1/auth/me',{signal:AbortSignal.timeout(1000)});if(r.status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('FIXTURE_API_BOOT_FAILED: '+startupLog.slice(-1500));
  const orgPath='/api/v1/orgs/'+org;
  await probe('site_reads_org_audit_without_audit_permission',async()=>{const r=await request('site',orgPath+'/audit');return {status:r.status,audit_permission:hasPermission({orgRole:'R-SITE'},'audit.read').allowed,unassigned_project_internal_event_visible:Array.isArray(r.value)&&r.value.some(x=>x.project_id===p2&&x.after_json?.internal_notes==='G03 INTERNAL FIXTURE')};});
  await probe('owner_dashboard_source_diagnostic',async()=>service.getDashboard(ctx('owner'),org));
  await probe('site_dashboard_source_diagnostic',async()=>service.getDashboard(ctx('site'),org));
  await probe('owner_dashboard_vs_site_dashboard',async()=>{const a=await request('owner',orgPath+'/dashboard'),b=await request('site',orgPath+'/dashboard');return {owner_status:a.status,owner_code:a.value?.code,site_status:b.status,site_project_count:b.value?.projects?.length};});
  await probe('partial_profile_patch',async()=>{const before=(await admin.query('SELECT row_version,display_name FROM organisations WHERE id=$1',[org])).rows[0];const r=await request('owner',orgPath,'PATCH',{rowVersion:before.row_version,displayName:'G03 partial display'});const after=(await admin.query('SELECT row_version,display_name FROM organisations WHERE id=$1',[org])).rows[0];return {status:r.status,code:r.value?.code,rolled_back:before.row_version===after.row_version&&before.display_name===after.display_name};});
  await probe('profile_invalid_branding_and_retention_accepted',async()=>{const version=(await admin.query('SELECT row_version FROM organisations WHERE id=$1',[org])).rows[0].row_version;const r=await request('owner',orgPath,'PATCH',{...fullProfile,rowVersion:version,legalName:'G03 Primary Fixture',state:'ZZ',brandColor:'not-a-color',logoUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>',defaultRetentionMonths:-1});return {status:r.status,persisted:(await admin.query('SELECT o.legal_name,o.state,p.brand_color,p.logo_url,p.default_retention_months FROM organisations o JOIN org_profiles p ON p.org_id=o.id WHERE o.id=$1',[org])).rows[0]};});
  await probe('profile_null_does_not_clear_and_required_fields_ignored',async()=>{const version=(await admin.query('SELECT row_version FROM organisations WHERE id=$1',[org])).rows[0].row_version;const r=await request('owner',orgPath,'PATCH',{...fullProfile,rowVersion:version,legalName:'G03 Primary Fixture',state:'KA',pan:null,addressJson:{city:'G03 Requested City'},contactEmail:'requested@g03-fixture.example.test',footerText:'G03 requested footer',timeZone:'Asia/Kolkata'});return {status:r.status,profile:(await admin.query('SELECT pan,address_json,contact_email,footer_text FROM org_profiles WHERE org_id=$1',[org])).rows[0]};});
  await probe('review_gap_count_and_roles_include_unrelated_documents',async()=>{const r=await request('admin',orgPath+'/members/'+actors.depart.id+'/offboarding-gap-report');return {status:r.status,actual_pending_reviews:1,reported_pending_reviews:r.value?.pendingReviewsCount,reported_roles:r.value?.byProject?.find(p=>p.projectId===p1)?.requiredReplacementRoles};});
  await probe('ineligible_replacement_and_closed_project_reassignment',async()=>{const r=await request('admin',orgPath+'/reassign-work','POST',{fromUserId:actors.depart.id,toUserId:actors.billing.id});return {status:r.status,replacement_role:'R-BILLING',replacement_project_memberships:Number((await admin.query("SELECT count(*) FROM project_members WHERE user_id=$1 AND status='ACTIVE'",[actors.billing.id])).rows[0].count),requirement_assigned_to_billing:(await admin.query('SELECT owner_user_id FROM requirements WHERE id=$1',[reqs.qc])).rows[0].owner_user_id===actors.billing.id,review_assigned_to_billing:(await admin.query('SELECT reviewer_user_id FROM reviews WHERE id=$1',[review])).rows[0].reviewer_user_id===actors.billing.id,closed_project_owner_changed:(await admin.query('SELECT owner_user_id FROM requirements WHERE id=$1',[reqs.closed])).rows[0].owner_user_id===actors.billing.id};});await resetDepart();
  await probe('self_replacement_removal_leaves_open_work',async()=>{const r=await request('admin',orgPath+'/members/'+actors.self.id,'DELETE',{reassignToUserId:actors.self.id});return {status:r.status,membership:(await admin.query('SELECT status FROM memberships WHERE org_id=$1 AND user_id=$2',[org,actors.self.id])).rows[0].status,open_requirement_still_owned:(await admin.query('SELECT owner_user_id FROM requirements WHERE id=$1',[reqs.self])).rows[0].owner_user_id===actors.self.id};});
  await probe('removal_omits_pending_submission_responsibility',async()=>{const gap=await request('admin',orgPath+'/members/'+actors.pending.id+'/offboarding-gap-report');const r=await request('admin',orgPath+'/members/'+actors.pending.id,'DELETE',{});return {gap_status:gap.status,gap:gap.value,removal_status:r.status,submission:(await admin.query('SELECT status,created_by,submitted_by FROM submissions WHERE id=$1',[submission])).rows[0],removed_user:actors.pending.id};});
  await probe('open_work_removal_blocked_but_no_supported_suspend_route',async()=>{const denied=await request('admin',orgPath+'/members/'+actors.depart.id,'DELETE',{});const current=await request('depart','/api/v1/auth/me');const suspend=await request('admin',orgPath+'/members/'+actors.depart.id,'PATCH',{status:'SUSPENDED'});const route=await request('admin',orgPath+'/members/'+actors.depart.id+'/suspend','POST',{});return {remove_status:denied.status,remove_code:denied.value?.code,departing_session_still_valid:current.status===200,suspend_patch_status:suspend.status,suspend_patch_code:suspend.value?.code,suspend_route_status:route.status};});
  await probe('peer_admin_role_edit_denied_but_removal_allowed',async()=>{const edit=await request('admin',orgPath+'/members/'+actors.peer.id,'PATCH',{role:'R-SITE'});const remove=await request('admin',orgPath+'/members/'+actors.peer.id,'DELETE',{});return {role_edit_status:edit.status,role_edit_code:edit.value?.code,remove_status:remove.status,peer_status:(await admin.query('SELECT status FROM memberships WHERE org_id=$1 AND user_id=$2',[org,actors.peer.id])).rows[0].status};});
  await probe('suspended_org_read_and_write',async()=>{await admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1",[org]);try{const read=await request('owner',orgPath),write=await request('owner',orgPath,'PATCH',fullProfile),exp=await request('owner','/api/v1/projects/'+p1+'/archive-exports');return {read_status:read.status,read_code:read.value?.code,write_status:write.status,export_list_status:exp.status};}finally{await admin.query("UPDATE organisations SET status='ACTIVE' WHERE id=$1",[org]);}});
  await probe('malformed_member_target_reaches_database',async()=>{const r=await request('admin',orgPath+'/members/not-a-uuid','DELETE',{});return {status:r.status,code:r.value?.code};});
  await probe('invalid_gstin_negative',async()=>{const r=await request('owner',orgPath,'PATCH',{...fullProfile,gstin:'NOT-A-GSTIN'});return {status:r.status,code:r.value?.code};});
  await probe('foreign_org_path_negative',async()=>{const r=await request('site','/api/v1/orgs/'+foreignOrg);return {status:r.status,code:r.value?.code};});
  await probe('owner_removal_negative',async()=>{const r=await request('admin',orgPath+'/members/'+actors.owner.id,'DELETE',{});return {status:r.status,code:r.value?.code};});
  await probe('mobile_invitation_input',async()=>{const r=await request('owner',orgPath+'/invitations','POST',{phone:'+919876543210',role:'R-SITE'});return {status:r.status,code:r.value?.code};});
  await probe('owner_transfer_one_sided',async()=>{
   const target=await addActor('newowner','R-SITE');await admin.query('UPDATE sessions SET mfa_verified=false,mfa_verified_at=NULL WHERE id=$1',[target.session]);
   const r=await request('owner',orgPath+'/transfer-ownership','POST',{targetUserId:target.id});return {status:r.status,target_confirmation_submitted:false,target_mfa_verified:false,owner_after:(await admin.query("SELECT user_id FROM memberships WHERE org_id=$1 AND role='R-OWNER' AND status='ACTIVE'",[org])).rows[0]?.user_id===target.id,old_owner_session_revoked:(await admin.query('SELECT revoked_at FROM sessions WHERE id=$1',[actors.owner.session])).rows[0].revoked_at!==null};
  });
  await probe('suspended_identity_can_become_sole_owner',async()=>{
   const o=randomUUID();await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'G03 Transfer Eligibility','G03 Transfer Eligibility','KA','ACTIVE')",[o]);const issuer=await addActor('transferowner','R-OWNER',o),target=await addActor('suspendedtarget','R-SITE',o,'SUSPENDED');const r=await request('transferowner','/api/v1/orgs/'+o+'/transfer-ownership','POST',{targetUserId:target.id});return {status:r.status,owners:(await admin.query("SELECT m.role,m.status,u.status AS user_status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.role='R-OWNER' AND m.status='ACTIVE'",[o])).rows};
  });
 }finally{if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
 await probe('party_review_blocks_bulk_offboarding_transaction',async()=>{
  await resetDepart();const party=randomUUID(),rv=randomUUID();await admin.query("INSERT INTO parties(id,org_id,name,types,status) VALUES($1,$2,'G03 External Reviewer',ARRAY['CONSULTANT'],'ACTIVE')",[party,org]);await admin.query("INSERT INTO reviews(id,org_id,project_id,document_version_id,stage_key,reviewer_subject_type,reviewer_subject_id,reviewer_party_id,reviewer_user_id) VALUES($1,$2,$3,$4,'EXTERNAL_FIXTURE','PARTY',$5,$5,$6)",[rv,org,p1,docs[1].v,party,actors.depart.id]);
  let error=null;try{await service.reassignWork(ctx('admin'),org,{fromUserId:actors.depart.id,toUserId:actors.billing.id});}catch(e){error={code:e.code,message:e.message};}return {error,review_subject_preserved:(await admin.query('SELECT reviewer_subject_id FROM reviews WHERE id=$1',[rv])).rows[0].reviewer_subject_id===party,other_assignment_rolled_back:(await admin.query('SELECT owner_user_id FROM requirements WHERE id=$1',[reqs.qc])).rows[0].owner_user_id===actors.depart.id};
 });
 await probe('invitation_create_revoke_missing_audit',async()=>{
  const o=randomUUID();await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'G03 Invitation Audit','G03 Invitation Audit','KA','ACTIVE')",[o]);await addActor('inviteowner','R-OWNER',o);
  const fixtureMail={sendMagicLinkEmail:async()=>{}};const svc=new OrganisationsService(app,fixtureMail);const before=(await admin.query('SELECT count(*)::int AS n FROM audit_events WHERE org_id=$1',[o])).rows[0].n;const inv=await svc.createInvitation(ctx('inviteowner'),o,{email:'invite-audit@g03-fixture.example.test',role:'R-SITE'});await svc.revokeInvitation(ctx('inviteowner'),o,inv.id);return {status:(await admin.query('SELECT status FROM invitations WHERE id=$1',[inv.id])).rows[0].status,new_audit_events:(await admin.query('SELECT count(*)::int AS n FROM audit_events WHERE org_id=$1',[o])).rows[0].n-before,provider:'non-delivering in-process fixture'};
 });
 await probe('seat_limit_not_enforced_on_actual_invitation_acceptance',async()=>{
  const o=randomUUID(),plan=randomUUID();await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'G03 One Seat','G03 One Seat','KA','ACTIVE')",[o]);await addActor('seatowner','R-OWNER',o);
  await admin.query("INSERT INTO plans(id,code,name,limits_json,price_paise,interval) VALUES($1,$2,'One seat fixture',$3,0,'MONTH')",[plan,'g03-'+plan,JSON.stringify({maxSeats:1,maxActiveProjects:1,maxStorageBytes:1,maxPackageGenerationsPerMonth:1})]);await admin.query("INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,$3,'ACTIVE',now(),now()+interval '30 days')",[randomUUID(),o,plan]);
  let token;const svc=new OrganisationsService(app,{sendMagicLinkEmail:async(_email,url)=>{token=new URL(url).searchParams.get('invite');}});const email='seat-recipient@g03-fixture.example.test';await svc.createInvitation(ctx('seatowner'),o,{email,role:'R-SITE'});
  const before=Number((await admin.query("SELECT count(*) FROM memberships WHERE org_id=$1 AND status='ACTIVE'",[o])).rows[0].count);
  const oldMode=process.env.NODE_ENV,oldDebug=process.env.ENABLE_DEBUG_OTP;process.env.NODE_ENV='test';process.env.ENABLE_DEBUG_OTP='true';
  try{const identity=new IdentityController(app,new InMemoryRedis(),{sendOtpSms:async()=>({delivered:true})},{sendOtpEmail:async()=>{},sendMagicLinkEmail:async()=>{}});const req={ip:'192.0.2.44',headers:{'user-agent':'G03 seat fixture'},cookies:{}},res={cookie:(name,value)=>{req.cookies[name]=value;},clearCookie:()=>{}};
   const issued=await identity.requestOtp({identifier:email},req,res);const accepted=await identity.verifyOtp({challengeId:issued.challengeId,code:issued.debugOtp,invitationToken:token},req,res);
   return {configured_max_seats:1,members_before:before,members_after:Number((await admin.query("SELECT count(*) FROM memberships WHERE org_id=$1 AND status='ACTIVE'",[o])).rows[0].count),membership_created:!!accepted.userId,authentication:'test-mode debug OTP / fixture provider, not production login acceptance'};
  }finally{process.env.NODE_ENV=oldMode;if(oldDebug===undefined)delete process.env.ENABLE_DEBUG_OTP;else process.env.ENABLE_DEBUG_OTP=oldDebug;}
 });

 await probe('offboarding_and_role_change_lock_inversion',async()=>{
  const o=randomUUID();await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'G03 Lock Order','G03 Lock Order','KA','ACTIVE')",[o]);
  await addActor('raceowner','R-OWNER',o);await addActor('raceadmin','R-ADMIN',o);await addActor('racemember','R-SITE',o);
  const actorContext=await auth('raceadmin','updateMemberRole',{orgId:o,userId:actors.racemember.id},'/api/v1/orgs/:orgId/members/:userId','PATCH');
  const ownerContext=await auth('raceowner','removeMember',{orgId:o,userId:actors.raceadmin.id},'/api/v1/orgs/:orgId/members/:userId','DELETE');
  let sessionReady,memberReady;const sessionGate=new Promise(r=>sessionReady=r),memberGate=new Promise(r=>memberReady=r);
  function instrumentPool(kind){return {connect:async()=>{const c=await app.connect();return {release:()=>c.release(),query:async(sql,params)=>{
    const result=await c.query(sql,params);
    if(kind==='role'&&/SELECT id FROM sessions/.test(sql)){sessionReady();await memberGate;}
    if(kind==='offboard'&&/SELECT id, role, status FROM memberships/.test(sql)){memberReady();}
    return result;
  }};}};}
  const roleChange=new OrganisationsService(instrumentPool('role')).updateMemberRole(actorContext,o,actors.racemember.id,{role:'R-DOC'});
  await sessionGate;
  const offboard=new OrganisationsService(instrumentPool('offboard')).removeMember(ownerContext,o,actors.raceadmin.id);
  const results=await Promise.allSettled([roleChange,offboard]);
  return {scheduling:'Actual queries paused after actor session SHARE and departing membership UPDATE locks; no database result mocked',operations:results.map((x,i)=>x.status==='fulfilled'?{operation:i===0?'role_change':'offboard',status:'COMMITTED'}:{operation:i===0?'role_change':'offboard',status:'REJECTED',code:x.reason?.code,message:x.reason?.message}),pool_reusable:!!(await app.query('SELECT 1')).rows.length};
 });
 const routes=registeredHttpRoutes(AppModule).map(r=>({...r,guards:r.guards.map(g=>g.name)}));fs.writeFileSync('/tmp/tc-g03-audit/route-inventory.json',JSON.stringify(routes,null,2)+'\n');
 evidence.org_routes=routes.filter(r=>r.path.includes('/orgs/:orgId')||r.path==='/api/v1/auth/orgs'||r.path==='/api/v1/auth/switch-org');
 evidence.web_routes=execFileSync('git',['ls-files','apps/web/src/app'],{cwd:root,encoding:'utf8'}).split('\n').filter(x=>x.endsWith('/page.tsx'));
 evidence.pool_reusable=!!(await app.query('SELECT 1')).rows.length;
});evidence.finished_at=new Date().toISOString();fs.writeFileSync('/tmp/tc-g03-audit/results.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));}
main().catch(e=>{console.error('G03_PROBE_SETUP_FAILED',e.code||'',e.message);process.exitCode=1;});
