import { PoolClient } from 'pg';

/**
 * G02-002/009: a prior HTTP guard is not authority for a later mutation.
 * Lock the LIVE member or guest grant in the same transaction as the protected
 * operation. Role and scope narrowing after the guard must reject, not allow
 * a stale permission snapshot to write. All SQL runs under restricted tc_app
 * and the caller's transaction-local app.current_org RLS context.
 *
 * The only org-wide project exception is a current Owner/Admin or explicitly
 * enabled document controller download (not write), per the policy owner.
 */
export type ProjectAuthorityContext = {
  orgId: string;
  userId: string;
  actorType: 'MEMBER'|'USER'|'GUEST'|'SYSTEM'|'ADMIN';
  projectId?: string;
  orgRole?: string;
  projectRole?: string;
  projectScope?: Record<string, unknown>;
  guestGrantId?: string;
  guestScope?: Record<string, unknown>;
  permission?: string;
  docControllerOrgWideDownload?: boolean;
};

export async function assertCurrentProjectAuthority(
  client: PoolClient, ctx: ProjectAuthorityContext,
): Promise<void> {
  if (!ctx.projectId || ctx.actorType === 'SYSTEM') return;
  if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
    if (!ctx.guestGrantId) throw new Error('G02_GUEST_GRANT_REQUIRED');
    const { rows } = await client.query(
      `SELECT scope_json FROM guest_grants
         WHERE org_id=$1 AND id=$2 AND project_id=$3
           AND principal_user_id=$4 AND status='ACTIVE' AND expires_at>now()
         FOR SHARE`,
      [ctx.orgId,ctx.guestGrantId,ctx.projectId,ctx.userId],
    );
    if (!rows.length) throw new Error('G02_GUEST_AUTHORITY_CHANGED');
    if (ctx.guestScope &&
        JSON.stringify(rows[0].scope_json) !== JSON.stringify(ctx.guestScope)) {
      throw new Error('G02_GUEST_SCOPE_CHANGED');
    }
    return;
  }
  if (ctx.orgRole === 'R-OWNER' || ctx.orgRole === 'R-ADMIN') return;
  if (ctx.orgRole === 'R-DOC' && ctx.permission === 'document.download' &&
      ctx.docControllerOrgWideDownload === true) return;
  const { rows } = await client.query(
    `SELECT role,scope_json FROM project_members
       WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE'
       FOR SHARE`,
    [ctx.orgId,ctx.projectId,ctx.userId],
  );
  if (!rows.length) throw new Error('G02_PROJECT_AUTHORITY_CHANGED');
  if (ctx.projectRole && rows[0].role !== ctx.projectRole) {
    throw new Error('G02_PROJECT_ROLE_CHANGED');
  }
  if (ctx.projectScope &&
      JSON.stringify(rows[0].scope_json) !== JSON.stringify(ctx.projectScope)) {
    throw new Error('G02_PROJECT_SCOPE_CHANGED');
  }
}

/** Enforce documented narrower member limits at the target-resource boundary. */
export function assertMemberResourceScope(
  ctx: ProjectAuthorityContext,
  kind: 'asset' | 'requirement' | 'document',
  target: {id:string;categoryKey?:string;groupKey?:string;docTypeKey?:string;createdAt?:string},
  write: boolean,
): void {
  if (ctx.actorType === 'GUEST' || ctx.guestGrantId) return;
  const s = ctx.projectScope;
  if (!s || Object.keys(s).length===0 ||
      ctx.orgRole==='R-OWNER'||ctx.orgRole==='R-ADMIN') return;
  const lists:Record<string,string>={
    asset:'assetIds',requirement:'requirementIds',document:'documentIds',
  };
  const ids=s[lists[kind]];
  if (ids !== undefined && (!Array.isArray(ids) || !ids.includes(target.id))) {
    throw new Error('G02_MEMBER_RESOURCE_SCOPE_DENIED');
  }
  if (write && (s.readOnly===true || s.mode==='READ_ONLY')) {
    throw new Error('G02_MEMBER_SCOPE_READ_ONLY');
  }
  const categories=s.assetCategories;
  if (kind==='asset' && categories !== undefined &&
      (!Array.isArray(categories) || !target.categoryKey ||
       !categories.includes(target.categoryKey))) {
    throw new Error('G02_MEMBER_ASSET_CATEGORY_DENIED');
  }
  const groups=s.requirementGroups;
  if (kind==='requirement' && groups !== undefined &&
      (!Array.isArray(groups) || !target.groupKey ||
       !groups.includes(target.groupKey))) {
    throw new Error('G02_MEMBER_REQUIREMENT_GROUP_DENIED');
  }
  const docTypes=s.documentTypes;
  if (kind==='document' && docTypes !== undefined &&
      (!Array.isArray(docTypes) || !target.docTypeKey ||
       !docTypes.includes(target.docTypeKey))) {
    throw new Error('G02_MEMBER_DOCUMENT_TYPE_DENIED');
  }
  if (target.createdAt && (
    (typeof s.startDate==='string' && target.createdAt < s.startDate) ||
    (typeof s.endDate==='string' && target.createdAt > s.endDate)
  )) throw new Error('G02_MEMBER_DATE_SCOPE_DENIED');
}
