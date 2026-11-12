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
    /** Null means the backing command has no row-version precondition. */
    precondition: { field: 'expectedRowVersion'; value: number } | null;
    requiredFields: string[];
    idempotency: 'HEADER_KEY' | 'BODY_COMMAND_ID' | 'NONE';
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
          is_manager: owner || (orgRole === 'R-PM' && projectRole === 'R-PM'),
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
             (${alias}.id IS NOT NULL AND (ap.scope->'assetIds' ? ${alias}.id::text)))
        AND (NOT (ap.scope ? 'assetCategories') OR
             (${alias}.id IS NOT NULL AND (ap.scope->'assetCategories' ? ${alias}.category_key)))
        AND (NOT (ap.scope ? 'startDate') OR
             (${alias}.id IS NOT NULL AND ${alias}.created_at::date >= (ap.scope->>'startDate')::date))
        AND (NOT (ap.scope ? 'endDate') OR
             (${alias}.id IS NOT NULL AND ${alias}.created_at::date <= (ap.scope->>'endDate')::date))
      `;
      const requirementVisible = (alias: string): string => `
        AND (NOT (ap.scope ? 'requirementIds') OR (ap.scope->'requirementIds' ? ${alias}.id::text))
        AND (NOT (ap.scope ? 'requirementGroups') OR (ap.scope->'requirementGroups' ? ${alias}.group_key))
        AND (NOT (ap.scope ? 'documentTypes') OR (ap.scope->'documentTypes' ? ${alias}.doc_type_key))
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
               AND NOT (true ${assetVisible('la')})
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
               rv.due_at AS due_at,
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
          JOIN access ap ON ap.project_id = p.id AND ap.can_review
          JOIN reviews rv ON rv.org_id = dv.org_id AND rv.project_id = dv.project_id
            AND rv.document_version_id = dv.id AND rv.reviewer_subject_type = 'USER'
            AND rv.reviewer_subject_id = $2 AND (rv.reviewer_user_id IS NULL OR rv.reviewer_user_id = $2)
            AND rv.status IN ('PENDING','IN_REVIEW')
         WHERE dv.org_id = $1
           AND dv.file_status = 'READY'
           AND dv.review_status = 'IN_REVIEW'
           AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
           AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
           ${documentVisible}
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 2. Pending Mandatory Waivers needing Countersign
      const waiversSql = `
        SELECT w.id AS entity_id,
               NULL::integer AS entity_version,
               COALESCE(w.reason, 'Mandatory requirement waiver pending PMC countersignature') AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               w.created_at AS created_at,
               r.due_at AS due_at,
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
          JOIN access ap ON ap.project_id = p.id AND ap.can_waiver
          LEFT JOIN assets a ON a.org_id = r.org_id AND a.project_id = r.project_id
            AND a.id = r.asset_id AND a.deleted_at IS NULL
         WHERE w.org_id = $1
           AND w.status = 'PENDING_SECOND_APPROVAL'
           AND w.approved_by <> $2 AND w.requested_by <> $2
           AND r.mandatory = true
           AND w.second_approved_by IS NULL AND r.superseded_at IS NULL
           ${requirementVisible('r')}
           ${assetVisible('a')}
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
               d.due_at AS due_at,
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
          JOIN access ap ON ap.project_id = p.id AND ap.can_defect
          LEFT JOIN assets a ON a.org_id = d.org_id AND a.project_id = d.project_id
            AND a.id = d.asset_id AND a.deleted_at IS NULL
          LEFT JOIN requirements r ON r.org_id = d.org_id AND r.project_id = d.project_id
            AND r.id = d.requirement_id AND r.superseded_at IS NULL
         WHERE d.org_id = $1
           AND d.status IN ('OPEN', 'RECTIFIED')
           AND (d.status <> 'OPEN' OR d.assigned_user_id = $2 OR ap.is_manager)
           AND (d.status <> 'RECTIFIED' OR
             (d.assigned_user_id IS DISTINCT FROM $2 AND d.remedied_by IS DISTINCT FROM $2))
           AND (NOT (ap.scope ? 'requirementIds') OR
             (r.id IS NOT NULL AND (ap.scope->'requirementIds' ? r.id::text)))
           AND (NOT (ap.scope ? 'requirementGroups') OR
             (r.id IS NOT NULL AND (ap.scope->'requirementGroups' ? r.group_key)))
           AND (NOT (ap.scope ? 'documentTypes') OR
             (r.id IS NOT NULL AND (ap.scope->'documentTypes' ? r.doc_type_key)))
           ${assetVisible('a')}
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
               NULL::timestamptz AS due_at,
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
          JOIN access ap ON ap.project_id = p.id AND ap.can_revalidate
          LEFT JOIN document_versions dv ON dv.org_id = er.org_id
             AND dv.project_id = er.project_id AND dv.id = er.document_version_id
         WHERE er.org_id = $1
           AND er.status = 'PENDING' AND a.deleted_at IS NULL
           AND dv.uploaded_by IS DISTINCT FROM $2
           ${assetVisible('a')}
           ${scopeClause}
           ${projectFilterClause}
      `;

      // 5. Supplier Document Obligations Pending Intake
      const obligationsSql = `
        SELECT sdo.id AS entity_id,
               sdo.row_version AS entity_version,
               sdo.title AS title,
               p.id AS project_id,
               p.code AS project_code,
               p.name AS project_name,
               sdo.created_at AS created_at,
               sdo.due_date::timestamptz AS due_at,
               'SUPPLIER_OBLIGATION_PENDING' AS type,
               'MEDIUM' AS priority,
               'Awaiting contractor intake verification' AS waiting_on,
               'SUPPLIER_DOCUMENT_OBLIGATION' AS entity_type,
               '/api/v1/projects/' || p.id || '/supplier-obligations/' || sdo.id || '/intake' AS next_path,
               'POST' AS next_method,
               'INTAKE_OBLIGATION' AS next_action
          FROM supplier_document_obligations sdo
          JOIN projects p ON p.id = sdo.project_id AND p.org_id = sdo.org_id
          JOIN access ap ON ap.project_id = p.id AND ap.can_intake
          JOIN procurement_order_lines pol ON pol.org_id = sdo.org_id
            AND pol.project_id = sdo.project_id AND pol.id = sdo.po_line_id
          LEFT JOIN assets a ON a.org_id = pol.org_id AND a.project_id = pol.project_id
            AND a.id = pol.asset_id AND a.deleted_at IS NULL
          LEFT JOIN requirements r ON r.org_id = sdo.org_id AND r.project_id = sdo.project_id
            AND r.id = sdo.requirement_id AND r.superseded_at IS NULL
         WHERE sdo.org_id = $1
           AND sdo.status = 'UPLOADED'
           AND (NOT (ap.scope ? 'requirementIds') OR
             (r.id IS NOT NULL AND (ap.scope->'requirementIds' ? r.id::text)))
           AND (NOT (ap.scope ? 'requirementGroups') OR
             (r.id IS NOT NULL AND (ap.scope->'requirementGroups' ? r.group_key)))
           AND (NOT (ap.scope ? 'documentTypes') OR
             (ap.scope->'documentTypes' ? sdo.doc_type_key))
           ${assetVisible('a')}
           ${scopeClause}
           ${projectFilterClause}
      `;

      // Scope, filter, page and count on ONE PostgreSQL snapshot. No counts
      // can reveal a resource absent from this actor's actionable queue.
      const combinedSql = `
        WITH access AS (
          SELECT x.project_id, x.scope, x.can_review, x.can_waiver,
                 x.can_defect, x.can_revalidate, x.can_intake, x.is_manager
            FROM jsonb_to_recordset($3::jsonb) AS x(
              project_id uuid, scope jsonb,
              can_review boolean, can_waiver boolean, can_defect boolean,
              can_revalidate boolean, can_intake boolean, is_manager boolean
            )
        ),
        all_items AS (
          ${reviewsSql}
          UNION ALL
          ${waiversSql}
          UNION ALL
          ${defectsSql}
          UNION ALL
          ${revalidationsSql}
          UNION ALL
          ${obligationsSql}
        ),
        visible AS MATERIALIZED (
          SELECT * FROM all_items
           WHERE ($5::text IS NULL OR type = $5::text)
             AND ($6::text IS NULL OR priority = $6::text)
        ),
        totals AS (
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE type = 'REVIEW_PENDING') AS reviews,
            COUNT(*) FILTER (WHERE type = 'WAIVER_PENDING_COUNTERSIGN') AS waivers,
            COUNT(*) FILTER (WHERE type = 'DEFECT_ACTION') AS defects,
            COUNT(*) FILTER (WHERE type = 'EVIDENCE_REVALIDATION_DUE') AS revalidations,
            COUNT(*) FILTER (WHERE type = 'SUPPLIER_OBLIGATION_PENDING') AS supplier_obligations
          FROM visible
        )
        SELECT totals.*,
          COALESCE((
            SELECT jsonb_agg(to_jsonb(page))
              FROM (
                SELECT * FROM visible
                 ORDER BY CASE priority
                   WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
                   WHEN 'MEDIUM' THEN 3 ELSE 4 END,
                   created_at DESC, entity_id DESC
                 LIMIT $7::integer OFFSET $8::integer
              ) page
          ), '[]'::jsonb) AS items
        FROM totals
      `;
      const { rows: resultRows } = await client.query(combinedSql, queryParams);
      const c = resultRows[0] || {};
      const itemRows: any[] = Array.isArray(c.items) ? c.items : [];
      const items: WorkItem[] = itemRows.map((r: any) => ({
        id: `${r.type.toLowerCase()}:${r.entity_id}`,
        type: r.type,
        title: r.title,
        priority: r.priority,
        projectId: r.project_id,
        projectCode: r.project_code,
        projectName: r.project_name,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityVersion: r.entity_version ?? undefined,
        dueAt: r.due_at ?? null,
        waitingOn: r.waiting_on,
        nextCommand: {
          method: r.next_method,
          path: r.next_path,
          actionName: r.next_action,
          precondition:
            r.entity_version == null || r.next_action === 'COUNTERSIGN_WAIVER'
              ? null
              : { field: 'expectedRowVersion', value: r.entity_version },
          requiredFields: ({
            DECIDE_REVIEW: ['decision', 'expectedRowVersion'],
            COUNTERSIGN_WAIVER: [],
            SUBMIT_REMEDY: ['remedyEvidenceObjectId', 'expectedRowVersion'],
            VERIFY_CLOSE: ['closureEvidenceObjectId', 'expectedRowVersion'],
            CONFIRM_REVALIDATION: ['status', 'expectedRowVersion'],
            INTAKE_OBLIGATION: ['decision', 'documentVersionId'],
          } as Record<string, string[]>)[r.next_action] ?? [],
          idempotency: r.next_action === 'DECIDE_REVIEW' ? 'HEADER_KEY'
            : r.next_action === 'INTAKE_OBLIGATION' ? 'BODY_COMMAND_ID' : 'NONE',
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
          hasMore: offset + items.length < parseInt(c.total || '0', 10),
        },
      };
    });
  }
}
