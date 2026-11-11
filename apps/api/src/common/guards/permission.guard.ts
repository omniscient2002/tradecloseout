// G02: one fail-closed project, guest and member authorization boundary.
// Resolve actual tenant-owned resource before capability and membership checks.
// HTTP guard is not the transaction fence: both tenant wrappers revalidate
// the live member/grant under FOR SHARE during the protected operation.
import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
  NotFoundException, UnprocessableEntityException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { hasPermission } from '@tradecloseout/shared';
import { recordDeniedAuthenticationEvent } from '../../modules/identity/auth-security';

export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PARAMS = new Set([
  'id','projectId','documentId','versionId','documentVersionId','requirementId',
  'assetId','reviewId','packageId','submissionId','recipientId','exportId',
  'contractId','userId','orgId','partyId','obligationId','grantId',
]);
const UUID_ARRAY_FIELDS = new Set([
  'assetIds','requirementIds','documentIds','versionIds','reviewIds','packageIds',
]);

/** Reject hostile JS coercion and malformed IDs BEFORE any resource lookup. */
export function assertAuthorizationInputShape(params:any, body:any): void {
  if (params && (typeof params!=='object' || Array.isArray(params))) {
    throw new UnprocessableEntityException({code:'INVALID_RESOURCE_ID'});
  }
  for (const [k,v] of Object.entries(params||{})) {
    if (!UUID_PARAMS.has(k)) continue;
    if (k==='orgId' && v==='current') continue;
    if (typeof v!=='string' || !UUID.test(v)) {
      throw new UnprocessableEntityException({code:'INVALID_RESOURCE_ID'});
    }
  }
  if (!body || typeof body!=='object' || Array.isArray(body)) return;
  for (const [key,value] of Object.entries(body)) {
    if (!UUID_ARRAY_FIELDS.has(key)) continue;
    if (!Array.isArray(value) || value.length>100 ||
        value.some(v=>typeof v!=='string'||!UUID.test(v)) ||
        new Set(value).size!==value.length) {
      throw new UnprocessableEntityException({code:'INVALID_RESOURCE_IDS'});
    }
  }
}

const RESOURCE_ROUTES: Array<[string,string,string[]]> = [
  ['/document-versions/','document_versions',['versionId','documentVersionId','id']],
  ['/documents/','documents',['documentId','id']],
  ['/requirements/','requirements',['requirementId','id']],
  ['/assets/','assets',['assetId','id']],
  ['/reviews/','reviews',['reviewId','id']],
  ['/packages/','handover_packages',['packageId','id']],
  ['/submissions/','submissions',['submissionId','id']],
];

