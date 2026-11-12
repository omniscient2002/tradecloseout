import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { hasPermission } from '@tradecloseout/shared';
import { validateAssetProjectScope } from '../assets/asset-scope';

export interface WorkItem {
  id: string;
  type:
    | 'REVIEW_PENDING'
    | 'WAIVER_PENDING_COUNTERSIGN'
    | 'DEFECT_ACTION'
    | 'EVIDENCE_REVALIDATION_DUE'
    | 'SUPPLIER_OBLIGATION_PENDING';
  title: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  projectId: string;
  projectCode: string;
  projectName: string;
  entityType: string;
  entityId: string;
  entityVersion?: number;
  dueAt?: string | null;
  waitingOn: string;
  nextCommand: {
    method: 'POST' | 'PATCH';
    path: string;
    actionName: string;
  };
  createdAt: string;
}

export interface WorkItemsQuery {
  projectId?: string;
  type?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class WorkItemsService {
  constructor(private readonly pool: Pool) {}

  async listWorkItems(ctx: TenantActorContext, query: WorkItemsQuery = {}) {
    // A work queue advertises actions, not a guest-visible activity feed.
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new NotFoundException('WORK_QUEUE_UNAVAILABLE');
    }
    const validTypes = new Set([
      'REVIEW_PENDING', 'WAIVER_PENDING_COUNTERSIGN', 'DEFECT_ACTION',
      'EVIDENCE_REVALIDATION_DUE', 'SUPPLIER_OBLIGATION_PENDING',
    ]);
    const validPriorities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((query.projectId && !validUuid.test(query.projectId)) ||
        (query.type && !validTypes.has(query.type)) ||
        (query.priority && !validPriorities.has(query.priority)) ||
        (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)) ||
        (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) {
      throw new BadRequestException('INVALID_WORK_QUEUE_FILTER');
    }
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return withTenantTransaction(this.pool, ctx, async (client) => {
      // The session roles may be stale; use the current DB membership.
      const { rows: activeOrgMembers } = await client.query(
        `SELECT role FROM memberships
          WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      if (!activeOrgMembers.length) throw new NotFoundException('WORK_QUEUE_UNAVAILABLE');
      const orgRole = activeOrgMembers[0].role as string;
      const { rows: memberRows } = await client.query(
        `SELECT project_id, role, scope_json FROM project_members
          WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      const memberByProject = new Map<string, { role: string; scope: Record<string, unknown> }>();
      for (const member of memberRows) {
        memberByProject.set(member.project_id, {
          role: member.role, scope: validateAssetProjectScope(member.scope_json),
        });
      }
      const { rows: projectRows } = await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND purged_at IS NULL
          AND status = 'ACTIVE' AND ($2::uuid IS NULL OR id = $2::uuid)`,
        [ctx.orgId, query.projectId ?? null],
      );
      const owner = orgRole === 'R-OWNER' || orgRole === 'R-ADMIN';
      const permissions = (projectRole: string | undefined, permission: string) =>
        hasPermission({ orgRole, projectRole }, permission).allowed;
      const accessRows: Array<Record<string, unknown>> = [];
      for (const project of projectRows) {
        const member = memberByProject.get(project.id);
        const projectRole = member?.role;
        const projectRead = hasPermission({ orgRole, projectRole }, 'project.read');
        if (!projectRead.allowed || (projectRead.scope === 'S' && !member)) continue;
        const scope = owner ? {} : member?.scope ?? {};
        if (scope.readOnly === true || scope.mode === 'READ_ONLY') continue;
        const canIntake = permissions(projectRole, 'party.manage') &&
          (owner || (['R-PM', 'R-PROC', 'R-DOC'].includes(orgRole) &&
            member && ['R-PM', 'R-PROC', 'R-DOC'].includes(member.role)));
        const row = {
          project_id: project.id, scope,
          can_review: permissions(projectRole, 'review.decide'),
          can_waiver: permissions(projectRole, 'requirement.waive_second'),
          can_defect: permissions(projectRole, 'defect.manage') &&
            permissions(projectRole, 'document.upload'),
          can_revalidate: permissions(projectRole, 'asset.manage'),
          can_intake: Boolean(canIntake),
        };
        if (row.can_review || row.can_waiver || row.can_defect ||
            row.can_revalidate || row.can_intake) accessRows.push(row);
      }
      // Counts and paged items come from the same filtered MVCC statement.
      const queryParams = [
        ctx.orgId, ctx.userId, JSON.stringify(accessRows),
        query.projectId ?? null, query.type ?? null, query.priority ?? null,
        limit, offset,
      ];
      const scopeClause = `AND p.status = 'ACTIVE' AND p.purged_at IS NULL`;
      const projectFilterClause = `AND ($4::uuid IS NULL OR p.id = $4::uuid)`;
      const assetVisible = (alias: string): string => `
        AND (NOT (ap.scope ? 'assetIds') OR
             (${alias.id IS NOT NULL AND (ap.scope->'assetIds' ? ${alias.id::text)))
        AND (NOT (ap.scope ? 'assetCategories') OR
             (${alias.id IS NOT NULL AND (ap.scope->'assetCategories' ? ${alias.category_key)))
        AND (NOT (ap.scope ? 'startDate') OR
             (${alias.id IS NOT NULL AND ${alias.created_at::date >= (ap.scope->>'startDate')::date))
        AND (NOT (ap.scope ? 'endDate') OR
             (${alias.id IS NOT NULL AND ${alias.created_at::date <= (ap.scope->>'endDate')::date))
      `;
      const requirementVisible = (alias: string): string => `
        AND (NOT (ap.scope ? 'requirementIds') OR (ap.scope->'requirementIds' ? ${alias.id::text))
        AND (NOT (ap.scope ? 'requirementGroups') OR (ap.scope->'requirementGroups' ? ${alias.group_key))
        AND (NOT (ap.scope ? 'documentTypes') OR (ap.scope->'documentTypes' ? ${alias.doc_type_key))
      `;
      const documentVisible = `
        AND (NOT (ap.scope ? 'documentIds') OR (ap.scope->'documentIds' ? d.id::text))
        AND (NOT (ap.scope ? 'documentTypes') OR (ap.scope->'documentTypes' ? d.doc_type_key))
        AND (NOT (ap.scope ? 'requirementIds') OR
          (EXISTS (
            SELECT 1 FROM document_requirements dr
             WHERE dr.org_id = d.org_id AND dr.project_id = d.project_id
               AND dr.document_id = d.id
               AND ap.scope->'requirementIds' ? dr.requirement_id::text
          ) AND NOT EXISTS (
            SELECT 1 FROM document_requirements dr
             WHERE dr.org_id = d.org_id AND dr.project_id = d.project_id
               AND dr.document_id = d.id
               AND NOT (ap.scope->'requirementIds' ? dr.requirement_id::text)
          )))
        AND (NOT (ap.scope ? 'assetIds' OR ap.scope ? 'assetCategories' OR
                  ap.scope ? 'startDate' OR ap.scope ? 'endDate') OR
          (EXISTS (
            SELECT 1 FROM document_assets da
             WHERE da.org_id = d.org_id AND da.project_id = d.project_id
               AND da.document_id = d.id
          ) AND NOT EXISTS (
            SELECT 1 FROM document_assets da
            LEFT JOIN assets la ON la.org_id = da.org_id
              AND la.project_id = da.project_id AND la.id = da.asset_id
              AND la.deleted_at IS NULL
             WHERE da.org_id = d.org_id AND da.project_id = d.project_id
               AND da.document_id = d.id
               AND NOT (true ${assetVisible('la'))
          )))
      `;
      // 1. Pending Submittal Reviews
      const reviewsSql = `
        SELECT dv.id AS entity_id,
               COALESCE(dv.row_version, 1) AS entity_version,
               d.title AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               dv.created_at AS created_at,
               'REVIEW_PENDING' AS type,
               'HIGH' AS priority,
               'Awaiting submittal review decision' AS waiting_on,
               'DOCUMENT_VERSION' AS entity_type,
               '/api/v1/projects/' || p.id || '/document-versions/' || dv.id || '/decision' AS next_path,
               'POST' AS next_method,
               'DECIDE_REVIEW' AS next_action
          FROM document_versions dv
          JOIN documents d ON d.id = dv.document_id AND d.org_id = dv.org_id
          JOIN projects p ON p.id = dv.project_id AND p.org_id = dv.org_id
         WHERE dv.org_id = $1
           AND dv.file_status = 'READY'
           AND dv.review_status = 'IN_REVIEW'
           AND dv.deleted_at IS NULL
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 2. Pending Mandatory Waivers needing Countersign
      const waiversSql = `
        SELECT w.id AS entity_id,
               1 AS entity_version,
               COALESCE(w.reason, 'Mandatory requirement waiver pending PMC countersignature') AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               w.created_at AS created_at,
               'WAIVER_PENDING_COUNTERSIGN' AS type,
               'CRITICAL' AS priority,
               'Awaiting PMC second approval / countersign' AS waiting_on,
               'WAIVER' AS entity_type,
               '/api/v1/projects/' || p.id || '/checklists/waivers/' || w.id || '/countersign' AS next_path,
               'POST' AS next_method,
               'COUNTERSIGN_WAIVER' AS next_action
          FROM waivers w
          JOIN requirements r ON r.id = w.requirement_id AND r.org_id = w.org_id
          JOIN projects p ON p.id = w.project_id AND p.org_id = w.org_id
         WHERE w.org_id = $1
           AND w.status IN ('PENDING', 'PENDING_SECOND_APPROVAL')
           AND r.mandatory = true
           AND w.second_approved_by IS NULL
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 3. Open or Rectified Defects
      const defectsSql = `
        SELECT d.id AS entity_id,
               d.row_version AS entity_version,
               d.title AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               d.raised_at AS created_at,
               'DEFECT_ACTION' AS type,
               CASE WHEN d.severity IN ('CRITICAL', 'HIGH') THEN 'CRITICAL'
                    WHEN d.severity = 'MAJOR' THEN 'HIGH'
                    ELSE 'MEDIUM' END AS priority,
               CASE WHEN d.status = 'OPEN' THEN 'Awaiting defect remedy submission'
                    ELSE 'Awaiting independent closure verification' END AS waiting_on,
               'DEFECT' AS entity_type,
               CASE WHEN d.status = 'OPEN'
                    THEN '/api/v1/projects/' || p.id || '/defects/' || d.id || '/remedy'
                    ELSE '/api/v1/projects/' || p.id || '/defects/' || d.id || '/close' END AS next_path,
               'POST' AS next_method,
               CASE WHEN d.status = 'OPEN' THEN 'SUBMIT_REMEDY' ELSE 'VERIFY_CLOSE' END AS next_action
          FROM defects d
          JOIN projects p ON p.id = d.project_id AND p.org_id = d.org_id
         WHERE d.org_id = $1
           AND d.status IN ('OPEN', 'RECTIFIED')
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 4. Pending Evidence Revalidations
      const revalidationsSql = `
        SELECT er.id AS entity_id,
               er.row_version AS entity_version,
               'Field revalidation required for ' || a.tag || ' (' || a.name || ')' AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               er.created_at AS created_at,
               'EVIDENCE_REVALIDATION_DUE' AS type,
               'HIGH' AS priority,
               'Awaiting field serial verification' AS waiting_on,
               'EVIDENCE_REVALIDATION' AS entity_type,
               '/api/v1/projects/' || p.id || '/assets/' || a.id || '/revalidations/' || er.id AS next_path,
               'PATCH' AS next_method,
               'CONFIRM_REVALIDATION' AS next_action
          FROM evidence_revalidations er
          JOIN assets a ON a.id = er.asset_id AND a.org_id = er.org_id
          JOIN projects p ON p.id = er.project_id AND p.org_id = er.org_id
         WHERE er.org_id = $1
           AND er.status = 'PENDING'
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 5. Supplier Document Obligations Pending Intake
      const obligationsSql = `
        SELECT sdo.id AS entity_id,
               1 AS entity_version,
               sdo.title AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               sdo.created_at AS created_at,
               'SUPPLIER_OBLIGATION_PENDING' AS type,
               'MEDIUM' AS priority,
               'Awaiting contractor intake verification' AS waiting_on,
               'SUPPLIER_DOCUMENT_OBLIGATION' AS entity_type,
               '/api/v1/projects/' || p.id || '/supplier-obligations/' || sdo.id || '/intake' AS next_path,
               'POST' AS next_method,
               'INTAKE_OBLIGATION' AS next_action
          FROM supplier_document_obligations sdo
          JOIN projects p ON p.id = sdo.project_id AND p.org_id = sdo.org_id
         WHERE sdo.org_id = $1
           AND sdo.status = 'UPLOADED'
           ${scopeClause}
           ${projectFilterClause}
      `;

      // Combine with UNION ALL
      const combinedSql = `
        WITH all_items AS (
          ${reviewsSql}
          UNION ALL
          ${waiversSql}
          UNION ALL
          ${defectsSql}
          UNION ALL
          ${revalidationsSql}
          UNION ALL
          ${obligationsSql}
        )
        SELECT * FROM all_items
        ${query.type ? `WHERE type = '${query.type.replace(/'/g, "''")}'` : ''}
        ${query.priority ? `${query.type ? 'AND' : 'WHERE'} priority = '${query.priority.replace(/'/g, "''")}'` : ''}
        ORDER BY
          CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const { rows } = await client.query(combinedSql, queryParams);

      // Compute aggregate counts per domain category
      const countsSql = `
        WITH all_items AS (
          ${reviewsSql}
          UNION ALL
          ${waiversSql}
          UNION ALL
          ${defectsSql}
          UNION ALL
          ${revalidationsSql}
          UNION ALL
          ${obligationsSql}
        )
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE type = 'REVIEW_PENDING') AS reviews,
          COUNT(*) FILTER (WHERE type = 'WAIVER_PENDING_COUNTERSIGN') AS waivers,
          COUNT(*) FILTER (WHERE type = 'DEFECT_ACTION') AS defects,
          COUNT(*) FILTER (WHERE type = 'EVIDENCE_REVALIDATION_DUE') AS revalidations,
          COUNT(*) FILTER (WHERE type = 'SUPPLIER_OBLIGATION_PENDING') AS supplier_obligations
        FROM all_items
      `;
      const { rows: countRows } = await client.query(countsSql, queryParams);
      const c = countRows[0] || {};

      const items: WorkItem[] = rows.map((r: any) => ({
        id: `${r.type.toLowerCase()}:${r.entity_id}`,
        type: r.type,
        title: r.title,
        priority: r.priority,
        projectId: r.project_id,
        projectCode: r.project_code,
        projectName: r.project_name,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityVersion: r.entity_version,
        waitingOn: r.waiting_on,
        nextCommand: {
          method: r.next_method,
          path: r.next_path,
          actionName: r.next_action,
        },
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      }));

      return {
        items,
        counts: {
          total: parseInt(c.total || '0', 10),
          reviews: parseInt(c.reviews || '0', 10),
          waivers: parseInt(c.waivers || '0', 10),
          defects: parseInt(c.defects || '0', 10),
          revalidations: parseInt(c.revalidations || '0', 10),
          supplierObligations: parseInt(c.supplier_obligations || '0', 10),
        },
        pagination: {
          limit,
          offset,
          hasMore: items.length === limit,
        },
      };
    });
  }
}
