import {ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException,UnprocessableEntityException} from '@nestjs/common';
import {Pool,PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import {withTenantTransaction,TenantActorContext} from '@tradecloseout/db';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
@Injectable()
export class OrganisationAdministrationService{
 constructor(private readonly pool:Pool){}
 private async authority(client:PoolClient,ctx:TenantActorContext,owner=false){
  if(ctx.guestGrantId||!['MEMBER','USER','ADMIN'].includes(ctx.actorType))throw new ForbiddenException('ORGANISATION_ADMINISTRATION_REQUIRED');
  const {rows}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
   WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u`,[ctx.orgId,ctx.userId]);
  if(!rows.length||!(owner?['R-OWNER']:['R-OWNER','R-ADMIN']).includes(rows[0].role))throw new ForbiddenException('ORGANISATION_ADMINISTRATION_REQUIRED');
 }
 private async freshMfa(client:PoolClient,ctx:TenantActorContext){
  const age=Number(process.env.ORG_DELETION_MFA_MAX_AGE_SECONDS);
  if(!Number.isInteger(age)||age<30||age>900)throw new ServiceUnavailableException('ORGANISATION_DELETION_POLICY_NOT_CONFIGURED');
  if(!ctx.sessionId||!ctx.authGeneration)throw new ForbiddenException('FRESH_MFA_REQUIRED');
  const {rows}=await client.query(`SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND active_org_id=$3 AND auth_generation=$4
   AND guest_grant_id IS NULL AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now()
   AND mfa_verified=true AND mfa_verified_at<=now() AND mfa_verified_at>now()-make_interval(secs=>$5) FOR SHARE`,[ctx.sessionId,ctx.userId,ctx.orgId,ctx.authGeneration,age]);
  if(!rows.length)throw new ForbiddenException('FRESH_MFA_REQUIRED');
 }
 async onboarding(ctx:TenantActorContext){return withTenantTransaction(this.pool,ctx,async client=>{
  await this.authority(client,ctx);
  const {rows}=await client.query('SELECT * FROM organisation_onboarding WHERE org_id=$1',[ctx.orgId]);
  const {rows:templates}=await client.query(`SELECT id,code,name,version FROM template_packs WHERE trade='HVAC' AND status='ACTIVE'
   AND governance_version=1 AND schema_version=1 AND reviewer_identity<>author_identity AND reviewed_at IS NOT NULL
   AND review_record_json IS NOT NULL AND reviewed_candidate_sha ~ '^[a-f0-9]{40}$'
   AND payload_checksum=encode(digest(payload_json::text,'sha256'),'hex') ORDER BY code,version DESC`);
  return {progress:rows[0]??{org_id:ctx.orgId,step:0,row_version:0},termsVersion:process.env.ONBOARDING_TERMS_VERSION??null,
   termsUrl:process.env.ONBOARDING_TERMS_URL??null,templates};
 });}
 async saveOnboarding(ctx:TenantActorContext,value:unknown){
  const dto=projectCommandRecord(value,['step','rowVersion','termsVersion','acceptTerms','templatePackId'],'INVALID_ONBOARDING_INPUT');
  if(!Number.isInteger(dto.step)||Number(dto.step)<0||Number(dto.step)>4||!Number.isInteger(dto.rowVersion)||Number(dto.rowVersion)<0||
    dto.acceptTerms!==undefined&&typeof dto.acceptTerms!=='boolean')throw new UnprocessableEntityException('INVALID_ONBOARDING_INPUT');
  if(dto.templatePackId!==undefined&&dto.templatePackId!==null)requireProjectCommandId(dto.templatePackId,'INVALID_TEMPLATE_ID');
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.authority(client,ctx);
   const {rows}=await client.query('SELECT * FROM organisation_onboarding WHERE org_id=$1 FOR UPDATE',[ctx.orgId]);const previous=rows[0];
   if((previous?.row_version??0)!==dto.rowVersion)throw new ConflictException('ONBOARDING_VERSION_STALE');
   if(previous?.completed_at)throw new ConflictException('ONBOARDING_ALREADY_COMPLETED');
   const terms=process.env.ONBOARDING_TERMS_VERSION;
   if(dto.acceptTerms===true&&(!terms||dto.termsVersion!==terms))throw new ConflictException('CURRENT_TERMS_VERSION_REQUIRED');
   const pack=dto.templatePackId===undefined?previous?.selected_template_pack_id??null:dto.templatePackId;
   if(pack){const {rows:packs}=await client.query('SELECT id FROM lock_reviewed_hvac_pack_for_organisation($1)',[pack]);
    if(!packs.length)throw new ConflictException('REVIEWED_TEMPLATE_REQUIRED');}
   const accepted=previous?.terms_accepted_at||dto.acceptTerms===true;
   if(dto.step===4&&(!accepted||!pack))throw new ConflictException('ONBOARDING_CONSENT_AND_TEMPLATE_REQUIRED');
   const {rows:updated}=await client.query(`INSERT INTO organisation_onboarding(org_id,step,terms_version,terms_accepted_by,terms_accepted_at,
    selected_template_pack_id,completed_at,row_version) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,$6,CASE WHEN $2=4 THEN now() ELSE NULL END,1)
    ON CONFLICT(org_id) DO UPDATE SET step=EXCLUDED.step,terms_version=COALESCE(organisation_onboarding.terms_version,EXCLUDED.terms_version),
    terms_accepted_by=COALESCE(organisation_onboarding.terms_accepted_by,EXCLUDED.terms_accepted_by),terms_accepted_at=COALESCE(organisation_onboarding.terms_accepted_at,EXCLUDED.terms_accepted_at),
    selected_template_pack_id=EXCLUDED.selected_template_pack_id,completed_at=EXCLUDED.completed_at,row_version=organisation_onboarding.row_version+1 RETURNING *`,
    [ctx.orgId,dto.step,dto.acceptTerms===true?terms:null,dto.acceptTerms===true?ctx.userId:null,dto.acceptTerms===true,pack]);
   emit({eventType:'ORGANISATION_ONBOARDING_UPDATED',entityType:'ORGANISATION',entityId:ctx.orgId,afterJson:{step:dto.step,consentRecorded:!!accepted,templatePackId:pack}});return updated[0];
  });
 }
 async deletionRequests(ctx:TenantActorContext){return withTenantTransaction(this.pool,ctx,async client=>{
  await this.authority(client,ctx,true);return (await client.query(`SELECT id,status,reason,retention_evaluation_json,created_at,cancelled_at
   FROM organisation_deletion_requests WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,[ctx.orgId])).rows;
 });}
 async requestDeletion(ctx:TenantActorContext,value:unknown){
  const dto=projectCommandRecord(value,['requestKey','rowVersion','confirmedName','reason'],'INVALID_DELETION_REQUEST');
  requireProjectCommandId(dto.requestKey,'INVALID_REQUEST_KEY');
  if(!Number.isSafeInteger(dto.rowVersion)||Number(dto.rowVersion)<1||typeof dto.confirmedName!=='string'||dto.confirmedName.length>200||
   typeof dto.reason!=='string'||dto.reason.trim().length<10||dto.reason.length>1000)throw new UnprocessableEntityException('INVALID_DELETION_REQUEST');
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.authority(client,ctx,true);await this.freshMfa(client,ctx);
   const {rows:[org]}=await client.query('SELECT legal_name,row_version FROM organisations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
   const {rows:existing}=await client.query('SELECT * FROM organisation_deletion_requests WHERE org_id=$1 AND request_key=$2',[ctx.orgId,dto.requestKey]);
   if(existing[0]){
    if(existing[0].requested_by!==ctx.userId||existing[0].requested_org_version!==dto.rowVersion||existing[0].confirmed_name!==dto.confirmedName||existing[0].reason!==(dto.reason as string).trim())throw new ConflictException('DELETION_REQUEST_KEY_CONFLICT');
    return existing[0];
   }
   if(org.row_version!==dto.rowVersion)throw new ConflictException('ORGANISATION_VERSION_STALE');
   if(org.legal_name!==dto.confirmedName)throw new UnprocessableEntityException('EXACT_ORGANISATION_NAME_REQUIRED');
   const {rows:[holds]}=await client.query('SELECT count(*)::int AS n FROM legal_holds WHERE org_id=$1 AND released_at IS NULL',[ctx.orgId]);
   const evaluation={activeLegalHolds:holds.n,retentionReviewRequired:true,backupReviewRequired:true,providerReviewRequired:true,physicalExecutionEnabled:false};
   const id=uuidv7();const {rows}=await client.query(`INSERT INTO organisation_deletion_requests(id,org_id,requested_by,request_key,requested_org_version,confirmed_name,reason,status,retention_evaluation_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[id,ctx.orgId,ctx.userId,dto.requestKey,dto.rowVersion,dto.confirmedName,(dto.reason as string).trim(),holds.n?'BLOCKED_RETENTION':'PENDING_REVIEW',JSON.stringify(evaluation)]);
   emit({eventType:'ORGANISATION_DELETION_REQUESTED',entityType:'ORGANISATION_DELETION_REQUEST',entityId:id,afterJson:{status:rows[0].status,activeLegalHolds:holds.n}});return rows[0];
  });
 }
 async cancelDeletion(ctx:TenantActorContext,id:string){
  requireProjectCommandId(id,'INVALID_DELETION_REQUEST_ID');return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.authority(client,ctx,true);await this.freshMfa(client,ctx);
   const {rows}=await client.query(`UPDATE organisation_deletion_requests SET status='CANCELLED',cancelled_at=now()
    WHERE org_id=$1 AND id=$2 AND status IN('PENDING_REVIEW','BLOCKED_RETENTION') RETURNING id,status`,[ctx.orgId,id]);
   if(!rows.length)throw new ConflictException('DELETION_REQUEST_NOT_CANCELLABLE');
   emit({eventType:'ORGANISATION_DELETION_CANCELLED',entityType:'ORGANISATION_DELETION_REQUEST',entityId:id,afterJson:{status:'CANCELLED'}});return rows[0];
  });
 }
}