/** Resolve only known table names, never request-defined SQL identifiers. */
function targetResource(route:string, params:any):{table:string,id:string}|undefined {
  for(const [fragment,table,keys] of RESOURCE_ROUTES){
    if(!route.includes(fragment)) continue;
    const key=keys.find(k=>params?.[k]);
    if(key)return {table,id:params[key]};
  }
  return undefined;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector:Reflector,private readonly pool:Pool){}

  async canActivate(context:ExecutionContext):Promise<boolean> {
    const permission=this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,[context.getHandler(),context.getClass()],
    );
    if (!permission) return true;
    const req=context.switchToHttp().getRequest();
    const user=req.user;
    const isGuest=Boolean(user?.guestGrantId || user?.actorType==='GUEST');
    try {
      if (!user || !user.orgId || !user.userId) {
        throw new ForbiddenException({code:'UNAUTHENTICATED'});
      }
      assertAuthorizationInputShape(req.params,req.body);
      if (isGuest && ['package.accept','inspection.witness','review.decide'].includes(permission) &&
          user.guestAuthorityVerified!==true) {
        throw new ForbiddenException({code:'INDEPENDENT_PARTY_AUTHORITY_REQUIRED'});
      }
      if (isGuest && new Set([
        'org.manage','org.delete','org.transfer_ownership',
        'billing.manage','billing.read','party.manage','template.manage',
        'export.data','org.manage_members',
      ]).has(permission)) {
        throw new ForbiddenException({code:'GUEST_PERMISSION_DENIED'});
      }

      // Express route.path may lack the controller prefix or leading slash.
      // The actual parsed request pathname includes both, so use it first.
      const route=String(req.path||req.route?.path||'');
      let projectId:string|undefined=req.params?.projectId ||
        (route.startsWith('/projects/:id') ||
         (route.startsWith('/api/v1/projects/') && !req.params?.projectId)
          ? req.params?.id : undefined);
      const resource=targetResource(route,req.params);
      let projectRole:string|undefined=user.projectRole;
      let projectScope:Record<string,unknown>|undefined=user.projectScope;
      const client=await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",
          [user.orgId],
        );
        await client.query("SELECT set_config('app.current_user',$1,true)",[user.userId]);
        if(resource){
          const {rows}=await client.query(
            `SELECT project_id FROM ${resource.table}
               WHERE org_id=$1 AND id=$2 LIMIT 1`,
            [user.orgId,resource.id],
          );
          if (!rows.length || (projectId && projectId!==rows[0].project_id)) {
            throw new NotFoundException({code:'RESOURCE_NOT_FOUND'});
          }
          projectId=rows[0].project_id;
        }
        if(projectId && !isGuest &&
           user.orgRole!=='R-OWNER' && user.orgRole!=='R-ADMIN'){
          const {rows}=await client.query(
            `SELECT role,scope_json FROM project_members
               WHERE org_id=$1 AND project_id=$2 AND user_id=$3
                 AND status='ACTIVE' LIMIT 1`,
            [user.orgId,projectId,user.userId],
          );
          if(rows.length){
            projectRole=rows[0].role;
            projectScope=rows[0].scope_json;
          }else{
            projectRole=undefined;
            projectScope=undefined;
          }
        }
        await client.query('COMMIT');
      } catch(error){
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
      } finally {
        client.release();
      }

      if(projectId && isGuest &&
        (!user.guestProjectId || projectId!==user.guestProjectId)) {
        throw new NotFoundException({code:'RESOURCE_NOT_FOUND'});
      }
      const evaluation=hasPermission({
        orgRole:isGuest?undefined:user.orgRole,
        projectRole:isGuest?undefined:projectRole,
        guestCapabilities:isGuest?user.guestCapabilities||[]:[],
        docControllerOrgWideDownload:!isGuest && user.docControllerOrgWideDownload===true,
      },permission);
      if(!evaluation.allowed){
        throw new ForbiddenException({code:'PERMISSION_DENIED'});
      }

      if(projectId && !isGuest &&
         user.orgRole!=='R-OWNER' && user.orgRole!=='R-ADMIN' &&
         !(user.orgRole==='R-DOC' && permission==='document.download' &&
           user.docControllerOrgWideDownload===true) && !projectRole){
        throw new NotFoundException({code:'RESOURCE_NOT_FOUND'});
      }
      if (projectId && projectScope?.readOnly===true &&
          !['GET','HEAD','OPTIONS'].includes(String(req.method||'').toUpperCase())) {
        throw new ForbiddenException({code:'RESOURCE_SCOPE_READ_ONLY'});
      }
      if (projectId && isGuest && (!user.guestGrantId || !user.guestScope)) {
        throw new NotFoundException({code:'RESOURCE_NOT_FOUND'});
      }
      if(!projectId && isGuest){
        throw new NotFoundException({code:'PROJECT_SCOPE_REQUIRED'});
      }
      if(!projectId && req.method!=='GET' && req.params?.id){
        throw new NotFoundException({code:'RESOURCE_SCOPE_UNRESOLVED'});
      }

      req.permissionScope=evaluation.scope;
      req.user.projectRole=projectRole;
      req.user.projectScope=projectScope;
      req.user.projectId=projectId;
      if(req.userContext){
        req.userContext.projectRole=projectRole;
        req.userContext.projectScope=projectScope;
        req.userContext.projectId=projectId;
        req.userContext.permission=permission;
        req.userContext.docControllerOrgWideDownload=
          !isGuest && user.docControllerOrgWideDownload===true;
      }
      return true;
    }catch(error){
      // G02-015: an independent, rate-capped, redacted post-denial event.
      // Telemetry errors are swallowed by its writer: never permit the action.
      const code=(error as any)?.getResponse?.()?.code;
      const reasonCode=typeof code==='string' &&
        /^[A-Z_]{3,64}$/.test(code) ? code : 'PERMISSION_DENIED';
      if(user?.userId && user?.orgId &&
         (error instanceof ForbiddenException || error instanceof NotFoundException ||
          error instanceof UnprocessableEntityException)){
        await recordDeniedAuthenticationEvent(this.pool,'AUTHORIZATION_DENIED',{
          userId:user.userId,orgId:user.orgId,
          sessionId:req.auth?.sessionId,
          reasonCode,sourceIp:req.ip,
          subject:permission,
        });
      }
      throw error;
    }
  }
}
