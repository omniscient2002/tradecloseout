import { withDisposableDatabase } from '../../../../packages/db/test/helpers/disposable-database';
import { OrganisationsService } from '../../../../apps/api/src/modules/organisations/organisations.service';
import { ProjectsService } from '../../../../apps/api/src/modules/projects/projects.service';
import { SessionCsrfGuard } from '../../../../apps/api/src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../../../../apps/api/src/common/guards/permission.guard';
import { OrganisationsController } from '../../../../apps/api/src/modules/organisations/organisations.controller';
import { createHash, randomUUID as uuidv7 } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test('G03 audit probes reproduce current behavior using migrated PG16 and tc_app', async () => {
  const results: any[] = [];
  await withDisposableDatabase(async ({ admin, app }) => {
    const role = (await app.query('SELECT current_user, version()')).rows[0];
    const service = new OrganisationsService(app);
    async function fixture() {
      const org = uuidv7(), owner = uuidv7(), actor = uuidv7(), target = uuidv7(), replacement = uuidv7(), project = uuidv7();
      for (const id of [owner, actor, target, replacement]) {
        await admin.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, `Fixture ${id}`]);
        await admin.query("INSERT INTO user_identities(id,user_id,type,value) VALUES($1,$2,'EMAIL',$3)", [uuidv7(),id,`${id}@example.test`]);
      }
      await admin.query("INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Audit Fixture','Audit Fixture','MH')",[org]);
      await admin.query('INSERT INTO org_profiles(org_id) VALUES($1)',[org]);
      for (const [id,r] of [[owner,'R-OWNER'],[actor,'R-ADMIN'],[target,'R-QC'],[replacement,'R-SITE']])
        await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[uuidv7(),org,id,r]);
      await admin.query("INSERT INTO projects(id,org_id,code,name,created_by,status) VALUES($1,$2,'AUDIT','Audit Project',$3,'ACTIVE')",[project,org,owner]);
      const ctx:any = {orgId:org,userId:actor,orgRole:'R-ADMIN',actorType:'MEMBER',ip:'127.0.0.1',userAgent:'g03-audit',requestId:uuidv7()};
      return {org,owner,actor,target,replacement,project,ctx};
    }
    async function probe(name:string, fn:()=>Promise<any>) {
      try { results.push({name,observed:await fn()}); }
      catch(e:any) {results.push({name,error:e.code || e.response?.code || e.constructor.name,message:e.message});}
    }
    const profile:any = {brandColor:'#112233',watermarkEnabled:false,allowSelfApproval:false,defaultRetentionMonths:96};
    async function requirements(f:any, count=1, status='NOT_STARTED') {
      const snapshot=uuidv7(), ids:string[]=[];
      await admin.query("INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,resolved_payload_json,provenance_json,source_json,checksum,created_by) VALUES($1,$2,$3,1,'{}','{}','{}','audit',$4)",[snapshot,f.org,f.project,f.owner]);
      for(let i=0;i<count;i++) {
        const id=uuidv7(); ids.push(id);
        await admin.query("INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,group_key,title,doc_type_key,owner_user_id,status) VALUES($1,$2,$3,$4,$5,'AUDIT','Audit Requirement','DT-001',$6,$7)",[id,f.org,f.project,snapshot,`REQ-${i}`,f.target,status]);
      }
      return ids;
    }
    await probe('owner dashboard fails on nonexistent retention column',async()=>{
      const f=await fixture(); return service.getDashboard({...f.ctx,userId:f.owner,orgRole:'R-OWNER'},f.org);
    });
    await probe('partial profile update supplies null to NOT NULL defaulted fields',async()=>{
      const f=await fixture(); return service.updateOrgProfile(f.ctx,1,{displayName:'Updated Name'});
    });
    await probe('self approval setting writes profile but leaves organisation policy false',async()=>{
      const f=await fixture(); await service.updateOrgProfile(f.ctx,1,{...profile,allowSelfApproval:true});
      return (await admin.query('SELECT o.allow_self_approval AS org_policy,p.allow_self_approval AS profile_policy FROM organisations o JOIN org_profiles p ON p.org_id=o.id WHERE o.id=$1',[f.org])).rows[0];
    });
    await probe('explicit null cannot clear PAN',async()=>{
      const f=await fixture(); await admin.query("UPDATE org_profiles SET pan='ABCDE1234F' WHERE org_id=$1",[f.org]);
      await service.updateOrgProfile(f.ctx,1,{...profile,pan:null}); return (await admin.query('SELECT pan FROM org_profiles WHERE org_id=$1',[f.org])).rows[0];
    });
    await probe('row version HTTP wrapper ignores If-Match contract and defaults to one',async()=>{
      const f=await fixture(); await service.updateOrganisation(f.ctx,f.org,{...profile,displayName:'First Change'});
      return service.updateOrganisation(f.ctx,f.org,{...profile,displayName:'Second Change'});
    });
    await probe('revoke invitation fails because updated_at does not exist',async()=>{
      const f=await fixture(); const i=await service.createInvitation(f.ctx,f.org,{email:'invite@example.test',role:'R-SITE'});
      return service.revokeInvitation(f.ctx,f.org,i.id);
    });
    await probe('invitation stores an arbitrary role',async()=>{
      const f=await fixture(); return service.createInvitation(f.ctx,f.org,{email:'not-an-email',role:'UNRECOGNISED'}).then(x=>({role:x.role,email:x.email}));
    });
    await probe('parallel invitation calls create duplicate live invitations',async()=>{
      const f=await fixture(); await Promise.all([service.createInvitation(f.ctx,f.org,{email:'duplicate@example.test',role:'R-SITE'}),service.createInvitation(f.ctx,f.org,{email:'duplicate@example.test',role:'R-SITE'})]);
      return (await admin.query("SELECT count(*)::int AS count FROM invitations WHERE org_id=$1 AND status='PENDING'",[f.org])).rows[0];
    });
    await probe('role changes produce neither audit nor outbox events',async()=>{
      const f=await fixture(); await service.updateMemberRole(f.ctx,f.org,f.target,{role:'R-SITE'});
      return (await admin.query('SELECT (SELECT count(*)::int FROM audit_events WHERE org_id=$1) AS audit,(SELECT count(*)::int FROM outbox_events WHERE org_id=$1) AS outbox',[f.org])).rows[0];
    });
    await probe('ownership transfer succeeds without target confirmation',async()=>{
      const f=await fixture(); return service.transferOwnership({...f.ctx,userId:f.owner,orgRole:'R-OWNER'},f.target);
    });
    await probe('owner transfer racing role change can leave zero owners',async()=>{
      const f=await fixture(); let release!:()=>void, reached!:()=>void;
      const pause=new Promise<void>(r=>release=r), ready=new Promise<void>(r=>reached=r);
      const wrapped:any={connect:async()=>{const client=await app.connect();return{release:()=>client.release(),query:async(sql:string,params:any[])=>{
        const result=await client.query(sql,params);
        if(sql.includes('SELECT user_id FROM memberships')){reached();await pause;}
        return result;
      }}}};
      const changing=new OrganisationsService(wrapped).updateMemberRole(f.ctx,f.org,f.target,{role:'R-SITE'});
      await ready;
      try {await service.transferOwnership({...f.ctx,userId:f.owner,orgRole:'R-OWNER'},f.target);} finally {release();}
      await changing;
      return (await admin.query("SELECT count(*)::int AS active_owners FROM memberships WHERE org_id=$1 AND role='R-OWNER' AND status='ACTIVE'",[f.org])).rows[0];
    });
    await probe('removal can reassign open work back to the removed user',async()=>{
      const f=await fixture(); await admin.query("INSERT INTO defects(id,org_id,project_id,title,description,assigned_user_id,raised_by) VALUES($1,$2,$3,'Open Defect','Fixture',$4,$5)",[uuidv7(),f.org,f.project,f.target,f.owner]);
      await service.removeMember(f.ctx,f.org,f.target,f.target);
      return (await admin.query('SELECT m.status,d.assigned_user_id=m.user_id AS orphaned FROM memberships m JOIN defects d ON d.org_id=m.org_id WHERE m.org_id=$1 AND m.user_id=$2',[f.org,f.target])).rows[0];
    });
    await probe('replacement without project membership or defect permission is accepted',async()=>{
      const f=await fixture(); await admin.query("UPDATE memberships SET role='R-BILLING' WHERE org_id=$1 AND user_id=$2",[f.org,f.replacement]);
      await admin.query("INSERT INTO defects(id,org_id,project_id,title,description,assigned_user_id,raised_by) VALUES($1,$2,$3,'Open Defect','Fixture',$4,$5)",[uuidv7(),f.org,f.project,f.target,f.owner]);
      await service.removeMember(f.ctx,f.org,f.target,f.replacement);
      return (await admin.query('SELECT assigned_user_id=$2 AS assigned_to_ineligible FROM defects WHERE org_id=$1',[f.org,f.replacement])).rows[0];
    });
    await probe('removed user project membership remains ACTIVE',async()=>{
      const f=await fixture(); await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,added_by) VALUES($1,$2,$3,$4,'R-QC',$5)",[uuidv7(),f.org,f.project,f.target,f.owner]);
      await service.removeMember(f.ctx,f.org,f.target);
      return (await admin.query('SELECT status FROM project_members WHERE org_id=$1 AND user_id=$2',[f.org,f.target])).rows[0];
    });
    await probe('defect reassignment does not increment row_version',async()=>{
      const f=await fixture(); await admin.query("INSERT INTO defects(id,org_id,project_id,title,description,assigned_user_id,raised_by) VALUES($1,$2,$3,'Open Defect','Fixture',$4,$5)",[uuidv7(),f.org,f.project,f.target,f.owner]);
      await service.reassignWork(f.ctx,f.org,{fromUserId:f.target,toUserId:f.replacement});
      return (await admin.query('SELECT row_version FROM defects WHERE org_id=$1',[f.org])).rows[0];
    });
    await probe('already removed member can be removed again and emits duplicate events',async()=>{
      const f=await fixture(); await service.removeMember(f.ctx,f.org,f.target); await service.removeMember(f.ctx,f.org,f.target);
      return (await admin.query("SELECT count(*)::int AS removals FROM audit_events WHERE org_id=$1 AND action='MEMBER_REMOVE'",[f.org])).rows[0];
    });
    await probe('audit service ignores mismatched org argument',async()=>{
      const f=await fixture(); return service.getAuditLog(f.ctx,uuidv7());
    });
    await probe('profile service accepts stale actor authority after membership removal',async()=>{
      const f=await fixture(); await admin.query("UPDATE memberships SET status='REMOVED' WHERE org_id=$1 AND user_id=$2",[f.org,f.actor]);
      return service.updateOrgProfile(f.ctx,1,{...profile,displayName:'Stale Authority Write'});
    });
    await probe('suspended organisation guard denies GET instead of preserving reads',async()=>{
      const f=await fixture(); const token=uuidv7(); await admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1",[f.org]);
      await admin.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,active_org_id,expires_at) VALUES($1,$2,$3,$3,$4,now()+interval '1 day')",[uuidv7(),f.actor,createHash('sha256').update(token).digest('hex'),f.org]);
      return new SessionCsrfGuard(app).canActivate({switchToHttp:()=>({getRequest:()=>({cookies:{tc_session:token},headers:{},params:{orgId:f.org},method:'GET'})})} as any);
    });
    await probe('project member can be added without an organisation membership',async()=>{
      const f=await fixture(); const outsider=uuidv7(); await admin.query("INSERT INTO users(id,name) VALUES($1,'Outside User')",[outsider]);
      const projectService=new ProjectsService(app);
      const r=await projectService.addProjectMember(f.ctx,f.project,{userId:outsider,role:'MADE_UP_ROLE'}); return {role:r.role,status:r.status};
    });
    await probe('dashboard expiry query independently fails with excess bind parameter',async()=>{
      const f=await fixture(); return app.query('SELECT COUNT(*) FROM document_versions WHERE org_id=$1 AND expiry_date IS NOT NULL',[f.org,f.owner]);
    });
    await probe('profile accepts unsafe retention and invalid colors',async()=>{
      const f=await fixture(); await service.updateOrgProfile(f.ctx,1,{...profile,defaultRetentionMonths:-1,brandColor:'invalid-color'});
      return (await admin.query('SELECT default_retention_months,brand_color FROM org_profiles WHERE org_id=$1',[f.org])).rows[0];
    });
    await probe('offboarding reassigns HANDED_OVER requirements on CLOSED projects',async()=>{
      const f=await fixture(); await requirements(f,1,'HANDED_OVER'); await admin.query("UPDATE projects SET status='CLOSED' WHERE id=$1",[f.project]);
      await service.reassignWork(f.ctx,f.org,{fromUserId:f.target,toUserId:f.replacement});
      return (await admin.query('SELECT status,owner_user_id=$2 AS changed,row_version FROM requirements WHERE org_id=$1',[f.org,f.replacement])).rows[0];
    });
    await probe('gap report overcounts pending reviews through unrelated document links',async()=>{
      const f=await fixture(); const reqs=await requirements(f,2), doc=uuidv7(), otherDoc=uuidv7(), version=uuidv7(), object=uuidv7();
      for (const id of [doc,otherDoc]) await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'Audit Document','DT-001','AUDIT',$4)",[id,f.org,f.project,f.owner]);
      await admin.query("INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes) VALUES($1,$2,'fixture',$3,'application/pdf',0)",[object,f.org,uuidv7()]);
      await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,issue_date) VALUES($1,$2,$3,$4,1,'R1',$5,current_date)",[version,f.org,f.project,doc,object]);
      for(const req of reqs) await admin.query('INSERT INTO document_requirements(id,org_id,project_id,document_id,requirement_id) VALUES($1,$2,$3,$4,$5)',[uuidv7(),f.org,f.project,otherDoc,req]);
      await admin.query("INSERT INTO reviews(id,org_id,project_id,document_version_id,reviewer_subject_type,reviewer_subject_id,reviewer_user_id) VALUES($1,$2,$3,$4,'USER',$5,$5)",[uuidv7(),f.org,f.project,version,f.target]);
      return {actualReviewCount:1,reported:(await service.getOffboardingGapReport(f.ctx,f.org,f.target)).pendingReviewsCount};
    });
    await probe('invitation expiry is ignored by pending listing',async()=>{
      const f=await fixture(); const inv=await service.createInvitation(f.ctx,f.org,{email:'expired@example.test',role:'R-SITE'});
      await admin.query("UPDATE invitations SET expires_at=now()-interval '1 day' WHERE id=$1",[inv.id]);
      return {pending:(await service.listMembers(f.ctx,f.org)).pendingInvitations.length};
    });
    await probe('member role update does not protect against stale row versions',async()=>{
      const f=await fixture(); await service.updateMemberRole(f.ctx,f.org,f.target,{role:'R-PM'}); await service.updateMemberRole(f.ctx,f.org,f.target,{role:'R-SITE'});
      return (await admin.query('SELECT role,row_version FROM memberships WHERE org_id=$1 AND user_id=$2',[f.org,f.target])).rows[0];
    });
    await probe('last owner demotion is blocked in a sequential request',async()=>{
      const f=await fixture(); return service.updateMemberRole(f.ctx,f.org,f.owner,{role:'R-SITE'});
    });
    await probe('second active owner is rejected by existing database uniqueness',async()=>{
      const f=await fixture(); return service.updateMemberRole(f.ctx,f.org,f.target,{role:'R-OWNER'});
    });
    await probe('tenant mismatch on member list is rejected',async()=>{
      const f=await fixture(); return service.listMembers(f.ctx,uuidv7());
    });
    await probe('RLS prevents a scoped profile read from another organisation',async()=>{
      const f=await fixture(), other=await fixture(), c=await app.connect();
      try {await c.query('BEGIN');await c.query("SELECT set_config('app.current_org',$1,true)",[f.org]); const r=await c.query('SELECT * FROM org_profiles WHERE org_id=$1',[other.org]); await c.query('COMMIT');return {rows:r.rowCount};}finally {c.release();}
    });
    await probe('site role passes actual audit route permission and reads organisation audit payload',async()=>{
      const f=await fixture(); await admin.query("UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",[f.org,f.actor]);
      await admin.query("INSERT INTO audit_events(id,org_id,actor_type,actor_user_id,action,entity_type,entity_id,after_json,request_id) VALUES($1,$2,'USER',$3,'AUDIT_FIXTURE','ORGANISATION',$2,$4,'g03-audit')",[uuidv7(),f.org,f.owner,JSON.stringify({internal_note:'audit fixture sensitive internal note'})]);
      const permission=(Reflect as any).getMetadata('require_permission',OrganisationsController.prototype.getAuditLog);
      const req={user:{userId:f.actor,orgId:f.org,orgRole:'R-SITE'},method:'GET',params:{orgId:f.org},path:`/api/v1/orgs/${f.org}/audit`};
      const allowed=await new PermissionGuard({getAllAndOverride:()=>permission} as any,app).canActivate({switchToHttp:()=>({getRequest:()=>req}),getHandler:()=>OrganisationsController.prototype.getAuditLog,getClass:()=>OrganisationsController} as any);
      const rows=await service.getAuditLog({...f.ctx,orgRole:'R-SITE'},f.org); return {permission,allowed,internalNote:rows[0].after_json.internal_note};
    });
    await probe('weekly owner discovery under restricted role sees zero owners despite active organisations',async()=>{
      await fixture(); const r=await app.query("SELECT o.id FROM organisations o JOIN memberships m ON m.org_id=o.id AND m.role='R-OWNER' AND m.status='ACTIVE' WHERE o.status='ACTIVE'");return {rows:r.rowCount};
    });
    await probe('refused removal rolls back attempted session revocation',async()=>{
      const f=await fixture(); await requirements(f); const id=uuidv7();
      await admin.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,active_org_id,expires_at) VALUES($1,$2,$4,$4,$3,now()+interval '1 day')",[id,f.target,f.org,createHash('sha256').update(id).digest('hex')]);
      let refusal='';try{await service.removeMember(f.ctx,f.org,f.target);}catch(e:any){refusal=e.response?.code;}
      return {refusal,revoked:(await admin.query('SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE id=$1',[id])).rows[0].revoked};
    });
    await probe('PAN normalization is validated but normalized value is not persisted',async()=>{
      const f=await fixture(); return service.updateOrgProfile(f.ctx,1,{...profile,pan:' ABCDE1234F '});
    });
    const outputDir = process.env.G03_AUDIT_OUTPUT_DIR || join(tmpdir(), 'tradecloseout-g03-audit');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'probe-results.json'),JSON.stringify({sourceSha:'c6b6024d3d5b25d2d1ab87f77e2d3294500c5bb0',runtime:role,probes:results},null,2));
  });
  console.log(JSON.stringify(results,null,2));
  expect(results).toHaveLength(34);
  const byName=(part:string)=>results.find(x=>x.name.includes(part));
  expect(byName('leave zero owners').observed.active_owners).toBe(0);
  expect(byName('back to the removed user').observed.orphaned).toBe(true);
  expect(byName('without project membership').observed.assigned_to_ineligible).toBe(true);
  expect(byName('partial profile').error).toBe('23502');
  expect(byName('revoke invitation fails').error).toBe('42703');
  expect(byName('unrelated document links').observed).toEqual({actualReviewCount:1,reported:2});
  expect(byName('CLOSED projects').observed.changed).toBe(true);
  expect(byName('sequential request').error).toBe('LAST_OWNER_DEMOTION_BLOCKED');
  expect(byName('existing database uniqueness').error).toBe('23505');
  expect(byName('tenant mismatch').error).toBe('NotFoundException');
  expect(byName('RLS prevents').observed.rows).toBe(0);
  expect(byName('actual audit route').observed.allowed).toBe(true);
  expect(byName('weekly owner discovery').observed.rows).toBe(0);
  expect(byName('rolls back attempted').observed).toEqual({refusal:'OPEN_WORK_REQUIRES_REASSIGNMENT',revoked:false});
  expect(byName('PAN normalization').error).toBe('23514');
});
