import { Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { withTenantTransaction, TenantActorContext, assertValidMemberProjectScope } from '@tradecloseout/db/tenant-tx';
import { hasPermission } from '@tradecloseout/shared';

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
    const projectRead = hasPermission({ orgRole: ctx.orgRole, projectRole: ctx.projectRole }, 'project.read');
    if (!projectRead.allowed) {
      throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Organisation or project not found.' });
    }

    const isScoped = projectRead.scope === 'S';
    const limit = Math.min(Math.max(query.limit || 50, 1), 100);
    const offset = Math.max(query.offset || 0, 0);

    return withTenantTransaction(this.pool, ctx, async (client) => {
      const scopeClause = isScoped
        ? `AND EXISTS (SELECT 1 FROM project_members pm
                        WHERE pm.org_id = p.org_id AND pm.project_id = p.id
                          AND pm.user_id = $2 AND pm.status = 'ACTIVE')`
        : '';

      const queryParams: any[] = isScoped ? [ctx.orgId, ctx.userId] : [ctx.orgId];
      let paramIdx = queryParams.length + 1;

      let projectFilterClause = '';
      if (query.projectId) {
        projectFilterClause = `AND p.id = $${paramIdx}`;
        queryParams.push(query.projectId);
        paramIdx++;
      }

      // Work-item projections must not bypass the same defect authority
      // enforced by scoped defect reads. A project.read permission alone does
      // not grant visibility of arbitrary contractor defect assignments.
      const canManageDefects = hasPermission({
        orgRole: ctx.orgRole, projectRole: ctx.projectRole,
      }, 'defect.manage').allowed;
      const unrestrictedDefects = ctx.orgRole === 'R-OWNER' ||
        ctx.orgRole === 'R-ADMIN' || ctx.actorType === 'SYSTEM';
      if (!unrestrictedDefects) {
        try { assertValidMemberProjectScope(ctx.projectScope); }
        catch { throw new NotFoundException({ code: 'DEFECT_WORK_SCOPE_INVALID' }); }
      }
      const scope = unrestrictedDefects ? undefined : ctx.projectScope;
      let defectVisibility = canManageDefects ? '' : 'AND false';
      if (!unrestrictedDefects &&
          ['R-SITE','R-SUBCONTRACTOR'].includes(ctx.projectRole || '')) {
        defectVisibility += isScoped ? ' AND d.assigned_user_id = $2' : ' AND false';
      }
      if (scope?.assetIds !== undefined) {
        defectVisibility += ` AND d.asset_id = ANY(${paramIdx}::uuid[])`;
        queryParams.push(scope.assetIds);
        paramIdx++;
      }
      if (scope?.assetCategories !== undefined) {
        defectVisibility += ` AND EXISTS (
          SELECT 1 FROM assets da WHERE da.org_id = d.org_id
            AND da.project_id = d.project_id AND da.id = d.asset_id
            AND da.category_key = ANY(${paramIdx}::text[])
        )`;
        queryParams.push(scope.assetCategories);
        paramIdx++;
      }
      if (scope?.startDate !== undefined) {
        defectVisibility += ` AND d.raised_at::date >= ${paramIdx}::date`;
        queryParams.push(scope.startDate);
        paramIdx++;
      }
      if (scope?.endDate !== undefined) {
        defectVisibility += ` AND d.raised_at::date <= ${paramIdx}::date`;
        queryParams.push(scope.endDate);
        paramIdx++;
      }

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
               CASE
                 WHEN d.severity = 'CRITICAL' THEN 'CRITICAL'
                 WHEN d.due_at IS NOT NULL AND d.due_at < now()
                      AND d.status IN ('OPEN','IN_PROGRESS')
                      AND d.severity = 'HIGH' THEN 'CRITICAL'
                 WHEN d.severity IN ('HIGH','MAJOR') THEN 'HIGH'
                 WHEN d.severity = 'MEDIUM' THEN 'MEDIUM'
                 ELSE 'LOW' END AS priority,
               CASE WHEN d.status = 'RECTIFIED'
                    THEN 'Awaiting qualified independent remedy decision'
                    WHEN d.assigned_user_id IS NULL AND d.assigned_party_id IS NULL
                    THEN 'Awaiting project supervisor assignment'
                    WHEN d.due_at IS NOT NULL AND d.due_at < now()
                    THEN 'Assigned remedy overdue; escalation required'
                    ELSE 'Awaiting assigned remedy submission' END AS waiting_on,
               'DEFECT' AS entity_type,
               CASE WHEN d.status = 'RECTIFIED'
                    THEN '/api/v1/projects/' || p.id || '/defects/' || d.id || '/close'
                    WHEN d.assigned_user_id IS NULL AND d.assigned_party_id IS NULL
                    THEN '/api/v1/projects/' || p.id || '/defects/' || d.id || '/assign'
                    ELSE '/api/v1/projects/' || p.id || '/defects/' || d.id || '/remedy' END AS next_path,
               'POST' AS next_method,
               CASE WHEN d.status = 'RECTIFIED' THEN 'VERIFY_CLOSE'
                    WHEN d.assigned_user_id IS NULL AND d.assigned_party_id IS NULL THEN 'ASSIGN_DEFECT'
                    ELSE 'SUBMIT_REMEDY' END AS next_action
          FROM defects d
          JOIN projects p ON p.id = d.project_id AND p.org_id = d.org_id
         WHERE d.org_id = $1
           AND d.status IN ('OPEN', 'IN_PROGRESS', 'RECTIFIED')
           ${defectVisibility}
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
