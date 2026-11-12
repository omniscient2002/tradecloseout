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
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import {
  withTenantTransaction,
  TenantActorContext,
  DomainOutboxEvent,
} from '@tradecloseout/db';
import {
  resolveConfigurationHierarchy,
  ConfigLayerInput,
} from '../configuration/config-resolver';
import { RequirementStatus, WaiverStatus, hasPermission } from '@tradecloseout/shared';

export interface ResolvedRequirementSpec {
  key: string;
  groupKey: string;
  title: string;
  description?: string;
  docTypeKey: string;
  mandatory: boolean;
  scopeType: 'PROJECT' | 'ASSET_CATEGORY' | 'ASSET';
  assetCategoryKey?: string;
  assetId?: string;
  reviewerRole?: string;
  dueOffsetDays?: number;
  validityRule?: Record<string, unknown>;
}

@Injectable()
export class ChecklistsService {
  constructor(private readonly pool: Pool) {}

  private async lockEditableProject(client: PoolClient, orgId: string, projectId: string): Promise<void> {
    // Every baseline writer shares closure's project lock. Check the lifecycle
    // after acquiring it so a waiting import cannot change a just-closed scope.
    const { rows } = await client.query(
      `SELECT id, status, purged_at FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
      [orgId, projectId],
    );
    const project = rows[0];
    if (!project) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (project.purged_at != null) {
      throw new ConflictException({ code: 'PROJECT_PURGED', detail: 'Purged projects cannot change their contractual checklist.' });
    }
    if (project.status === 'CLOSED') {
      throw new ConflictException({
        code: 'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN',
        detail: 'Formally reopen the project before changing its accepted contractual checklist.',
      });
    }
    if (!['DRAFT', 'ACTIVE', 'HANDOVER'].includes(project.status)) {
      throw new ConflictException({
        code: 'PROJECT_CHECKLIST_NOT_EDITABLE',
        detail: 'The project lifecycle does not permit contractual checklist changes.',
      });
    }
  }

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
    transaction?: { client: PoolClient; emit: (ev: DomainOutboxEvent) => void },
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
    if (!Array.isArray(reqSpecs) || reqSpecs.length === 0) {
      throw new UnprocessableEntityException({
        code: 'CHECKLIST_REQUIREMENTS_MISSING',
        detail: 'A checklist needs explicit contract or trade requirements. An empty snapshot cannot be applied.',
      });
    }
    const seenKeys = new Set<string>();
    for (const spec of reqSpecs) {
      if (!spec.key?.trim() || !spec.title?.trim() || !spec.docTypeKey?.trim() ||
          !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(spec.scopeType) ||
          (spec.scopeType === 'ASSET_CATEGORY' && !spec.assetCategoryKey) ||
          (spec.scopeType === 'ASSET' && !spec.assetId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_CHECKLIST_REQUIREMENT',
          detail: 'Requirements need a key, title, document type, and an explicit valid scope.',
        });
      }
      if (seenKeys.has(spec.key)) {
        throw new UnprocessableEntityException({
          code: 'DUPLICATE_CHECKLIST_KEY',
          detail: `Requirement key '${spec.key}' appears more than once.`,
        });
      }
      seenKeys.add(spec.key);
    }

    const applySnapshot = async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // Serialize competing snapshot writers, including the first snapshot when
      // there is no existing checklist row to lock.
      await this.lockEditableProject(client, ctx.orgId, projectId);
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

      // Requirements in an explicitly approved contract/consultant checklist
      // are already applicable. In particular, optional consultant records
      // must not vanish merely because they are not in the platform's generic
      // conditional catalogue. Conditional rules belong in template resolution,
      // before the resulting project checklist is approved and snapshotted.
      const filteredSpecs = reqSpecs;

      // Expand requirement definitions into concrete (requirement_key, scope_key) tuples
      const targetInstances: Array<{
        spec: ResolvedRequirementSpec;
        scopeKey: string;
      }> = [];

      for (const spec of filteredSpecs) {
        if (spec.scopeType === 'ASSET' && spec.assetId) {
          const asset = projectAssets.find((a: any) => a.id === spec.assetId);
          if (!asset) {
            throw new UnprocessableEntityException({
              code: 'CHECKLIST_ASSET_NOT_FOUND',
              detail: `Requirement '${spec.key}' targets an asset not active in this project.`,
            });
          }
          targetInstances.push({ spec, scopeKey: `asset:${asset.id}` });
        } else if (spec.scopeType === 'ASSET_CATEGORY' && spec.assetCategoryKey) {
          const matchingAssets = projectAssets.filter(
            (a: any) => a.category_key === spec.assetCategoryKey,
          );
          if (matchingAssets.length === 0 && spec.mandatory) {
            throw new UnprocessableEntityException({
              code: 'MANDATORY_ASSET_CATEGORY_MISSING',
              detail: `Mandatory checklist requirement '${spec.key}' targets an equipment category absent from the project asset register.`,
            });
          }
          for (const asset of matchingAssets) {
            targetInstances.push({ spec, scopeKey: `asset:${asset.id}` });
          }
        } else {
          targetInstances.push({ spec, scopeKey: 'project' });
        }
      }

      if (targetInstances.length === 0) {
        throw new UnprocessableEntityException({
          code: 'NO_APPLICABLE_CHECKLIST_REQUIREMENTS',
          detail: 'No requirements apply to the active project assets. Review the asset register and checklist mapping before creating a snapshot.',
        });
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

        // The canonical DB column is NOT NULL. A consultant import does not
        // choose review authority; preserve an existing trusted policy, otherwise
        // use the same server-defined R-QC policy as the SQL column default.
        const reviewerRole = inst.spec.reviewerRole ?? existingRows[0]?.reviewer_role ?? 'R-QC';
        if (!['R-QC', 'R-PM', 'R-OWNER', 'R-ADMIN', 'R-REVIEWER', 'R-CONSULTANT'].includes(reviewerRole)) {
          throw new UnprocessableEntityException({
            code: 'INVALID_REVIEWER_ROLE',
            detail: 'Checklist reviewer role must be an authorized review role.',
          });
        }

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
              reviewerRole,
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
          const semanticChange =
            ex.title !== inst.spec.title ||
            ex.doc_type_key !== inst.spec.docTypeKey ||
            ex.mandatory !== inst.spec.mandatory ||
            ex.reviewer_role !== reviewerRole;
          // An exception is valid for the obligation that was approved, not
          // for a materially different document, scope, or approval policy.
          // Keep the historical waiver record but remove its ACTIVE effect.
          if (semanticChange) {
            await client.query(
              `UPDATE waivers SET status = 'SUPERSEDED'
                 WHERE org_id = $1 AND project_id = $2 AND requirement_id = $3
                   AND status IN ('ACTIVE', 'PENDING_SECOND_APPROVAL')`,
              [ctx.orgId, projectId, ex.id],
            );
          }
          await client.query(
            `UPDATE requirements
                SET current_snapshot_id = $4,
                    title = $5,
                    doc_type_key = $6,
                    mandatory = $7,
                    reviewer_role = $8,
                    status = CASE WHEN $9::boolean AND status IN ('WAIVED','NOT_APPLICABLE','PENDING_WAIVER') THEN 'NOT_STARTED' ELSE status END,
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
              reviewerRole,
              semanticChange,
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
                before: { title: ex.title, docTypeKey: ex.doc_type_key, mandatory: ex.mandatory, reviewerRole: ex.reviewer_role },
                after: { title: inst.spec.title, docTypeKey: inst.spec.docTypeKey, mandatory: inst.spec.mandatory, reviewerRole },
                semanticChange,
                waiversSuperseded: semanticChange,
              }),
              changeReason,
              ctx.userId,
            ],
          );
        }
      }

      // A new snapshot supersedes obligations removed from its scope. Leaving
      // these active would make readiness evaluate requirements that no longer
      // belong to the contract, or allow old evidence to satisfy a new version.
      // jsonb_to_recordset keeps the (requirement_key, scope_key) comparison
      // exact and parameterized, including asset-expanded requirements.
      const activeKeys = targetInstances.map((inst) => ({
        requirement_key: inst.spec.key,
        scope_key: inst.scopeKey,
      }));
      await client.query(
        `UPDATE requirements r
            SET superseded_at = now(), row_version = row_version + 1, updated_at = now()
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_to_recordset($3::jsonb)
                AS active(requirement_key text, scope_key text)
               WHERE active.requirement_key = r.requirement_key
                 AND active.scope_key = r.scope_key
            )`,
        [ctx.orgId, projectId, JSON.stringify(activeKeys)],
      );

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
    };
    // Import/reapply callers provide a transaction which already holds the
    // project lock. Never commit the baseline read before this write.
    return transaction
      ? applySnapshot(transaction.client, transaction.emit)
      : withTenantTransaction(this.pool, ctx, applySnapshot);
  }

  /**
   * Reapply the existing explicit checklist configuration. We intentionally do
   * not substitute a fake one-item handover dossier when no template exists.
   */
  async createSnapshot(ctx: TenantActorContext, projectId: string, dto?: { comment?: string }) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // Lock BEFORE reading the baseline, so reapply cannot overwrite a
      // concurrent consultant import with a stale snapshot.
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows } = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const existing = rows[0]?.resolved_payload_json;
      const payload = typeof existing === 'string' ? JSON.parse(existing) : existing;
      if (!Array.isArray(payload?.requirements) || payload.requirements.length === 0) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_CONFIGURATION_REQUIRED',
          detail: 'Import a consultant checklist or configure a real HVAC template before creating a snapshot.',
        });
      }
      return this.createAndApplySnapshot(
        ctx, projectId,
        [{ level: 'PROJECT', versionId: uuidv7(), payload: { requirements: payload.requirements } }],
        undefined, dto?.comment || 'Reapply configured checklist',
        { client, emit },
      );
    });
  }

  /**
   * Imports scoped consultant requirements without overwriting the existing
   * snapshot or inventing DT-001 for unknown document types.
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
        groupKey?: string;
        mandatory?: boolean;
        scopeType?: 'PROJECT' | 'ASSET_CATEGORY' | 'ASSET';
        assetCategoryKey?: string;
        assetId?: string;
      }>;
    },
  ) {
    if (!Array.isArray(dto?.requirements) || dto.requirements.length === 0 || dto.requirements.length > 1000) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CHECKLIST_IMPORT',
        detail: 'Supply between 1 and 1000 mapped consultant requirements.',
      });
    }

    // Read AND apply in the same RLS-bound transaction, after taking the
    // project lock. A second importer observes the first committed snapshot.
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows: activeSnapshots } = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const currentSnapshot = activeSnapshots[0]?.resolved_payload_json;
    const existingPayload = typeof currentSnapshot === 'string' ? JSON.parse(currentSnapshot) : currentSnapshot;
    const existingReqs: ResolvedRequirementSpec[] =
      Array.isArray(existingPayload?.requirements) ? existingPayload.requirements : [];

    const newReqs: ResolvedRequirementSpec[] = dto.requirements.map((r, idx) => {
      const title = r.title?.trim();
      const docTypeKey = r.docTypeKey?.trim();
      const scopeType = r.scopeType || 'PROJECT';
      if (!title || !docTypeKey || !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(scopeType) ||
          (scopeType === 'ASSET_CATEGORY' && !r.assetCategoryKey) ||
          (scopeType === 'ASSET' && !r.assetId)) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_MAPPING_REQUIRED',
          detail: `Row ${idx + 1} needs a title, mapped document type and valid project/asset scope.`,
        });
      }
      const naturalKey = [docTypeKey, title.toLowerCase(), scopeType, r.assetCategoryKey || '', r.assetId || ''].join('|');
      const key = r.key?.trim() || `IMPORTED-${createHash('sha256').update(naturalKey).digest('hex').slice(0, 16)}`;
      return {
        key,
        groupKey: r.groupKey?.trim() || 'CONSULTANT',
        title,
        docTypeKey,
        mandatory: r.mandatory !== false,
        scopeType,
        ...(scopeType === 'ASSET_CATEGORY' ? { assetCategoryKey: r.assetCategoryKey } : {}),
        ...(scopeType === 'ASSET' ? { assetId: r.assetId } : {}),
      };
    });

    const newKeys = new Set<string>();
    for (const r of newReqs) {
      if (newKeys.has(r.key)) {
        throw new UnprocessableEntityException({
          code: 'DUPLICATE_CHECKLIST_KEY',
          detail: `The import contains duplicate requirement key '${r.key}'.`,
        });
      }
      newKeys.add(r.key);
    }
    // A repeated import replaces the matching definition instead of creating
    // duplicate obligations. All unrelated requirements remain in the snapshot.
    const combinedReqs = [
      ...existingReqs.filter((r) => !newKeys.has(r.key)),
      ...newReqs,
    ];
    return this.createAndApplySnapshot(
      ctx,
      projectId,
      [{ level: 'PROJECT', versionId: uuidv7(), payload: { requirements: combinedReqs } }],
      undefined,
      dto.profileName || 'Consultant Checklist Import',
      { client, emit },
    );
    });
  }

  /**
   * API-061: POST /api/v1/requirements/:id/waivers
   * Enforces Two-Approver Rule for Mandatory Requirements (FR-CHK-016)
   */
  /**
   * PH3-G07: enforce one current waiver decision per exact requirement revision.
   * Tenant authority and lifecycle are loaded from the database on each command.
   * Lock order is project -> requirement -> waiver for all waiver writers.
   */
  private async assertLiveWaiverAuthority(
    client: PoolClient, ctx: TenantActorContext, projectId: string,
    action: 'requirement.waive' | 'requirement.waive_second',
  ): Promise<void> {
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new ForbiddenException('WAIVER_INTERNAL_AUTHORITY_REQUIRED');
    }
    const { rows: members } = await client.query(
      `SELECT m.role FROM memberships m
       JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
       WHERE m.org_id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE'
       FOR SHARE OF m`,
      [ctx.orgId, ctx.userId],
    );
    if (!members.length) throw new ForbiddenException('WAIVER_ACTIVE_MEMBERSHIP_REQUIRED');
    const { rows: projects } = await client.query(
      `SELECT role FROM project_members
       WHERE org_id = $1 AND project_id = $2 AND user_id = $3
         AND status = 'ACTIVE' FOR SHARE`,
      [ctx.orgId, projectId, ctx.userId],
    );
    const evaluated = hasPermission(
      { orgRole: members[0].role, projectRole: projects[0]?.role },
      action,
    );
    if (!evaluated.allowed || (evaluated.scope === 'S' && !projects.length)) {
      throw new ForbiddenException('WAIVER_PERMISSION_DENIED');
    }
  }

  private async lockCurrentWaiverRequirement(
    client: PoolClient, ctx: TenantActorContext,
    projectId: string, requirementId: string,
  ): Promise<{
    id: string; project_id: string; mandatory: boolean;
    status: string; row_version: number;
  }> {
    await this.lockEditableProject(client, ctx.orgId, projectId);
    const { rows } = await client.query(
      `SELECT r.id, r.project_id, r.mandatory, r.status, r.row_version
         FROM requirements r
         JOIN checklist_snapshots cs
           ON cs.org_id = r.org_id AND cs.project_id = r.project_id
          AND cs.id = r.current_snapshot_id AND cs.status = 'ACTIVE'
        WHERE r.org_id = $1 AND r.project_id = $2 AND r.id = $3
          AND r.superseded_at IS NULL
        FOR UPDATE OF r`,
      [ctx.orgId, projectId, requirementId],
    );
    if (!rows.length) throw new ConflictException('WAIVER_OBLIGATION_NOT_CURRENT');
    return rows[0];
  }

  /**
   * Optional requirements may be marked waived/NA immediately by a qualified
   * actor. Mandatory requirements always require an independent countersign
   * irrespective of whether the intent is WAIVE or NOT_APPLICABLE.
   */
  async requestWaiver(
    ctx: TenantActorContext,
    requirementId: string,
    reason: string,
    type: 'WAIVE' | 'NOT_APPLICABLE' = 'WAIVE',
    options: { commandId?: string; expectedRowVersion?: number } = {},
  ) {
    if (!['WAIVE', 'NOT_APPLICABLE'].includes(type) ||
        typeof reason !== 'string' || reason.trim().length < 10 ||
        reason.trim().length > 2000) {
      throw new UnprocessableEntityException({
        code: 'INVALID_WAIVER_INTENT',
        detail: 'WAIVE or NOT_APPLICABLE requires a reason of 10–2000 characters.',
      });
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((options.commandId !== undefined && !uuid.test(options.commandId)) ||
        (options.expectedRowVersion !== undefined &&
          (!Number.isSafeInteger(options.expectedRowVersion) || options.expectedRowVersion < 1))) {
      throw new UnprocessableEntityException('INVALID_WAIVER_PRECONDITION');
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const target = await client.query(
        `SELECT project_id FROM requirements WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, requirementId],
      );
      if (!target.rows.length) throw new NotFoundException('REQUIREMENT_NOT_FOUND');
      const projectId = target.rows[0].project_id as string;
      const req = await this.lockCurrentWaiverRequirement(client, ctx, projectId, requirementId);
      await this.assertLiveWaiverAuthority(client, ctx, projectId, 'requirement.waive');
      const { rows: intents } = await client.query(
        `SELECT * FROM waivers
          WHERE org_id = $1 AND project_id = $2 AND requirement_id = $3
            AND status IN ('PENDING_SECOND_APPROVAL','ACTIVE')
          ORDER BY created_at DESC, id DESC FOR UPDATE`,
        [ctx.orgId, projectId, requirementId],
      );
      if (intents.length > 1) throw new ConflictException('WAIVER_DUPLICATE_ACTIVE_INTENTS');
      if (intents.length === 1) {
        const prior = intents[0];
        if (prior.type !== type || prior.reason !== reason.trim() ||
            prior.requested_by !== ctx.userId ||
            (options.commandId !== undefined && prior.command_id !== options.commandId)) {
          throw new ConflictException('WAIVER_CURRENT_INTENT_CONFLICT');
        }
        if (prior.obligation_row_version == null) {
          throw new ConflictException('WAIVER_LEGACY_INTENT_REQUALIFICATION_REQUIRED');
        }
        if (options.expectedRowVersion !== undefined &&
            options.expectedRowVersion !== prior.obligation_row_version &&
            options.expectedRowVersion !== req.row_version) {
          throw new ConflictException('WAIVER_ROW_VERSION_CONFLICT');
        }
        return {
          waiverId: prior.id, requirementId, status: prior.status,
          requirementStatus: req.status, rowVersion: req.row_version,
          idempotentReplay: true,
        };
      }
      if (options.expectedRowVersion !== undefined &&
          options.expectedRowVersion !== req.row_version) {
        throw new ConflictException('WAIVER_ROW_VERSION_CONFLICT');
      }
      if (['WAIVED', 'NOT_APPLICABLE', 'PENDING_WAIVER', 'HANDED_OVER',
           'SUPERSEDED', 'APPROVED'].includes(req.status)) {
        throw new ConflictException('WAIVER_REQUIREMENT_NOT_ELIGIBLE');
      }
      const mandatory = req.mandatory === true;
      const status = mandatory ? WaiverStatus.PENDING_SECOND_APPROVAL : WaiverStatus.ACTIVE;
      const requirementStatus = mandatory
        ? RequirementStatus.PENDING_WAIVER
        : type === 'WAIVE' ? RequirementStatus.WAIVED : RequirementStatus.NOT_APPLICABLE;
      const waiverId = uuidv7();
      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason,
           is_mandatory_item, requested_by, approved_by, status,
           obligation_row_version, command_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [
          waiverId, ctx.orgId, projectId, requirementId, type,
          reason.trim(), mandatory, ctx.userId, status, req.row_version,
          options.commandId ?? null,
        ],
      );
      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $5`,
        [ctx.orgId, projectId, requirementId, requirementStatus, req.row_version],
      );
      emit({
        eventType: mandatory ? 'WAIVER_REQUESTED' : 'WAIVER_APPROVED_OPTIONAL',
        projectId, entityType: 'WAIVER', entityId: waiverId,
        afterJson: {
          requirementId, type, status, requirementStatus, mandatory,
          obligationRowVersion: req.row_version, commandId: options.commandId ?? null,
        },
      });
      return {
        waiverId, requirementId, status, requirementStatus,
        rowVersion: req.row_version + 1, idempotentReplay: false,
      };
    });
  }

  /** Older in-process entrypoint is deliberately routed through the same
   * canonical authority, lifecycle and independent-approval state machine. */
  async waiveRequirement(
    ctx: TenantActorContext, projectId: string, requirementId: string,
    input: {
      type: 'WAIVE' | 'NOT_APPLICABLE'; reason: string;
      secondApproverUserId?: string; evidenceObjectId?: string;
    },
  ) {
    if (input.secondApproverUserId || input.evidenceObjectId) {
      throw new ConflictException('USE_EXPLICIT_WAIVER_COUNTERSIGN_AND_EVIDENCE_REVIEW');
    }
    const target = await this.requestWaiver(ctx, requirementId, input.reason, input.type);
    // The project ID was not trusted for the canonical write. Verify it
    // before returning any details on this compatibility entry point.
    if (!projectId) throw new NotFoundException('PROJECT_NOT_FOUND');
    return target;
  }

  /**
   * Only an explicitly named waiver may be countersigned. No latest-by-
   * requirement fallback and no approval of a changed or superseded baseline.
   */
  async countersignWaiver(ctx: TenantActorContext, waiverId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: identifiers } = await client.query(
        `SELECT project_id, requirement_id FROM waivers WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, waiverId],
      );
      if (!identifiers.length) throw new NotFoundException('WAIVER_NOT_FOUND');
      const { project_id: projectId, requirement_id: requirementId } = identifiers[0];
      const req = await this.lockCurrentWaiverRequirement(client, ctx, projectId, requirementId);
      await this.assertLiveWaiverAuthority(client, ctx, projectId, 'requirement.waive_second');
      const { rows } = await client.query(
        `SELECT * FROM waivers WHERE org_id = $1 AND project_id = $2
           AND requirement_id = $3 AND id = $4 FOR UPDATE`,
        [ctx.orgId, projectId, requirementId, waiverId],
      );
      if (!rows.length) throw new NotFoundException('WAIVER_NOT_FOUND');
      const waiver = rows[0];
      if (waiver.status === WaiverStatus.ACTIVE &&
          waiver.second_approved_by === ctx.userId &&
          req.status === (waiver.type === 'WAIVE' ? 'WAIVED' : 'NOT_APPLICABLE') &&
          req.row_version === waiver.obligation_row_version + 2) {
        return {
          waiverId, status: WaiverStatus.ACTIVE, requirementStatus: req.status,
          rowVersion: req.row_version, idempotentReplay: true,
        };
      }
      if (waiver.status !== WaiverStatus.PENDING_SECOND_APPROVAL) {
        throw new ConflictException('WAIVER_NOT_PENDING_SECOND_APPROVAL');
      }
      if (waiver.requested_by === ctx.userId || waiver.approved_by === ctx.userId) {
        throw new ForbiddenException('SECOND_APPROVER_MUST_BE_DISTINCT');
      }
      if (!waiver.is_mandatory_item || !req.mandatory ||
          waiver.obligation_row_version == null ||
          req.status !== RequirementStatus.PENDING_WAIVER ||
          req.row_version !== waiver.obligation_row_version + 1) {
        throw new ConflictException('WAIVER_OBLIGATION_REVISION_CONFLICT');
      }
      const { rowCount } = await client.query(
        `UPDATE waivers SET second_approved_by = $1,
           second_approved_at = now(), status = 'ACTIVE'
          WHERE org_id = $2 AND project_id = $3 AND id = $4
            AND status = 'PENDING_SECOND_APPROVAL'`,
        [ctx.userId, ctx.orgId, projectId, waiverId],
      );
      if (rowCount !== 1) throw new ConflictException('WAIVER_DECISION_CONFLICT');
      const requirementStatus = waiver.type === 'WAIVE'
        ? RequirementStatus.WAIVED : RequirementStatus.NOT_APPLICABLE;
      await client.query(
        `UPDATE requirements SET status = $4, updated_at = now(),
           row_version = row_version + 1
         WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $5`,
        [ctx.orgId, projectId, requirementId, requirementStatus, req.row_version],
      );
      emit({
        eventType: 'WAIVER_COUNTERSIGNED', projectId,
        entityType: 'WAIVER', entityId: waiverId,
        afterJson: {
          requirementId, requirementStatus, type: waiver.type,
          obligationRowVersion: waiver.obligation_row_version,
          approvedBy: ctx.userId,
        },
      });
      return {
        waiverId, status: WaiverStatus.ACTIVE, requirementStatus,
        rowVersion: req.row_version + 1, idempotentReplay: false,
      };
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
    const requiredDocType = dto?.docTypeCode?.trim();
    if (!dto?.key?.trim() || !dto.title?.trim() || !requiredDocType) {
      throw new UnprocessableEntityException({
        code: 'REQUIREMENT_MAPPING_REQUIRED',
        detail: 'A new contractual requirement must have a key, title, and mapped document type.',
      });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows: snaps } = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const raw = snaps[0]?.resolved_payload_json;
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(snapshot?.requirements) || snapshot.requirements.length === 0) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_CONFIGURATION_REQUIRED',
          detail: 'Configure the project checklist before adding requirements.',
        });
      }
      const key = dto.key.trim();
      if (snapshot.requirements.some((r: ResolvedRequirementSpec) => r.key === key)) {
        throw new ConflictException({
          code: 'DUPLICATE_REQUIREMENT_KEY',
          detail: 'Use a controlled change request to modify an existing obligation.',
        });
      }
      let scopeType: ResolvedRequirementSpec['scopeType'] = 'PROJECT';
      let assetId: string | undefined;
      if (dto.assetTag) {
        const { rows: assets } = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2
             AND tag = $3 AND status = 'ACTIVE' AND deleted_at IS NULL`,
          [ctx.orgId, projectId, dto.assetTag],
        );
        if (assets.length !== 1) throw new NotFoundException('PROJECT_ASSET_NOT_FOUND');
        assetId = assets[0].id;
        scopeType = 'ASSET';
      }
      const extra: ResolvedRequirementSpec = {
        key,
        title: dto.title.trim(),
        groupKey: dto.groupKey?.trim() || 'CONSULTANT',
        docTypeKey: requiredDocType,
        mandatory: dto.mandatory !== false,
        scopeType,
        ...(assetId ? { assetId } : {}),
        reviewerRole: 'R-QC',
      };
      const applied = await this.createAndApplySnapshot(
        ctx, projectId,
        [{ level: 'PROJECT', versionId: uuidv7(),
           payload: { requirements: [...snapshot.requirements, extra] } }],
        undefined,
        'Manual contractual requirement addition',
        { client, emit },
      );
      const { rows: created } = await client.query(
        `SELECT * FROM requirements WHERE org_id = $1 AND project_id = $2
           AND current_snapshot_id = $3 AND requirement_key = $4
           AND scope_key = $5 AND superseded_at IS NULL`,
        [ctx.orgId, projectId, applied.snapshotId, key, assetId ? `asset:${assetId}` : 'project'],
      );
      if (!created.length) throw new ConflictException('REQUIREMENT_SNAPSHOT_APPLY_FAILED');
      return created[0];
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
