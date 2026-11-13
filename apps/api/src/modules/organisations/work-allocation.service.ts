import {ConflictException,ForbiddenException,Injectable,NotFoundException,UnprocessableEntityException} from '@nestjs/common';
import {Pool,PoolClient} from 'pg';
import {createHash} from 'crypto';
import {uuidv7} from 'uuidv7';
import {TenantActorContext,withTenantTransaction} from '@tradecloseout/db';
import {assertValidMemberProjectScope} from '@tradecloseout/db/tenant-tx';
import {hasPermission,Permission} from '@tradecloseout/shared';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
const WORK={
 REQUIREMENT:{table:'requirements',owner:'owner_user_id',open:"superseded_at IS NULL AND status NOT IN('APPROVED','APPROVED_EXTERNAL','WAIVED','NOT_APPLICABLE','HANDED_OVER','SUPERSEDED')",permission:'document.upload'},
 REVIEW:{table:'reviews',owner:'reviewer_user_id',open:"status IN('PENDING','IN_REVIEW')",permission:'review.decide'},
 PACKAGE:{table:'handover_packages',owner:'responsible_user_id',open:"status IN('DRAFT','QUEUED','GENERATING')",permission:'package.generate'},
 SUBMISSION:{table:'submissions',owner:'responsible_user_id',open:"status IN('DRAFT','SENT','ACKNOWLEDGED','PARTIALLY_ACCEPTED','SUBMITTED')",permission:'package.submit'},
 DEFECT:{table:'defects',owner:'assigned_user_id',open:"status IN('OPEN','IN_PROGRESS')",permission:'defect.manage'},
} as const;
type Kind=keyof typeof WORK;
@Injectable()
export class WorkAllocationService{
 constructor(private readonly pool:Pool){}
 private async authority(client:PoolClient,ctx:TenantActorContext,target:string){
  if(ctx.guestGrantId)throw new ForbiddenException('WORK_ALLOCATION_AUTHORITY_REQUIRED');
  const {rows}=await client.query(`SELECT m.user_id,m.role,m.status FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
   WHERE m.org_id=$1 AND m.user_id=ANY($2::uuid[]) ORDER BY m.user_id FOR SHARE OF m,u`,[ctx.orgId,[ctx.userId,target]]);
  const actor=rows.find(r=>r.user_id===ctx.userId),subject=rows.find(r=>r.user_id===target);
  if(!actor||actor.status!=='ACTIVE'||!['R-OWNER','R-ADMIN'].includes(actor.role))throw new ForbiddenException('WORK_ALLOCATION_AUTHORITY_REQUIRED');
  if(!subject||!['ACTIVE','SUSPENDED'].includes(subject.status))throw new NotFoundException('WORK_ALLOCATION_MEMBER_NOT_FOUND');
  if(actor.role!=='R-OWNER'&&['R-OWNER','R-ADMIN'].includes(subject.role))throw new ForbiddenException('PROTECTED_MEMBER_TRANSITION');
 }
 private async manifestRows(client:PoolClient,org:string,target:string){
  const result:any[]=[];
  for(const [kind,definition]of Object.entries(WORK)){
   const {rows}=await client.query(`SELECT w.id,w.project_id,w.row_version,w.status,p.code AS project_code,p.status AS project_status
    FROM ${definition.table} w JOIN projects p ON p.org_id=w.org_id AND p.id=w.project_id
    WHERE w.org_id=$1 AND w.${definition.owner}=$2 AND ${definition.open.replace(/\b(status|superseded_at)\b/g,'w.$1')}
    ORDER BY w.project_id,w.id`,[org,target]);
   result.push(...rows.map(row=>({...row,kind,blockedReason:!['DRAFT','ACTIVE','HANDOVER'].includes(row.project_status)?'PROJECT_LIFECYCLE_BLOCKS_REASSIGNMENT':null})));
  }
  return result;
 }
 private async candidates(client:PoolClient,org:string,target:string,item:any){
  if(item.blockedReason)return [];
  const {rows:members}=await client.query(`SELECT m.user_id,m.role,u.name,pm.role AS project_role,pm.scope_json FROM memberships m
   JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' LEFT JOIN project_members pm
   ON pm.org_id=m.org_id AND pm.user_id=m.user_id AND pm.project_id=$2 AND pm.status='ACTIVE'
   WHERE m.org_id=$1 AND m.status='ACTIVE' AND m.user_id<>$3 AND (m.role IN('R-OWNER','R-ADMIN') OR pm.id IS NOT NULL) ORDER BY m.user_id`,[org,item.project_id,target]);
  let qualifications:any[]=[];
  if(item.kind==='REVIEW'){
   const {rows:review}=await client.query('SELECT method,reviewer_subject_type,document_version_id FROM reviews WHERE org_id=$1 AND project_id=$2 AND id=$3',[org,item.project_id,item.id]);
   if(review[0]?.method!=='IN_APP'||review[0]?.reviewer_subject_type!=='USER'){item.blockedReason='EXTERNAL_REVIEW_AUTHORITY_REQUIRES_REVERIFICATION';return [];}
   qualifications=(await client.query(`SELECT dv.uploaded_by,r.reviewer_role FROM document_versions dv
    JOIN document_requirements dr ON dr.org_id=dv.org_id AND dr.project_id=dv.project_id AND dr.document_id=dv.document_id
    JOIN requirements r ON r.org_id=dr.org_id AND r.project_id=dr.project_id AND r.id=dr.requirement_id AND r.superseded_at IS NULL
    WHERE dv.org_id=$1 AND dv.project_id=$2 AND dv.id=$3`,[org,item.project_id,review[0].document_version_id])).rows;
   if(!qualifications.length){item.blockedReason='REVIEW_QUALIFICATION_MAPPING_REQUIRED';return [];}
  }
  return members.filter(member=>{
   if(!hasPermission({orgRole:member.role,projectRole:member.project_role},WORK[item.kind as Kind].permission as Permission).allowed)return false;
   if(!['R-OWNER','R-ADMIN'].includes(member.role)){
    const scope=member.scope_json??{};try{assertValidMemberProjectScope(scope);}catch{return false;}
    if(scope.readOnly||scope.mode==='READ_ONLY'||Object.keys(scope).some(k=>!['readOnly','mode'].includes(k)))return false;
   }
   return !qualifications.some(q=>q.uploaded_by===member.user_id||![member.role,member.project_role].includes(q.reviewer_role));
  }).map(member=>({userId:member.user_id,name:member.name,role:member.role}));
 }
 async manifest(ctx:TenantActorContext,target:string){requireProjectCommandId(target,'INVALID_MEMBER_ID');return withTenantTransaction(this.pool,ctx,async client=>{
  await this.authority(client,ctx,target);const items=await this.manifestRows(client,ctx.orgId,target);
  for(const item of items){item.eligibleReplacements=await this.candidates(client,ctx.orgId,target,item);if(!item.blockedReason&&!item.eligibleReplacements.length)item.blockedReason='NO_CURRENTLY_QUALIFIED_REPLACEMENT';}
  return {targetUserId:target,items,immutableAuthorshipTransferred:false};
 });}
 async allocate(ctx:TenantActorContext,value:unknown){
  const dto=projectCommandRecord(value,['targetUserId','requestKey','reason','allocations'],'INVALID_WORK_ALLOCATION');
  requireProjectCommandId(dto.targetUserId,'INVALID_MEMBER_ID');requireProjectCommandId(dto.requestKey,'INVALID_REQUEST_KEY');
  if(typeof dto.reason!=='string'||dto.reason.trim().length<5||dto.reason.length>500||!Array.isArray(dto.allocations)||!dto.allocations.length||dto.allocations.length>100)
   throw new UnprocessableEntityException('INVALID_WORK_ALLOCATION');
  const seen=new Set<string>();const allocations=dto.allocations.map(raw=>{
   const row=projectCommandRecord(raw,['kind','id','replacementUserId','rowVersion'],'INVALID_WORK_ALLOCATION');
   if(typeof row.kind!=='string'||!Object.hasOwn(WORK,row.kind)||!Number.isSafeInteger(row.rowVersion)||Number(row.rowVersion)<1)throw new UnprocessableEntityException('INVALID_WORK_ALLOCATION');
   requireProjectCommandId(row.id,'INVALID_WORK_ID');requireProjectCommandId(row.replacementUserId,'INVALID_REPLACEMENT_ID');
   if(row.replacementUserId===dto.targetUserId||seen.has(row.kind+':'+row.id))throw new UnprocessableEntityException('INVALID_WORK_ALLOCATION');seen.add(row.kind+':'+row.id);
   return {kind:row.kind as Kind,id:row.id as string,replacementUserId:row.replacementUserId as string,rowVersion:row.rowVersion as number};
  }).sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id));
  const hash=createHash('sha256').update(JSON.stringify({target:dto.targetUserId,reason:dto.reason.trim(),allocations})).digest('hex');
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.authority(client,ctx,dto.targetUserId as string);
   const {rows:receipts}=await client.query('SELECT actor_user_id,input_hash,response_json FROM work_allocation_commands WHERE org_id=$1 AND request_key=$2',[ctx.orgId,dto.requestKey]);
   if(receipts[0]){if(receipts[0].actor_user_id!==ctx.userId||receipts[0].input_hash!==hash)throw new ConflictException('WORK_ALLOCATION_REPLAY_CONFLICT');return receipts[0].response_json;}
   const ids=[...new Set(allocations.map(a=>a.replacementUserId))].sort();
   const {rows:members}=await client.query(`SELECT m.user_id,m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
    WHERE m.org_id=$1 AND m.user_id=ANY($2::uuid[]) AND m.status='ACTIVE' ORDER BY m.user_id FOR SHARE OF m,u`,[ctx.orgId,ids]);
   if(members.length!==ids.length)throw new ConflictException('REPLACEMENT_MEMBER_NOT_ELIGIBLE');
   const initial=await this.manifestRows(client,ctx.orgId,dto.targetUserId as string);
   const selected=allocations.map(a=>initial.find(row=>row.kind===a.kind&&row.id===a.id));
   if(selected.some(row=>!row))throw new ConflictException('WORK_ALLOCATION_MANIFEST_STALE');
   const projects=[...new Set(selected.map(row=>row.project_id))].sort();
   const {rows:lockedProjects}=await client.query('SELECT id,status,purged_at FROM projects WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[ctx.orgId,projects]);
   if(lockedProjects.length!==projects.length||lockedProjects.some(p=>p.purged_at||!['DRAFT','ACTIVE','HANDOVER'].includes(p.status)))throw new ConflictException('PROJECT_LIFECYCLE_BLOCKS_REASSIGNMENT');
   for(const allocation of allocations){
    const definition=WORK[allocation.kind];
    const {rows}=await client.query(`SELECT * FROM ${definition.table} WHERE org_id=$1 AND id=$2 AND ${definition.owner}=$3 AND ${definition.open} FOR UPDATE`,[ctx.orgId,allocation.id,dto.targetUserId]);
    const work=rows[0];if(!work||work.row_version!==allocation.rowVersion)throw new ConflictException('WORK_ALLOCATION_MANIFEST_STALE');
    const replacement=members.find(m=>m.user_id===allocation.replacementUserId)!;let projectRole:string|undefined;
    if(!['R-OWNER','R-ADMIN'].includes(replacement.role)){
     const {rows:pm}=await client.query("SELECT role,scope_json FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",[ctx.orgId,work.project_id,allocation.replacementUserId]);
     if(!pm.length)throw new ConflictException('REPLACEMENT_PROJECT_SCOPE_REQUIRED');
     try{assertValidMemberProjectScope(pm[0].scope_json);}catch{throw new ConflictException('REPLACEMENT_PROJECT_SCOPE_REQUIRED');}
     const scope=pm[0].scope_json??{};if(scope.readOnly||scope.mode==='READ_ONLY'||Object.keys(scope).some(k=>!['readOnly','mode'].includes(k)))throw new ConflictException('REPLACEMENT_PROJECT_SCOPE_REQUIRED');
     projectRole=pm[0].role;
    }
    if(!hasPermission({orgRole:replacement.role,projectRole},definition.permission as Permission).allowed)throw new ConflictException('REPLACEMENT_RESPONSIBILITY_CAPABILITY_REQUIRED');
    if(allocation.kind==='REVIEW'){
     if(work.reviewer_subject_type!=='USER'||work.method!=='IN_APP')throw new ConflictException('EXTERNAL_REVIEW_AUTHORITY_REQUIRES_REVERIFICATION');
     const {rows:qualification}=await client.query(`SELECT dv.uploaded_by,r.reviewer_role FROM document_versions dv
      JOIN document_requirements dr ON dr.org_id=dv.org_id AND dr.project_id=dv.project_id AND dr.document_id=dv.document_id
      JOIN requirements r ON r.org_id=dr.org_id AND r.project_id=dr.project_id AND r.id=dr.requirement_id AND r.superseded_at IS NULL
      WHERE dv.org_id=$1 AND dv.project_id=$2 AND dv.id=$3`,[ctx.orgId,work.project_id,work.document_version_id]);
     if(!qualification.length||qualification.some(q=>q.uploaded_by===allocation.replacementUserId||![replacement.role,projectRole].includes(q.reviewer_role)))throw new ConflictException('REPLACEMENT_REVIEW_QUALIFICATION_REQUIRED');
    }
    const extra=allocation.kind==='REVIEW'?',reviewer_subject_id=$3':'';
    await client.query(`UPDATE ${definition.table} SET ${definition.owner}=$3,row_version=row_version+1${extra} WHERE org_id=$1 AND id=$2`,[ctx.orgId,allocation.id,allocation.replacementUserId]);
   }
   const result={allocated:allocations.length,remaining:await this.manifestRows(client,ctx.orgId,dto.targetUserId as string),immutableAuthorshipTransferred:false};
   await client.query('INSERT INTO work_allocation_commands(id,org_id,request_key,actor_user_id,target_user_id,input_hash,response_json) VALUES($1,$2,$3,$4,$5,$6,$7)',[uuidv7(),ctx.orgId,dto.requestKey,ctx.userId,dto.targetUserId,hash,JSON.stringify(result)]);
   emit({eventType:'MEMBER_WORK_ALLOCATED',entityType:'USER',entityId:dto.targetUserId as string,afterJson:{reason:dto.reason,allocations}});return result;
  });
 }
}
