import {Body,Controller,ForbiddenException,ConflictException,Post,Req,UseGuards,UnprocessableEntityException} from '@nestjs/common';
import {Pool} from 'pg';
import {withTenantTransaction} from '@tradecloseout/db';
import {SessionCsrfGuard} from '../../common/guards/session-csrf.guard';
import {PermissionGuard,RequirePermission} from '../../common/guards/permission.guard';
import {RequireIdempotency} from '../../common/decorators/idempotency.decorator';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
@Controller('api/v1/billing') @UseGuards(SessionCsrfGuard,PermissionGuard)
export class ProjectOfferController{
 constructor(private readonly pool:Pool){}
 @Post('project-scope') @RequirePermission('billing.manage') @RequireIdempotency()
 bind(@Req()req:any,@Body()value:unknown){
  const dto=projectCommandRecord(value,['projectId','rowVersion'],'INVALID_PROJECT_OFFER_BINDING');
  requireProjectCommandId(dto.projectId,'INVALID_PROJECT_ID');
  if(!Number.isSafeInteger(dto.rowVersion)||Number(dto.rowVersion)<1)throw new UnprocessableEntityException('SUBSCRIPTION_VERSION_REQUIRED');
  const ctx=req.userContext;
  return withTenantTransaction(this.pool,{...ctx,organisationWrite:true},async(client,emit)=>{
   const {rows:members}=await client.query(`SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,ctx.userId]);
   if(ctx.guestGrantId||!['R-OWNER','R-ADMIN'].includes(members[0]?.role))throw new ForbiddenException('PROJECT_OFFER_BINDING_AUTHORITY_REQUIRED');
   const {rows:sessions}=await client.query(`SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND active_org_id=$3 AND auth_generation=$4
    AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now() AND guest_grant_id IS NULL
    AND mfa_verified=true AND mfa_verified_at<=now() AND mfa_verified_at>now()-interval '5 minutes' FOR SHARE`,[ctx.sessionId,ctx.userId,ctx.orgId,ctx.authGeneration]);
   if(!sessions.length)throw new ForbiddenException('FRESH_MFA_REQUIRED');
   const {rows:projects}=await client.query(`SELECT id FROM projects WHERE org_id=$1 AND id=$2 AND purged_at IS NULL AND status IN('DRAFT','ACTIVE') FOR UPDATE`,[ctx.orgId,dto.projectId]);
   if(!projects.length)throw new ConflictException('PROJECT_OFFER_TARGET_NOT_ELIGIBLE');
   const {rows}=await client.query(`SELECT s.*,p.status AS policy_status,p.one_time_project_model FROM subscriptions s
    JOIN billing_policy_versions p ON p.id=s.policy_version_id WHERE s.org_id=$1 FOR UPDATE OF s`,[ctx.orgId]);const sub=rows[0];
   if(!sub||sub.interval_snapshot!=='ONE_TIME_PROJECT'||sub.policy_status!=='APPROVED'||sub.one_time_project_model!=='ORG_TEAM_AND_ONE_PROJECT')throw new ConflictException('PROJECT_OFFER_POLICY_UNAPPROVED');
   if(sub.row_version!==dto.rowVersion||sub.project_id)throw new ConflictException('PROJECT_OFFER_VERSION_OR_SCOPE_CONFLICT');
   await client.query('UPDATE subscriptions SET project_id=$2,row_version=row_version+1,updated_at=now() WHERE org_id=$1',[ctx.orgId,dto.projectId]);
   emit({eventType:'PROJECT_OFFER_BOUND',projectId:dto.projectId as string,entityType:'SUBSCRIPTION',entityId:sub.id,afterJson:{projectId:dto.projectId}});
   return {subscriptionId:sub.id,scopeProjectId:dto.projectId,rowVersion:sub.row_version+1};
  });
 }
}
