import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { hasPermission } from '@tradecloseout/shared';
import { TenantActorContext } from '@tradecloseout/db';

export type AssetScope = { readOnly?: boolean; mode?: 'READ_ONLY' | 'READ_WRITE'; assetIds?: string[]; categoryKeys?: string[]; startDate?: string; endDate?: string };
export type AssetAuthority = { orgRole: string; projectRole?: string; scope: AssetScope };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => { throw new ForbiddenException({ code: 'ASSET_AUTHORITY_CHANGED' }); };

export function parseAssetScope(raw: unknown): AssetScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return deny();
  const scope = raw as Record<string, unknown>;
  for (const [key,value] of Object.entries(scope)) {
    if (!['readOnly','mode','assetIds','categoryKeys','startDate','endDate'].includes(key)) return deny();
    if (key==='readOnly' && typeof value!=='boolean') return deny();
    if (key==='mode' && value!=='READ_ONLY' && value!=='READ_WRITE') return deny();
    if (key==='assetIds' || key==='categoryKeys') {
      if (!Array.isArray(value) || value.length>1000 || new Set(value).size!==value.length ||
          value.some(v=>typeof v!=='string' || !(key==='assetIds' ? uuid.test(v) : /^[A-Za-z0-9_.:-]{1,80}$/.test(v)))) return deny();
    }
    if (key==='startDate' || key==='endDate') {
      if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) return deny();
    }
  }
  if (typeof scope.startDate==='string' && typeof scope.endDate==='string' && scope.startDate>scope.endDate) return deny();
  return scope as AssetScope;
}

/** Always called inside the tenant transaction, before locking dependent asset rows. */
export async function assetProjectAuthority(client: PoolClient, ctx: TenantActorContext, projectId: string, write: boolean): Promise<AssetAuthority> {
  if (ctx.actorType==='GUEST' || ctx.guestGrantId || !ctx.orgId || !ctx.userId) return deny();
  const {rows:members}=await client.query(
    `SELECT m.role AS org_role FROM users u JOIN memberships m ON m.user_id=u.id
     JOIN organisations o ON o.id=m.org_id WHERE u.id=$1 AND m.org_id=$2
       AND u.status='ACTIVE' AND m.status='ACTIVE' AND o.status='ACTIVE' FOR SHARE OF u,m,o`,[ctx.userId,ctx.orgId]);
  if (members.length!==1) return deny();
  const {rows:projects}=await client.query(
    `SELECT status FROM projects WHERE org_id=$1 AND id=$2 ${write ? 'FOR UPDATE' : 'FOR SHARE'}`,[ctx.orgId,projectId]);
  if (projects.length!==1 || (write ? !['ACTIVE','HANDOVER'].includes(projects[0].status) : projects[0].status==='CANCELLED')) return deny();
  const orgRole: string=members[0].org_role;
  let projectRole: string | undefined; let scope: AssetScope={};
  if (!['R-OWNER','R-ADMIN'].includes(orgRole)) {
    const {rows}=await client.query(`SELECT role,scope_json FROM project_members
      WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,ctx.userId]);
    if (rows.length>1) return deny();
    if (rows.length===1) {
      projectRole=rows[0].role;scope=parseAssetScope(rows[0].scope_json);
    } else {
      // Preserve existing explicit organisation-wide grants. Removing a
      // project assignment revokes S authority, not an independent A/Y grant.
      const grant=hasPermission({orgRole},write?'asset.manage':'asset.read');
      if (!grant.allowed || !['A','Y'].includes(grant.scope)) return deny();
    }
  }
  if (write && (scope.readOnly || scope.mode==='READ_ONLY')) return deny();
  if (!hasPermission({orgRole,projectRole},write?'asset.manage':'asset.read').allowed) return deny();
  return {orgRole,projectRole,scope};
}

/** Predicates apply before list/count/export materialisation; empty scopes return no rows. */
export function assetScopeSql(scope: AssetScope, params: unknown[]): string {
  let sql='';
  if (scope.assetIds) {params.push(scope.assetIds);sql+=` AND id=ANY($${params.length}::uuid[])`;}
  if (scope.categoryKeys) {params.push(scope.categoryKeys);sql+=` AND category_key=ANY($${params.length}::text[])`;}
  if (scope.startDate) {params.push(scope.startDate);sql+=` AND (created_at AT TIME ZONE 'UTC')::date >= $${params.length}::date`;}
  if (scope.endDate) {params.push(scope.endDate);sql+=` AND (created_at AT TIME ZONE 'UTC')::date <= $${params.length}::date`;}
  return sql;
}

export async function assetResourceAuthority(client: PoolClient, ctx: TenantActorContext, projectId: string, assetId: string, write: boolean, authority?: AssetAuthority) {
  const auth=authority??await assetProjectAuthority(client,ctx,projectId,write);
  const params: unknown[]=[ctx.orgId,projectId,assetId];
  const {rows}=await client.query(`SELECT id,category_key,created_at FROM assets
    WHERE org_id=$1 AND project_id=$2 AND id=$3 AND deleted_at IS NULL${assetScopeSql(auth.scope,params)} ${write?'FOR UPDATE':'FOR SHARE'}`,params);
  if (rows.length!==1) throw new NotFoundException({code:'ASSET_NOT_FOUND'});
  return auth;
}

export function assertAssetCreationScope(scope: AssetScope, category: string): void {
  const day=new Date().toISOString().slice(0,10);
  if (scope.assetIds || (scope.categoryKeys && !scope.categoryKeys.includes(category)) ||
      (scope.startDate && day<scope.startDate) || (scope.endDate && day>scope.endDate)) return deny();
}
