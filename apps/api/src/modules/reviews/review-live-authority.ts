import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hasPermission } from '@tradecloseout/shared';
import type { ExecutionContext } from '../../database/tenant-db.service';

type ReviewMemberScope = {
  readOnly?: boolean;
  mode?: 'READ_ONLY' | 'READ_WRITE';
  documentIds?: string[];
  documentTypes?: string[];
  requirementIds?: string[];
  startDate?: string;
  endDate?: string;
};

export type LiveReviewAuthority = {
  orgRole: string;
  projectRole?: string;
  scope: ReviewMemberScope;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied = (): never => { throw new ForbiddenException('REVIEW_AUTHORITY_CHANGED'); };

function validateScope(raw: unknown): ReviewMemberScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return denied();
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['readOnly', 'mode', 'documentIds', 'documentTypes', 'requirementIds', 'startDate', 'endDate']);
  for (const [key, value] of Object.entries(obj)) {
    // Unsupported legacy dimensions must not silently widen access.
    if (!allowed.has(key)) return denied();
    if (key === 'readOnly' && typeof value !== 'boolean') return denied();
    if (key === 'mode' && value !== 'READ_ONLY' && value !== 'READ_WRITE') return denied();
    if (key.endsWith('Ids') && (
      !Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || !uuid.test(item)) ||
      new Set(value).size !== value.length
    )) return denied();
    if (key === 'documentTypes' && (
      !Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(item))
    )) return denied();
    if ((key === 'startDate' || key === 'endDate') && (
      typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value
    )) return denied();
  }
  if (typeof obj.startDate === 'string' && typeof obj.endDate === 'string' && obj.startDate > obj.endDate) return denied();
  return obj as ReviewMemberScope;
}

/**
 * Revalidate current authority using the SAME transaction as the decision.
 * These shared row locks serialise against account, membership, project lifecycle
 * and project-member changes. A stale HTTP guard or saved assignment cannot authorize.
 */
export async function resolveLiveProjectCommandAuthority(
  client: PoolClient,
  ctx: ExecutionContext,
  projectId: string,
  permission: 'review.decide' | 'document.delete' | 'document.read',
): Promise<LiveReviewAuthority> {
  if (ctx.actorType === 'GUEST' || ctx.guestGrantId || !projectId || !ctx.userId || !ctx.orgId) return denied();

  const membership = await client.query(
    `SELECT m.role AS org_role
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN organisations o ON o.id = m.org_id
      WHERE u.id=$1 AND u.status='ACTIVE'
        AND m.org_id=$2 AND m.status='ACTIVE' AND o.status='ACTIVE'
      FOR SHARE OF u,m,o`,
    [ctx.userId, ctx.orgId],
  );
  if (membership.rows.length !== 1) return denied();
  const orgRole: string = membership.rows[0].org_role;

  const project = await client.query(
    `SELECT status FROM projects WHERE org_id=$1 AND id=$2 FOR SHARE`,
    [ctx.orgId, projectId],
  );
  if (project.rows.length !== 1) return denied();
  // Reads of retained evidence remain available in DRAFT/CLOSED/ARCHIVED
  // projects, but cancelled projects do not grant new access. Mutations need
  // an active lifecycle and always respect restrictive member scopes.
  const isRead = permission === 'document.read';
  if (isRead ? project.rows[0].status === 'CANCELLED' :
    !['ACTIVE', 'HANDOVER'].includes(project.rows[0].status)) return denied();

  let projectRole: string | undefined;
  let scope: ReviewMemberScope = {};
  if (orgRole !== 'R-OWNER' && orgRole !== 'R-ADMIN') {
    const projectMember = await client.query(
      `SELECT role, scope_json FROM project_members
        WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,
      [ctx.orgId, projectId, ctx.userId],
    );
    if (projectMember.rows.length !== 1) return denied();
    projectRole = projectMember.rows[0].role;
    scope = validateScope(projectMember.rows[0].scope_json);
    if (!isRead && (scope.readOnly || scope.mode === 'READ_ONLY')) return denied();
  }

  if (!hasPermission({ orgRole, projectRole }, permission).allowed) return denied();
  return { orgRole, projectRole, scope };
}

/** Current review decision authority; retained for the existing decision callsites. */
export async function resolveLiveReviewAuthority(
  client: PoolClient,
  ctx: ExecutionContext,
  projectId: string,
): Promise<LiveReviewAuthority> {
  return resolveLiveProjectCommandAuthority(client, ctx, projectId, 'review.decide');
}

/** Restrict the actual document and linked requirements, not the caller's project ID. */
export async function assertReviewDocumentScope(
  client: PoolClient,
  authority: LiveReviewAuthority,
  ctx: ExecutionContext,
  projectId: string,
  doc: { id: string; doc_type_key?: string | null; category_key?: string | null; created_at?: Date | string | null },
): Promise<void> {
  const { scope } = authority;
  if (scope.documentIds && !scope.documentIds.includes(doc.id)) return denied();
  if (scope.documentTypes && !scope.documentTypes.includes(doc.doc_type_key || doc.category_key || '')) return denied();
  if (scope.startDate || scope.endDate) {
    if (!doc.created_at) return denied();
    const createdAt = new Date(doc.created_at);
    if (Number.isNaN(createdAt.valueOf())) return denied();
    const day = createdAt.toISOString().slice(0, 10);
    if ((scope.startDate && day < scope.startDate) || (scope.endDate && day > scope.endDate)) return denied();
  }
  if (scope.requirementIds) {
    const { rows } = await client.query(
      `SELECT requirement_id FROM document_requirements
        WHERE org_id=$1 AND project_id=$2 AND document_id=$3`,
      [ctx.orgId, projectId, doc.id],
    );
    // Every linked requirement must be explicitly in scope, and at least one
    // linked requirement must exist; an empty scope list means no authority.
    if (!rows.length || rows.some(row => !scope.requirementIds!.includes(row.requirement_id))) return denied();
  }
}
