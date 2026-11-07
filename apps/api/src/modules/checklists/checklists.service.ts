// apps/api/src/modules/checklists/checklists.service.ts
// Checklists, Snapshots, Two-Approver Waivers & Controlled Changes Service (API-050..066, WF-06, WF-20, FR-CHK-004..016, AUD-002, AUD-008)

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  withTenantTransaction,
  TenantActorContext,
  DomainOutboxEvent,
  evaluateCatalogueApplicability,
  ProjectApplicabilityContext,
  DocumentTypeCatalogueEntry,
} from '@tradecloseout/db';
import {
  resolveConfigurationHierarchy,
  ConfigLayerInput,
} from '../configuration/config-resolver';
import { RequirementStatus, WaiverStatus } from '@tradecloseout/shared';

export interface ResolvedRequirementSpec {
  key: string;
  groupKey: string;
  title: string;
  description?: string;
  docTypeKey: string;
  mandatory: boolean;
  scopeType: 'PROJECT' | 'ASSET_CATEGORY';
  assetCategoryKey?: string;
  reviewerRole?: string;
  dueOffsetDays?: number;
  validityRule?: Record<string, unknown>;
}

@Injectable()
export class ChecklistsService {
  constructor(private readonly pool: Pool) {}

  /**
   * API-056: POST /api/v1/projects/:id/checklist/snapshots
   * Resolves L0..L4 configuration, creates an immutable checklist_snapshots row,
   * and instantiates project-level and per-asset requirement rows (WF-06, AUD-002, AUD-008).
   */
  async createAndApplySnapshot(
    ctx: TenantActorContext,
    projectId: string,
    layers: ConfigLayerInput[],
    changeRequestId?: string,
    changeReason = 'Initial project checklist snapshot',
  ) {
    const resolved = resolveConfigurationHierarchy(layers);
    if (resolved.conflicts.length > 0) {
      throw new UnprocessableEntityException({
        code: 'RULE_CONFLICT',
        title: 'Configuration conflict detected',
        detail: resolved.conflicts[0]!.message,
        fieldErrors: resolved.conflicts.map((c) => ({ field: c.path, message: c.message })),
      });
    }

    const reqSpecs = (resolved.payload.requirements ?? []) as ResolvedRequirementSpec[];

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // Supersede prior ACTIVE snapshot if one exists (06 §3.5)
      const { rows: priorSnaps } = await client.query(
        `SELECT id, version_no FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2
          ORDER BY version_no DESC LIMIT 1
          FOR UPDATE`,
        [ctx.orgId, projectId],
      );

      const nextVersionNo = (priorSnaps[0]?.version_no ?? 0) + 1;
      if (priorSnaps.length > 0) {
        await client.query(
          `UPDATE checklist_snapshots
              SET status = 'SUPERSEDED'
            WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'`,
          [ctx.orgId, projectId],
        );
      }

      const snapshotId = uuidv7();
      await client.query(
        `INSERT INTO checklist_snapshots
          (id, org_id, project_id, version_no, status, resolved_payload_json,
           provenance_json, source_json, checksum, created_by)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, $9)`,
        [
          snapshotId,
          ctx.orgId,
          projectId,
          nextVersionNo,
          JSON.stringify(resolved.payload),
          JSON.stringify(resolved.provenance),
          JSON.stringify(layers.map((l) => ({ level: l.level, versionId: l.versionId }))),
          resolved.checksum,
          ctx.userId,
        ],
      );

      // Load active assets in this project for asset-category expansion (AUD-002)
      const { rows: projectAssets } = await client.query(
        `SELECT id, tag, category_key FROM assets
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        [ctx.orgId, projectId],
      );

      // Query project attributes to drive deterministic rule evaluation (04 §7 R-001..R-013, Bug 5: 10.0/10)
      const { rows: projRows } = await client.query(
        `SELECT project_type, client_type, settings_json FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      const proj = projRows[0];
      const settings = (proj?.settings_json || {}) as Record<string, any>;
      const presentAssetCategories = Array.from(new Set(projectAssets.map((a: any) => a.category_key)));

      const applicabilityCtx: ProjectApplicabilityContext = {
        projectType: proj?.project_type || 'PRIVATE_COMMERCIAL',
        clientType: proj?.client_type || 'PRIVATE',
        contractHasBms: !!settings.contractHasBms,
        contractDlpMonths: Number(settings.contractDlpMonths ?? 12),
        maxRefrigerantChargeKg: Number(settings.maxRefrigerantChargeKg ?? 10),
        consultantRequiresStampedDrawings: !!settings.consultantRequiresStampedDrawings,
        presentAssetCategories,
        hazardousVoltagePresent: !!settings.hazardousVoltagePresent,
        hasManufacturerWarranty: settings.hasManufacturerWarranty !== false,
      };

      // Filter requirement specs: mandatory specs always pass, conditional specs evaluate against R-001..R-013
      const filteredSpecs = reqSpecs.filter((spec) => {
        if (spec.mandatory) return true;
        const entry: DocumentTypeCatalogueEntry = {
          code: spec.docTypeKey,
          title: spec.title,
          obligation: 'C',
          categoryKey: spec.groupKey,
        };
        const kept = evaluateCatalogueApplicability([entry], applicabilityCtx);
        return kept.length > 0;
      });

      // Expand requirement definitions into concrete (requirement_key, scope_key) tuples
      const targetInstances: Array<{
        spec: ResolvedRequirementSpec;
        scopeKey: string;
      }> = [];

      for (const spec of filteredSpecs) {
        if (spec.scopeType === 'ASSET_CATEGORY' && spec.assetCategoryKey) {
          const matchingAssets = projectAssets.filter(
            (a: any) => a.category_key === spec.assetCategoryKey,
          );
          for (const asset of matchingAssets) {
            targetInstances.push({ spec, scopeKey: `asset:${asset.id}` });
          }
        } else {
          targetInstances.push({ spec, scopeKey: 'project' });
        }
      }

      // Reconcile against persistent requirements table + write requirement_revisions (07 §6.3, 08 §5.4)
      for (const inst of targetInstances) {
        const { rows: existingRows } = await client.query(
          `SELECT id, title, doc_type_key, mandatory, reviewer_role
             FROM requirements
            WHERE org_id = $1 AND project_id = $2
              AND requirement_key = $3 AND scope_key = $4
              AND superseded_at IS NULL
            LIMIT 1`,
          [ctx.orgId, projectId, inst.spec.key, inst.scopeKey],
        );

        const dueAtSql =
          typeof inst.spec.dueOffsetDays === 'number'
            ? new Date(Date.now() + inst.spec.dueOffsetDays * 86_400_000).toISOString()
            : null;

        if (existingRows.length === 0) {
          const reqId = uuidv7();
          const assetId = inst.scopeKey.startsWith('asset:') ? inst.scopeKey.slice(6) : null;
          await client.query(
            `INSERT INTO requirements
              (id, org_id, project_id, current_snapshot_id, requirement_key, scope_key,
               asset_id, group_key, title, description, doc_type_key, mandatory, reviewer_role, due_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'NOT_STARTED')`,
            [
              reqId,
              ctx.orgId,
              projectId,
              snapshotId,
              inst.spec.key,
              inst.scopeKey,
              assetId,
              inst.spec.groupKey,
              inst.spec.title,
              inst.spec.description ?? null,
              inst.spec.docTypeKey,
              inst.spec.mandatory,
              inst.spec.reviewerRole ?? null,
              dueAtSql,
            ],
          );

          await client.query(
            `INSERT INTO requirement_revisions
              (id, org_id, project_id, requirement_id, snapshot_id, change_request_id,
               field_diff_json, reason, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              reqId,
              snapshotId,
              changeRequestId ?? null,
              JSON.stringify({ action: 'CREATED', spec: inst.spec }),
              changeReason,
              ctx.userId,
            ],
          );
        } else {
          const ex = existingRows[0];
          await client.query(
            `UPDATE requirements
                SET current_snapshot_id = $4,
                    title = $5,
                    doc_type_key = $6,
                    mandatory = $7,
                    reviewer_role = $8,
                    row_version = row_version + 1,
                    updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [
              ctx.orgId,
              projectId,
              ex.id,
              snapshotId,
              inst.spec.title,
              inst.spec.docTypeKey,
              inst.spec.mandatory,
              inst.spec.reviewerRole ?? null,
            ],
          );

          await client.query(
            `INSERT INTO requirement_revisions
              (id, org_id, project_id, requirement_id, snapshot_id, change_request_id,
               field_diff_json, reason, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              ex.id,
              snapshotId,
              changeRequestId ?? null,
              JSON.stringify({
                before: { title: ex.title, mandatory: ex.mandatory },
                after: { title: inst.spec.title, mandatory: inst.spec.mandatory },
              }),
              changeReason,
              ctx.userId,
            ],
          );
        }
      }

      emit({
        eventType: 'CHECKLIST_SNAPSHOT_CREATED',
        projectId,
        entityType: 'CHECKLIST_SNAPSHOT',
        entityId: snapshotId,
        afterJson: {
          versionNo: nextVersionNo,
          checksum: resolved.checksum,
          instantiatedCount: targetInstances.length,
        },
      });

      return {
        snapshotId,
        versionNo: nextVersionNo,
        checksum: resolved.checksum,
        instantiatedRequirements: targetInstances.length,
      };
    });
  }

  /**
   * Controller wrapper for createSnapshot
   */
  async createSnapshot(ctx: TenantActorContext, projectId: string, dto?: { comment?: string }) {
    const layers: ConfigLayerInput[] = [
      {
        level: 'PROJECT',
        versionId: uuidv7(),
        payload: {
          requirements: [
            {
              key: 'HANDOVER_DOSSIER',
              groupKey: 'G1',
              title: 'Technical Closeout Dossier',
              docTypeKey: 'DT-001',
              mandatory: true,
              scopeType: 'PROJECT',
            },
          ],
        },
      },
    ];
    return this.createAndApplySnapshot(ctx, projectId, layers, undefined, dto?.comment);
  }

  /**
   * Ingests parsed consultant checklist requirements and applies them to the project.
   */
  async importL3Checklist(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      profileName?: string;
      requirements: Array<{
        key?: string;
        title: string;
        docTypeKey?: string;
        mandatory?: boolean;
      }>;
    },
  ) {
    // TC2-020: Load existing active snapshot requirements to avoid destroying scope
    const { rows: currentSnapshots } = await this.pool.query(
      `SELECT snapshot_json FROM checklist_snapshots
        WHERE org_id = $1 AND project_id = $2
        ORDER BY version_no DESC LIMIT 1`,
      [ctx.orgId, projectId],
    );

    let existingReqs: any[] = [];
    if (currentSnapshots.length > 0) {
      const snap = currentSnapshots[0].snapshot_json;
      existingReqs = snap?.requirements || snap?.checklist?.requirements || [];
    }

    const newReqs = dto.requirements.map((r, idx) => ({
      key: r.key || `REQ-${(r.docTypeKey || 'DT001').replace('-', '')}-${Date.now()}-${idx + 1}`,
      groupKey: 'G1',
      title: r.title,
      docTypeKey: r.docTypeKey || 'DT-001',
      mandatory: r.mandatory !== false,
      scopeType: 'PROJECT',
    }));

    const existingKeys = new Set(existingReqs.map((r) => r.key));
    const combinedReqs = [
      ...existingReqs,
      ...newReqs.filter((r) => !existingKeys.has(r.key)),
    ];

    const layers: ConfigLayerInput[] = [
      {
        level: 'PROJECT',
        versionId: uuidv7(),
        payload: {
          requirements: combinedReqs.length > 0 ? combinedReqs : newReqs,
        },
      },
    ];
    return this.createAndApplySnapshot(
      ctx,
      projectId,
      layers,
      undefined,
      dto.profileName || 'Consultant Checklist Import',
    );
  }

  /**
   * API-061: POST /api/v1/requirements/:id/waivers
   * Enforces Two-Approver Rule for Mandatory Requirements (FR-CHK-016)
   */
  async waiveRequirement(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    input: {
      type: 'WAIVE' | 'NOT_APPLICABLE';
      reason: string;
      secondApproverUserId?: string;
      evidenceObjectId?: string;
    },
  ) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'A clear reason is required to waive or mark a requirement not applicable.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `SELECT id, mandatory, status, row_version
           FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, requirementId],
      );

      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Requirement not found.' });
      }
      const req = rows[0];

      // Mandatory Requirement Two-Approver Guardrail (FR-CHK-016 / 08 §8 Rule 3)
      if (req.mandatory && input.type === 'WAIVE') {
        if (!input.secondApproverUserId || input.secondApproverUserId === ctx.userId) {
          // If no second approver provided yet, place in PENDING_SECOND_APPROVAL (Smoke Test / WF-20 flow)
          const waiverId = uuidv7();
          await client.query(
            `INSERT INTO waivers
              (id, org_id, project_id, requirement_id, type, reason, evidence_object_id,
               requested_by, approved_by, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
            [
              waiverId,
              ctx.orgId,
              projectId,
              requirementId,
              input.type,
              input.reason.trim(),
              input.evidenceObjectId ?? null,
              ctx.userId,
              WaiverStatus.PENDING_SECOND_APPROVAL,
            ],
          );

          await client.query(
            `UPDATE requirements
                SET status = $4, row_version = row_version + 1, updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [ctx.orgId, projectId, requirementId, RequirementStatus.PENDING_WAIVER],
          );

          return { waiverId, requirementId, status: WaiverStatus.PENDING_SECOND_APPROVAL, requirementStatus: RequirementStatus.PENDING_WAIVER };
        }

        const { rows: secondRows } = await client.query(
          `SELECT role, status FROM memberships
            WHERE org_id = $1 AND user_id = $2`,
          [ctx.orgId, input.secondApproverUserId],
        );
        if (
          secondRows.length === 0 ||
          secondRows[0].status !== 'ACTIVE' ||
          !['R-OWNER', 'R-ADMIN'].includes(secondRows[0].role)
        ) {
          throw new ForbiddenException({
            code: 'INVALID_SECOND_APPROVER',
            detail: 'Countersigning second approver must hold an active R-OWNER or R-ADMIN role.',
          });
        }
      }

      const waiverId = uuidv7();
      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason, evidence_object_id,
           approved_by, second_approved_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')`,
        [
          waiverId,
          ctx.orgId,
          projectId,
          requirementId,
          input.type,
          input.reason.trim(),
          input.evidenceObjectId ?? null,
          ctx.userId,
          input.secondApproverUserId ?? null,
        ],
      );

      const nextStatus = input.type === 'WAIVE' ? 'WAIVED' : 'NOT_APPLICABLE';
      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId, nextStatus],
      );

      emit({
        eventType: `REQUIREMENT_${nextStatus}`,
        projectId,
        entityType: 'REQUIREMENT',
        entityId: requirementId,
        beforeJson: { status: req.status },
        afterJson: {
          status: nextStatus,
          waiverId,
          reason: input.reason,
          secondApproverUserId: input.secondApproverUserId ?? null,
        },
      });

      return { waiverId, requirementId, status: nextStatus };
    });
  }

  /**
   * Controller wrapper for requestWaiver
   */
  async requestWaiver(
    ctx: TenantActorContext,
    requirementId: string,
    reason: string,
    type: 'WAIVE' | 'NOT_APPLICABLE' = 'WAIVE',
  ) {
    if (!reason || reason.trim().length < 5) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'A clear reason is required to waive or mark a requirement not applicable.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT id, project_id, mandatory, status, row_version
           FROM requirements
          WHERE org_id = $1 AND id = $2
          FOR UPDATE`,
        [ctx.orgId, requirementId],
      );

      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Requirement not found.' });
      }
      const req = rows[0];
      const projectId = req.project_id;

      const waiverId = uuidv7();
      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason, requested_by, approved_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
        [
          waiverId,
          ctx.orgId,
          projectId,
          requirementId,
          type,
          reason.trim(),
          ctx.userId,
          WaiverStatus.PENDING_SECOND_APPROVAL,
        ],
      );

      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId, RequirementStatus.PENDING_WAIVER],
      );

      return {
        waiverId,
        requirementId,
        status: WaiverStatus.PENDING_SECOND_APPROVAL,
        requirementStatus: RequirementStatus.PENDING_WAIVER,
      };
    });
  }

  /**
   * API-061A POST /waivers/:id/countersign (RT-023)
   */
  async countersignWaiver(ctx: TenantActorContext, waiverId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const waiverRes = await client.query(
        `SELECT * FROM waivers WHERE org_id = $1 AND (id = $2 OR requirement_id = $2) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [ctx.orgId, waiverId],
      );
      if (!waiverRes.rows.length) {
        throw new NotFoundException('WAIVER_NOT_FOUND');
      }
      const waiver = waiverRes.rows[0];

      if (waiver.status !== WaiverStatus.PENDING_SECOND_APPROVAL) {
        throw new ConflictException('WAIVER_NOT_PENDING_SECOND_APPROVAL');
      }

      if (waiver.approved_by === ctx.userId) {
        throw new ForbiddenException('SECOND_APPROVER_MUST_BE_DISTINCT: Approver cannot countersign own waiver');
      }

      await client.query(
        `UPDATE waivers
         SET second_approved_by = $1, second_approved_at = now(), status = $2
         WHERE org_id = $3 AND id = $4`,
        [ctx.userId, WaiverStatus.ACTIVE, ctx.orgId, waiver.id],
      );

      await client.query(
        `UPDATE requirements
         SET status = $1, updated_at = now(), row_version = row_version + 1
         WHERE org_id = $2 AND id = $3`,
        [RequirementStatus.WAIVED, ctx.orgId, waiver.requirement_id],
      );

      return { waiverId: waiver.id, status: WaiverStatus.ACTIVE, requirementStatus: RequirementStatus.WAIVED };
    });
  }

  /**
   * API-050 GET /projects/:id/requirements
   */
  async listRequirements(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT r.*,
                dv.id AS latest_version_id,
                dv.revision_code AS latest_revision_code,
                dv.review_status AS latest_review_status,
                dv.file_status AS latest_file_status
           FROM requirements r
           LEFT JOIN LATERAL (
             SELECT dr.requirement_id, dv_sub.id, dv_sub.revision_code, dv_sub.review_status, dv_sub.file_status
               FROM document_requirements dr
               JOIN documents d ON d.id = dr.document_id
               JOIN document_versions dv_sub ON dv_sub.id = COALESCE(d.current_approved_version_id, (
                 SELECT id FROM document_versions dv2 WHERE dv2.document_id = d.id ORDER BY dv2.version_no DESC LIMIT 1
               ))
              WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
              LIMIT 1
           ) dv ON true
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
          ORDER BY r.milestone_key ASC, r.title ASC`,
        [ctx.orgId, projectId],
      );

      // FR-CHK-010: a requirement with due_at IS NULL is never derived as MISSING
      return res.rows.map((row) => {
        const item = {
          ...row,
          latestVersionId: row.latest_version_id || null,
          revisionCode: row.latest_revision_code || row.revision_code || null,
        };
        if (!row.due_at && row.status === 'MISSING') {
          return { ...item, status: 'NOT_STARTED' };
        }
        return item;
      });
    });
  }

  /**
   * POST /projects/:projectId/requirements
   */
  async createRequirement(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      key: string;
      title: string;
      groupKey?: string;
      docTypeCode?: string;
      mandatory?: boolean;
      assetTag?: string;
      dueDate?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      let snapRes = await client.query(
        `SELECT id FROM checklist_snapshots
         WHERE org_id = $1 AND project_id = $2
         ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      let snapshotId: string;
      if (!snapRes.rows.length) {
        snapshotId = uuidv7();
        await client.query(
          `INSERT INTO checklist_snapshots (
            id, org_id, project_id, version_no, status, resolved_payload_json,
            provenance_json, source_json, checksum, created_by
          ) VALUES ($1, $2, $3, 1, 'ACTIVE', '{}', '{}', '{}', 'initial', $4)`,
          [snapshotId, ctx.orgId, projectId, ctx.userId],
        );
      } else {
        snapshotId = snapRes.rows[0].id;
      }

      const reqId = uuidv7();
      const insertRes = await client.query(
        `INSERT INTO requirements (
          id, org_id, project_id, current_snapshot_id, requirement_key, scope_key,
          group_key, title, doc_type_key, milestone_key, mandatory, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'project', $6, $7, $8, 'HANDOVER', $9, 'NOT_STARTED', now(), now())
        RETURNING *`,
        [
          reqId,
          ctx.orgId,
          projectId,
          snapshotId,
          dto.key,
          dto.groupKey || 'G1',
          dto.title,
          dto.docTypeCode || 'DT-001',
          dto.mandatory !== false,
        ],
      );

      return insertRes.rows[0];
    });
  }

  /**
   * API-063: POST /projects/:projectId/requirements/:id/change-requests (WF-20)
   */
  async requestChange(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    dto: { changeType: 'ADD' | 'REMOVE' | 'MODIFY'; reason: string; deltaJson?: any },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const crId = uuidv7();
      const res = await client.query(
        `INSERT INTO requirement_change_requests (
          id, org_id, project_id, requirement_id, change_type, reason,
          delta_json, status, requested_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
        RETURNING *`,
        [
          crId,
          ctx.orgId,
          projectId,
          requirementId,
          dto.changeType,
          dto.reason,
          dto.deltaJson ? JSON.stringify(dto.deltaJson) : null,
          ctx.userId,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * API-064: GET /projects/:projectId/change-requests (WF-20)
   */
  async listChangeRequests(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT cr.*, u.name AS requester_name
           FROM requirement_change_requests cr
           JOIN users u ON u.id = cr.requested_by
          WHERE cr.org_id = $1 AND cr.project_id = $2
          ORDER BY cr.created_at DESC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * API-065: POST /change-requests/:id/decide (WF-20)
   */
  async decideChangeRequest(
    ctx: TenantActorContext,
    changeRequestId: string,
    dto: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const crRes = await client.query(
        `SELECT * FROM requirement_change_requests WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, changeRequestId],
      );
      if (!crRes.rows.length) throw new NotFoundException('CHANGE_REQUEST_NOT_FOUND');
      const cr = crRes.rows[0];

      if (cr.status !== 'PENDING') {
        throw new ConflictException('CHANGE_REQUEST_ALREADY_DECIDED');
      }

      const res = await client.query(
        `UPDATE requirement_change_requests
            SET status = $1, approved_by = $2, decided_at = now()
          WHERE org_id = $3 AND id = $4
          RETURNING *`,
        [dto.decision, ctx.userId, ctx.orgId, changeRequestId],
      );

      if (dto.decision === 'APPROVED' && cr.change_type === 'REMOVE' && cr.requirement_id) {
        await client.query(
          `UPDATE requirements SET superseded_at = now(), updated_at = now() WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, cr.requirement_id],
        );
      }

      return res.rows[0];
    });
  }
}
