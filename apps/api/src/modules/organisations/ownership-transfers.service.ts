import {ConflictException,ForbiddenException,ServiceUnavailableException,UnprocessableEntityException,NotFoundException} from '@nestjs/common';
import {Pool,PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import {withTenantTransaction,TenantActorContext} from '@tradecloseout/db';
import {requireOrganisationUuid} from './organisation-validation';

/** Durations require explicit operational configuration; no provisional policy is
 * silently approved or enabled. Legacy one-sided transfer stays disabled. */
export class OwnershipTransfersService {
 constructor(private readonly pool:Pool){}
 private policy(){
  const ttl=Number(process.env.OWNERSHIP_INTENT_TTL_SECONDS),mfa=Number(process.env.OWNERSHIP_MFA_MAX_AGE_SECONDS);
  if(!Number.isSafeInteger(ttl)||ttl<60||ttl>86400||!Number.isSafeInteger(mfa)||mfa<30||mfa>900)throw new ServiceUnavailableException({code:'OWNERSHIP_POLICY_NOT_CONFIGURED'});
  return {ttl,mfa};
 }
 private async assure(client:PoolClient,ctx:TenantActorContext,maxAge:number){
  if(!ctx.sessionId||!ctx.authGeneration)throw new ForbiddenException({code:'OWNERSHIP_FRESH_MFA_REQUIRED'});
  const {rows}=await client.query(`SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND active_org_id=$3
   AND auth_generation=$4 AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now()
   AND guest_grant_id IS NULL AND mfa_verified=true AND mfa_verified_at<=now()
   AND mfa_verified_at>now()-($5::integer*interval '1 second') FOR SHARE`,[ctx.sessionId,ctx.userId,ctx.orgId,ctx.authGeneration,maxAge]);
  if(!rows.length)throw new ForbiddenException({code:'OWNERSHIP_FRESH_MFA_REQUIRED'});
 }
 async request(ctx:TenantActorContext,input:{targetUserId:string;rowVersion:number;requestKey:string}){
  const policy=this.policy();const target=requireOrganisationUuid(input?.targetUserId,'targetUserId');
  const key=requireOrganisationUuid(input?.requestKey,'requestKey');
  if(target===ctx.userId)throw new UnprocessableEntityException({code:'OWNER_TRANSFER_REQUIRES_DIFFERENT_MEMBER'});
  if(!Number.isSafeInteger(input.rowVersion)||input.rowVersion<1)throw new UnprocessableEntityException({code:'ROW_VERSION_REQUIRED'});
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.assure(client,ctx,policy.mfa);
   const {rows:owner}=await client.query(`SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,ctx.userId]);
   if(owner[0]?.role!=='R-OWNER')throw new ForbiddenException({code:'CURRENT_OWNER_REQUIRED'});
   const {rows:org}=await client.query('SELECT row_version FROM organisations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
   const {rows:existing}=await client.query('SELECT * FROM ownership_transfer_intents WHERE org_id=$1 AND request_key=$2',[ctx.orgId,key]);
   if(existing.length){const x=existing[0];if(x.requested_by!==ctx.userId||x.recipient_user_id!==target||x.expected_org_version!==input.rowVersion)throw new ConflictException({code:'OWNERSHIP_REQUEST_KEY_CONFLICT'});return {intentId:x.id,status:x.status,expiresAt:x.expires_at};}
   if(org[0]?.row_version!==input.rowVersion)throw new ConflictException({code:'PRECONDITION_FAILED'});
   const {rows:recipient}=await client.query(`SELECT m.row_version FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role<>'R-OWNER' AND u.status='ACTIVE' FOR SHARE OF m,u`,[ctx.orgId,target]);
   if(!recipient.length)throw new UnprocessableEntityException({code:'INVALID_TARGET_OWNER'});
   await client.query(`UPDATE ownership_transfer_intents SET status='EXPIRED',decided_at=now() WHERE org_id=$1 AND status='PENDING' AND expires_at<=now()`,[ctx.orgId]);
   const {rows:pending}=await client.query(`SELECT id FROM ownership_transfer_intents WHERE org_id=$1 AND status='PENDING'`,[ctx.orgId]);
   if(pending.length)throw new ConflictException({code:'OWNERSHIP_TRANSFER_ALREADY_PENDING'});
   const id=uuidv7();const {rows}=await client.query(`INSERT INTO ownership_transfer_intents(id,org_id,requested_by,recipient_user_id,request_key,expected_org_version,recipient_membership_version,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8::integer*interval '1 second')) RETURNING expires_at`,[id,ctx.orgId,ctx.userId,target,key,input.rowVersion,recipient[0].row_version,policy.ttl]);
   emit({eventType:'OWNERSHIP_TRANSFER_REQUESTED',entityType:'ORGANISATION',entityId:ctx.orgId,afterJson:{intentId:id,recipientUserId:target,expectedOrgVersion:input.rowVersion}});
   return {intentId:id,status:'PENDING',expiresAt:rows[0].expires_at};
  });
 }
 async decide(ctx:TenantActorContext,intentId:string,decision:'ACCEPT'|'CANCEL'){
  const policy=this.policy();requireOrganisationUuid(intentId,'intentId');
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   await this.assure(client,ctx,policy.mfa);
   const {rows}=await client.query(`SELECT * FROM ownership_transfer_intents WHERE org_id=$1 AND id=$2 FOR UPDATE`,[ctx.orgId,intentId]);
   const intent=rows[0];if(!intent)throw new NotFoundException('OWNERSHIP_INTENT_NOT_FOUND');
   if(decision==='ACCEPT'&&intent.recipient_user_id!==ctx.userId)throw new ForbiddenException({code:'OWNERSHIP_RECIPIENT_REQUIRED'});
   if(decision==='CANCEL'&&![intent.requested_by,intent.recipient_user_id].includes(ctx.userId))throw new ForbiddenException({code:'OWNERSHIP_PARTICIPANT_REQUIRED'});
   if(intent.status!=='PENDING')throw new ConflictException({code:'OWNERSHIP_INTENT_ALREADY_DECIDED'});
   if(new Date(intent.expires_at).getTime()<=Date.now())throw new ConflictException({code:'OWNERSHIP_INTENT_EXPIRED'});
   if(decision==='CANCEL'){
    await client.query(`UPDATE ownership_transfer_intents SET status='CANCELLED',decided_at=now() WHERE id=$1 AND org_id=$2`,[intentId,ctx.orgId]);
    emit({eventType:'OWNERSHIP_TRANSFER_CANCELLED',entityType:'ORGANISATION',entityId:ctx.orgId,afterJson:{intentId}});return {intentId,status:'CANCELLED'};
   }
   const {rows:org}=await client.query('SELECT row_version FROM organisations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
   if(org[0]?.row_version!==intent.expected_org_version)throw new ConflictException({code:'OWNERSHIP_INTENT_STALE'});
   const {rows:members}=await client.query(`SELECT m.user_id,m.role,m.row_version FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
    WHERE m.org_id=$1 AND m.user_id=ANY($2::uuid[]) AND m.status='ACTIVE' ORDER BY m.user_id FOR UPDATE OF m FOR SHARE OF u`,[ctx.orgId,[intent.requested_by,intent.recipient_user_id]]);
   const owner=members.find(m=>m.user_id===intent.requested_by),recipient=members.find(m=>m.user_id===intent.recipient_user_id);
   if(owner?.role!=='R-OWNER'||!recipient||recipient.role==='R-OWNER'||recipient.row_version!==intent.recipient_membership_version)throw new ConflictException({code:'OWNERSHIP_ELIGIBILITY_CHANGED'});
   await client.query(`UPDATE memberships SET role='R-ADMIN',row_version=row_version+1,updated_at=now() WHERE org_id=$1 AND user_id=$2`,[ctx.orgId,intent.requested_by]);
   await client.query(`UPDATE memberships SET role='R-OWNER',row_version=row_version+1,updated_at=now() WHERE org_id=$1 AND user_id=$2`,[ctx.orgId,intent.recipient_user_id]);
   await client.query('UPDATE organisations SET row_version=row_version+1,updated_at=now() WHERE id=$1',[ctx.orgId]);
   await client.query(`UPDATE invitations SET status='REVOKED' WHERE org_id=$1 AND invited_by=$2 AND role='R-ADMIN' AND status IN ('PENDING','DELIVERY_PENDING')`,[ctx.orgId,intent.requested_by]);
   await client.query(`WITH revoked AS (UPDATE sessions SET revoked_at=now(),mfa_verified=false,mfa_verified_at=NULL
    WHERE active_org_id=$1 AND user_id=ANY($2::uuid[]) AND revoked_at IS NULL RETURNING id,user_id,active_org_id)
    INSERT INTO auth_security_events(id,actor_user_id,org_id,session_id,event_type,outcome)
    SELECT gen_random_uuid(),user_id,active_org_id,id,'OWNERSHIP_TRANSFER_SESSION_REVOKED','SUCCESS' FROM revoked`,[ctx.orgId,[intent.requested_by,intent.recipient_user_id]]);
   await client.query(`UPDATE ownership_transfer_intents SET status='ACCEPTED',decided_at=now() WHERE org_id=$1 AND id=$2`,[ctx.orgId,intentId]);
   emit({eventType:'OWNERSHIP_TRANSFER_ACCEPTED',entityType:'ORGANISATION',entityId:ctx.orgId,afterJson:{intentId,previousOwnerUserId:intent.requested_by,newOwnerUserId:intent.recipient_user_id}});
   return {intentId,status:'ACCEPTED',previousOwnerUserId:intent.requested_by,newOwnerUserId:intent.recipient_user_id};
  });
 }
}
