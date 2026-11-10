// apps/api/src/modules/assets/assets.service.ts
// Equipment / Assets Service with Dynamic Requirement Instantiation (API-070..076, WF-07, FR-AST-001..012, AUD-002)

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext, DomainOutboxEvent } from '@tradecloseout/db';
import { AssetTagSchema } from '@tradecloseout/shared';
import { ResolvedRequirementSpec } from '../checklists/checklists.service';

export interface CreateAssetInput {
  tag: string;
  name: string;
  categoryKey: string;
  make?: string;
  model?: string;
  serialNo?: string;
  location?: string;
  refrigerant?: string;
  installDate?: string;
  warrantyStart?: string;
  warrantyStartBasis?: 'COMMISSIONING' | 'HANDOVER' | 'ACCEPTANCE' | 'SUPPLY';
  warrantyEnd?: string;
  replacesAssetId?: string;
}

@Injectable()
export class AssetsService {
  constructor(private readonly pool: Pool) {}

  private async lockEditableProject(client: PoolClient, ctx: TenantActorContext, projectId: string): Promise<void> {
    // Closure and all asset register/evidence mutations must serialize on the
    // same project row, with lifecycle checked AFTER acquiring the lock.
    const { rows } = await client.query(
      `SELECT status, purged_at FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
      [ctx.orgId, projectId],
    );
    if (!rows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (rows[0].purged_at != null) {
      throw new ConflictException({ code: 'PROJECT_PURGED', detail: 'Purged projects cannot be amended.' });
    }
    if (rows[0].status === 'CLOSED') {
      throw new ConflictException({
        code: 'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN',
        detail: 'Reopen the closed project before changing its asset or evidence register.',
      });
    }
    if (!['DRAFT', 'ACTIVE', 'HANDOVER'].includes(rows[0].status)) {
      throw new ConflictException({ code: 'PROJECT_ASSETS_NOT_EDITABLE', detail: 'Project state forbids asset changes.' });
    }
  }

  /**
   * API-071: POST /api/v1/projects/:id/assets
   * Registers an equipment unit and automatically instantiates asset-scoped requirements
   * from the active project checklist snapshot (WF-07, AUD-002).
   */
  async createAsset(
    ctx: TenantActorContext,
    projectId: string,
    input: CreateAssetInput,
  ) {
    const tagParse = AssetTagSchema.safeParse(input.tag);
    if (!tagParse.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: tagParse.error.issues[0]?.message ?? 'Invalid asset tag.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx, projectId);
      const normalizedTag = tagParse.data;

      // Check case-insensitive tag uniqueness per project (FR-AST-004)
      const { rows: dupRows } = await client.query(
        `SELECT id FROM assets
          WHERE org_id = $1 AND project_id = $2 AND upper(tag) = upper($3)
            AND deleted_at IS NULL
          LIMIT 1`,
        [ctx.orgId, projectId, normalizedTag],
      );
      if (dupRows.length > 0) {
        throw new ConflictException({
          code: 'DUPLICATE_ASSET_TAG',
          title: 'Equipment tag already exists',
          detail: `An equipment record with tag '${normalizedTag}' already exists in this project.`,
        });
      }

      const assetId = uuidv7();
      const { rows: insertedRows } = await client.query(
        `INSERT INTO assets
          (id, org_id, project_id, tag, name, category_key, make, model, serial_no,
           location, refrigerant, install_date, warranty_start, warranty_start_basis,
           warranty_end, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'ACTIVE', $16)
         RETURNING *`,
        [
          assetId,
          ctx.orgId,
          projectId,
          normalizedTag,
          input.name.trim(),
          input.categoryKey,
          input.make ?? null,
          input.model ?? null,
          input.serialNo ?? null,
          input.location ?? null,
          input.refrigerant ?? null,
          input.installDate ?? null,
          input.warrantyStart ?? null,
          input.warrantyStartBasis ?? 'HANDOVER',
          input.warrantyEnd ?? null,
          ctx.userId,
        ],
      );

      // If this asset replaces an older unit, link replacement lineage (FR-AST-006 / FR-AST-011)
      if (input.replacesAssetId) {
        await client.query(
          `UPDATE assets
              SET status = 'REPLACED',
                  replaced_by_asset_id = $4,
                  row_version = row_version + 1,
                  updated_at = now()
            WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, input.replacesAssetId, assetId],
        );
      }

      // Instantiate asset-scoped requirements from active snapshot (AUD-002 / FR-AST-005)
      const instantiatedCount = await this.instantiateAssetRequirements(
        client,
        ctx,
        projectId,
        assetId,
        input.categoryKey,
      );

      emit({
        eventType: 'ASSET_CREATED',
        projectId,
        entityType: 'ASSET',
        entityId: assetId,
        afterJson: {
          tag: normalizedTag,
          categoryKey: input.categoryKey,
          instantiatedRequirements: instantiatedCount,
        },
      });

      return {
        ...insertedRows[0],
        assetId,
        tag: normalizedTag,
        instantiatedRequirements: instantiatedCount,
      };
    });
  }

  /**
   * API-073: DELETE /api/v1/assets/:id
   * Soft-deletes an asset only if it has no approved documents (FR-AST-008).
   */
  async deleteOrRetireAsset(ctx: TenantActorContext, projectId: string, assetId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx, projectId);
      const { rows: approvedDocs } = await client.query(
        `SELECT da.document_id
           FROM document_assets da
           JOIN documents d
             ON d.org_id = da.org_id AND d.project_id = da.project_id AND d.id = da.document_id
          WHERE da.org_id = $1 AND da.project_id = $2 AND da.asset_id = $3
            AND d.current_approved_version_id IS NOT NULL
          LIMIT 1`,
        [ctx.orgId, projectId, assetId],
      );

      if (approvedDocs.length > 0) {
        throw new ConflictException({
          code: 'ASSET_HAS_APPROVED_DOCUMENTS',
          title: 'Equipment has approved documents',
          detail:
            'Equipment with approved documents cannot be deleted. Mark it REPLACED or RETIRED instead (FR-AST-008).',
        });
      }

      await client.query(
        `UPDATE assets
            SET status = 'RETIRED', deleted_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, assetId],
      );

      emit({
        eventType: 'ASSET_DELETED',
        projectId,
        entityType: 'ASSET',
        entityId: assetId,
      });

      return { assetId, status: 'RETIRED' };
    });
  }

  /**
   * Controller wrapper for deleteAsset
   */
  async deleteAsset(ctx: TenantActorContext, projectId: string, assetId: string, hard = false) {
    return this.deleteOrRetireAsset(ctx, projectId, assetId);
  }

  /**
   * API-070 GET /projects/:id/assets
   */
  async listAssets(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM assets
         WHERE org_id = $1 AND project_id = $2 AND deleted_at IS NULL
         ORDER BY tag ASC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * API-072 GET /projects/:projectId/assets/:id
   */
  async getAsset(ctx: TenantActorContext, projectId: string, assetId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [ctx.orgId, projectId, assetId],
      );
      if (!res.rows.length) throw new NotFoundException('ASSET_NOT_FOUND');
      return res.rows[0];
    });
  }

  /**
   * API-073 PATCH /projects/:projectId/assets/:id
   * Updates equipment attributes. If identity attributes (tag, name, make, model, serialNo, location)
   * change, records an immutable asset_identity_revisions entry and creates evidence_revalidations
   * for linked approved/ready evidence (Top 25 Item 3 / Future Domain Model §5).
   */
  async updateAsset(
    ctx: TenantActorContext,
    projectId: string,
    assetId: string,
    dto: {
      tag?: string;
      name?: string;
      make?: string;
      model?: string;
      serialNo?: string;
      location?: string;
      status?: string;
      changeType?: 'CLERICAL_CORRECTION' | 'RELOCATION' | 'SUBSTITUTION' | 'REPLACEMENT' | 'TAG_REUSE';
      reason?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx, projectId);
      // 1. Fetch current asset
      const curRes = await client.query(
        `SELECT * FROM assets WHERE org_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL FOR UPDATE`,
        [ctx.orgId, projectId, assetId],
      );
      if (!curRes.rows.length) throw new NotFoundException('ASSET_NOT_FOUND');
      const current = curRes.rows[0];

      // 2. Detect identity attribute modifications
      const tagChanged = dto.tag !== undefined && dto.tag.trim().toUpperCase() !== current.tag;
      const nameChanged = dto.name !== undefined && dto.name.trim() !== current.name;
      const makeChanged = dto.make !== undefined && dto.make.trim() !== (current.make || '');
      const modelChanged = dto.model !== undefined && dto.model.trim() !== (current.model || '');
      const serialChanged = dto.serialNo !== undefined && dto.serialNo.trim() !== (current.serial_no || '');
      const locationChanged = dto.location !== undefined && dto.location.trim() !== (current.location || '');

      const identityChanged = tagChanged || nameChanged || makeChanged || modelChanged || serialChanged || locationChanged;

      let identityRevisionMeta: any = null;

      if (identityChanged) {
        const newTag = dto.tag ? dto.tag.trim().toUpperCase() : current.tag;
        const newName = dto.name ? dto.name.trim() : current.name;
        const newMake = dto.make !== undefined ? dto.make.trim() : current.make;
        const newModel = dto.model !== undefined ? dto.model.trim() : current.model;
        const newSerial = dto.serialNo !== undefined ? dto.serialNo.trim() : current.serial_no;
        const newLocation = dto.location !== undefined ? dto.location.trim() : current.location;

        const changeType =
          dto.changeType ||
          (serialChanged || makeChanged || modelChanged
            ? 'SUBSTITUTION'
            : locationChanged
              ? 'RELOCATION'
              : 'CLERICAL_CORRECTION');

        const reason =
          dto.reason?.trim() ||
          `Identity attributes updated: ${[
            tagChanged && 'tag',
            nameChanged && 'name',
            makeChanged && 'make',
            modelChanged && 'model',
            serialChanged && 'serialNo',
            locationChanged && 'location',
          ]
            .filter(Boolean)
            .join(', ')}`;

        // Get max revision number
        const maxRevRes = await client.query(
          `SELECT COALESCE(MAX(revision_no), 0) as max_rev FROM asset_identity_revisions WHERE org_id = $1 AND asset_id = $2`,
          [ctx.orgId, assetId],
        );
        const nextRevNo = parseInt(maxRevRes.rows[0].max_rev, 10) + 1;
        const identityRevId = uuidv7();

        // Expire prior revision's effective_to if active
        await client.query(
          `UPDATE asset_identity_revisions
           SET effective_to = now()
           WHERE org_id = $1 AND asset_id = $2 AND effective_to IS NULL`,
          [ctx.orgId, assetId],
        );

        // Insert new immutable identity revision
        await client.query(
          `INSERT INTO asset_identity_revisions (
            id, org_id, project_id, asset_id, revision_no,
            tag, name, make, model, serial_no, location,
            change_type, reason, effective_from, created_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, now())`,
          [
            identityRevId,
            ctx.orgId,
            projectId,
            assetId,
            nextRevNo,
            newTag,
            newName,
            newMake,
            newModel,
            newSerial,
            newLocation,
            changeType,
            reason,
            ctx.userId,
          ],
        );

        // Find linked document versions (both direct document_assets and asset-scoped requirements)
        const linkedVersionsRes = await client.query(
          `SELECT DISTINCT dv.id
           FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id
           JOIN document_assets da ON da.document_id = d.id
           WHERE da.org_id = $1 AND da.asset_id = $2
             AND dv.file_status = 'READY'
           UNION
           SELECT DISTINCT dv.id
           FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id
           JOIN document_requirements dr ON dr.document_id = d.id
           JOIN requirements r ON r.id = dr.requirement_id
           WHERE r.org_id = $1 AND r.scope_key = ('asset:' || $2::text)
             AND dv.file_status = 'READY'`,
          [ctx.orgId, assetId],
        );

        let revalidationCount = 0;
        for (const v of linkedVersionsRes.rows) {
          await client.query(
            `INSERT INTO evidence_revalidations (
              id, org_id, project_id, asset_id, identity_revision_id, document_version_id,
              status, revalidation_notes, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, now())
            ON CONFLICT (identity_revision_id, document_version_id) DO NOTHING`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              assetId,
              identityRevId,
              v.id,
              `Triggered by identity revision #${nextRevNo} (${changeType}: ${reason})`,
            ],
          );
          revalidationCount++;
        }

        emit({
          eventType: 'ASSET_IDENTITY_REVISED',
          projectId,
          entityType: 'ASSET',
          entityId: assetId,
          afterJson: {
            revisionNo: nextRevNo,
            changeType,
            reason,
            revalidationsCreated: revalidationCount,
          },
        });

        identityRevisionMeta = {
          revisionNo: nextRevNo,
          changeType,
          reason,
          revalidationCount,
        };
      }

      // 3. Update asset record
      const res = await client.query(
        `UPDATE assets
            SET tag = COALESCE($1, tag),
                name = COALESCE($2, name),
                make = COALESCE($3, make),
                model = COALESCE($4, model),
                serial_no = COALESCE($5, serial_no),
                location = COALESCE($6, location),
                status = COALESCE($7, status),
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $8 AND project_id = $9 AND id = $10 AND deleted_at IS NULL
          RETURNING *`,
        [
          dto.tag ? dto.tag.trim().toUpperCase() : null,
          dto.name?.trim() || null,
          dto.make !== undefined ? dto.make.trim() : null,
          dto.model !== undefined ? dto.model.trim() : null,
          dto.serialNo !== undefined ? dto.serialNo.trim() : null,
          dto.location !== undefined ? dto.location.trim() : null,
          dto.status || null,
          ctx.orgId,
          projectId,
          assetId,
        ],
      );

      return {
        ...res.rows[0],
        identityRevision: identityRevisionMeta,
      };
    });
  }

  /**
   * API-077: GET /projects/:projectId/assets/:id/history
   * Returns identity revision history and evidence revalidation statuses (Top 25 Item 3).
   */
  async getAssetIdentityHistory(ctx: TenantActorContext, projectId: string, assetId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const revsRes = await client.query(
        `SELECT air.*, u.name as created_by_name
         FROM asset_identity_revisions air
         LEFT JOIN users u ON u.id = air.created_by
         WHERE air.org_id = $1 AND air.project_id = $2 AND air.asset_id = $3
         ORDER BY air.revision_no DESC`,
        [ctx.orgId, projectId, assetId],
      );

      const revalsRes = await client.query(
        `SELECT er.*, dv.version_no, dv.revision_code, d.title as doc_title, u.name as reviewer_name
         FROM evidence_revalidations er
         JOIN document_versions dv ON dv.id = er.document_version_id
         JOIN documents d ON d.id = dv.document_id
         LEFT JOIN users u ON u.id = er.reviewed_by
         WHERE er.org_id = $1 AND er.project_id = $2 AND er.asset_id = $3
         ORDER BY er.created_at DESC`,
        [ctx.orgId, projectId, assetId],
      );

      return {
        assetId,
        revisions: revsRes.rows,
        revalidations: revalsRes.rows,
      };
    });
  }

  /**
   * API-078: PATCH /projects/:projectId/assets/:id/revalidations/:revalidationId
   * Confirms, marks mismatch, or exempts affected evidence following an identity change (Finding N13, N14).
   */
  async revalidateEvidence(
    ctx: TenantActorContext,
    projectId: string,
    assetId: string,
    revalidationId: string,
    dto: { status: 'CONFIRMED' | 'MISMATCH' | 'EXEMPT'; notes?: string; expectedRowVersion?: number },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit) => {
      await this.lockEditableProject(client, ctx, projectId);
      // 1. Fetch current revalidation and ensure qualified verifier cannot self-approve (F01, V04)
      const current = await client.query(
        `SELECT er.*, dv.uploaded_by AS uploader_user_id
           FROM evidence_revalidations er
           LEFT JOIN document_versions dv ON dv.org_id = er.org_id AND dv.id = er.document_version_id
          WHERE er.org_id = $1 AND er.project_id = $2 AND er.id = $3 AND er.asset_id = $4
          FOR UPDATE OF er`,
        [ctx.orgId, projectId, revalidationId, assetId],
      );
      if (!current.rows.length) {
        throw new NotFoundException({
          code: 'REVALIDATION_RECORD_NOT_FOUND',
          detail: `Revalidation ${revalidationId} not found for asset ${assetId} in this project.`,
        });
      }
      const existing = current.rows[0];

      // Verifier cannot be the creator/uploader of the evidence version
      if (existing.uploader_user_id && existing.uploader_user_id === ctx.userId) {
        throw new ForbiddenException({
          code: 'SELF_REVALIDATION_DENIED',
          detail: 'Evidence verifier cannot be the uploader of the document version.',
        });
      }

      // Precondition requirement: expectedRowVersion is mandatory (Gap 6)
      if (dto.expectedRowVersion == null) {
        throw new ConflictException({
          code: 'PRECONDITION_REQUIRED',
          detail: 'expectedRowVersion is mandatory for revalidating evidence.',
        });
      }

      if (existing.row_version != null && existing.row_version !== dto.expectedRowVersion) {
        throw new ConflictException({
          code: 'ROW_VERSION_CONFLICT',
          detail: `Expected version ${dto.expectedRowVersion} does not match current version ${existing.row_version}.`,
        });
      }

      // Security Invariant (N13, V04, F01): Bind revalidation strictly to project and asset URL target and bump row_version
      const res = await client.query(
        `UPDATE evidence_revalidations
         SET status = $1,
             revalidation_notes = COALESCE($2, revalidation_notes),
             reviewed_by = $3,
             reviewed_at = now(),
             row_version = row_version + 1
         WHERE org_id = $4 AND project_id = $5 AND id = $6 AND asset_id = $7 AND row_version = $8
         RETURNING *`,
        [dto.status, dto.notes || null, ctx.userId, ctx.orgId, projectId, revalidationId, assetId, existing.row_version],
      );
      if (!res.rows.length) {
        throw new ConflictException({
          code: 'ROW_VERSION_CONFLICT',
          detail: 'Revalidation record was modified concurrently during commit.',
        });
      }
      const record = res.rows[0];

      // Finding N14: Mismatch status updates asset-bound revalidation record without blanket-clearing
      // current_approved_version_id for unrelated assets sharing the same generic evidence.
      emit({
        eventType: 'EVIDENCE_REVALIDATION_DECIDED',
        projectId,
        entityType: 'EVIDENCE_REVALIDATION',
        entityId: revalidationId,
        afterJson: {
          revalidationId,
          status: dto.status,
          assetId: record.asset_id,
          documentVersionId: record.document_version_id,
        },
      });

      return record;
    });
  }

  /**
   * API-075 POST /projects/:projectId/assets/import (CSV/Excel batch dry-run & insertion)
   */
  async importAssets(
    ctx: TenantActorContext,
    projectId: string,
    items: Array<{ tag: string; name: string; categoryKey: string; make?: string; model?: string; serialNo?: string; location?: string }>,
    dryRun = false,
    options: { conflictStrategy?: 'SKIP' | 'FAIL' | 'UPDATE'; atomic?: boolean } = {},
  ) {
    const conflictStrategy = options.conflictStrategy || 'SKIP';
    const isAtomic = options.atomic !== false;

    // 1. Fetch existing tags in project to detect collisions
    const existingTags = await withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT upper(tag) AS tag FROM assets WHERE org_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
        [ctx.orgId, projectId],
      );
      return new Set(rows.map((r) => r.tag));
    });

    const results: Array<{
      rowNumber: number;
      tag: string;
      status: 'VALID' | 'CONFLICT' | 'ERROR';
      conflictType?: 'TAG_EXISTS' | 'DUPLICATE_IN_FILE' | 'INVALID_TAG_FORMAT';
      error?: string;
    }> = [];

    const seenInFile = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowNumber = i + 1;

      if (!item.tag || !item.name || !item.categoryKey) {
        results.push({
          rowNumber,
          tag: item.tag || 'UNKNOWN',
          status: 'ERROR',
          error: 'Missing required fields tag, name, or categoryKey',
        });
        continue;
      }

      const normalizedTag = item.tag.trim().toUpperCase();

      if (seenInFile.has(normalizedTag)) {
        results.push({
          rowNumber,
          tag: normalizedTag,
          status: 'CONFLICT',
          conflictType: 'DUPLICATE_IN_FILE',
          error: `Tag ${normalizedTag} appears multiple times in import payload`,
        });
        continue;
      }
      seenInFile.add(normalizedTag);

      if (existingTags.has(normalizedTag)) {
        results.push({
          rowNumber,
          tag: normalizedTag,
          status: 'CONFLICT',
          conflictType: 'TAG_EXISTS',
          error: `Equipment with tag ${normalizedTag} already exists in project`,
        });
        continue;
      }

      results.push({ rowNumber, tag: normalizedTag, status: 'VALID' });
    }

    const hasErrors = results.some((r) => r.status === 'ERROR');
    const hasConflicts = results.some((r) => r.status === 'CONFLICT');

    if (dryRun) {
      return {
        dryRun: true,
        total: items.length,
        validCount: results.filter((r) => r.status === 'VALID').length,
        conflictCount: results.filter((r) => r.status === 'CONFLICT').length,
        errorCount: results.filter((r) => r.status === 'ERROR').length,
        results,
      };
    }

    if (conflictStrategy === 'FAIL' && (hasErrors || hasConflicts)) {
      throw new ConflictException({
        code: 'IMPORT_PREVALIDATION_FAILED',
        detail: 'Import contains validation errors or duplicate tags. Review results preview.',
        results,
      });
    }

    // 2. Perform Commit
    const batchId = uuidv7();
    const created: any[] = [];
    const skipped: any[] = [];
    const failed: Array<{ tag: string; error: string }> = [];

    if (isAtomic) {
      return withTenantTransaction(this.pool, ctx, async (client, emit) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const check = results[i];

          if (check.status === 'ERROR') {
            failed.push({ tag: item.tag || 'UNKNOWN', error: check.error || 'Validation error' });
            continue;
          }

          if (check.status === 'CONFLICT') {
            if (conflictStrategy === 'SKIP') {
              skipped.push({ tag: item.tag, reason: check.error });
              continue;
            }
          }

          const asset = await this.createAsset(ctx, projectId, item);
          created.push(asset);
        }

        const commitReceipt = {
          batchId,
          projectId,
          committedAt: new Date().toISOString(),
          importedCount: created.length,
          skippedCount: skipped.length,
          failedCount: failed.length,
          tagChecksum: createHash('sha256')
            .update(created.map((a) => a.tag).sort().join(','))
            .digest('hex'),
        };

        return {
          dryRun: false,
          commitReceipt,
          importedCount: created.length,
          skippedCount: skipped.length,
          failedCount: failed.length,
          assets: created,
          skipped,
          failed,
        };
      });
    }

    // Non-atomic execution
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const check = results[i];

      if (check.status === 'ERROR') {
        failed.push({ tag: item.tag || 'UNKNOWN', error: check.error || 'Validation error' });
        continue;
      }

      if (check.status === 'CONFLICT' && conflictStrategy === 'SKIP') {
        skipped.push({ tag: item.tag, reason: check.error });
        continue;
      }

      try {
        const asset = await this.createAsset(ctx, projectId, item);
        created.push(asset);
      } catch (err: any) {
        failed.push({ tag: item.tag || 'UNKNOWN', error: err.message || 'Asset creation failed' });
      }
    }

    return {
      dryRun: false,
      commitReceipt: {
        batchId,
        projectId,
        committedAt: new Date().toISOString(),
        importedCount: created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        tagChecksum: createHash('sha256')
          .update(created.map((a) => a.tag).sort().join(','))
          .digest('hex'),
      },
      importedCount: created.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      assets: created,
      skipped,
      failed,
    };
  }

  /**
   * API-076 GET /projects/:projectId/assets/export
   */
  async exportAssets(ctx: TenantActorContext, projectId: string) {
    const assets = await this.listAssets(ctx, projectId);
    return {
      projectId,
      exportedAt: new Date().toISOString(),
      count: assets.length,
      data: assets,
    };
  }

  private async instantiateAssetRequirements(
    client: PoolClient,
    ctx: TenantActorContext,
    projectId: string,
    assetId: string,
    categoryKey: string,
  ): Promise<number> {
    const { rows: snapRows } = await client.query(
      `SELECT id, resolved_payload_json
         FROM checklist_snapshots
        WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
        LIMIT 1`,
      [ctx.orgId, projectId],
    );

    if (snapRows.length === 0) return 0;

    const snapshot = snapRows[0];
    const reqDefs = (snapshot.resolved_payload_json?.requirements ?? []) as Array<any>;
    const matchingDefs = reqDefs.filter(
      (r) =>
        (r.scopeType === 'ASSET_CATEGORY' && r.assetCategoryKey === categoryKey) ||
        ((r.scope === 'A' || r.scope === 'AC') && r.assetCategoryKey === categoryKey),
    );

    const scopeKey = `asset:${assetId}`;
    let count = 0;

    for (const def of matchingDefs) {
      const reqId = uuidv7();
      await client.query(
        `INSERT INTO requirements
          (id, org_id, project_id, current_snapshot_id, requirement_key, scope_key,
           asset_id, group_key, title, description, doc_type_key, mandatory, reviewer_role, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'NOT_STARTED')
         ON CONFLICT (project_id, requirement_key, scope_key) WHERE superseded_at IS NULL
         DO NOTHING`,
        [
          reqId,
          ctx.orgId,
          projectId,
          snapshot.id,
          def.key,
          scopeKey,
          assetId,
          def.groupKey || 'EQUIPMENT_DOCS',
          def.title,
          def.description ?? null,
          def.docTypeKey || 'DT-025',
          def.mandatory ?? true,
          def.reviewerRole ?? null,
        ],
      );
      count += 1;
    }

    return count;
  }

  /**
   * API-077 GET /projects/:projectId/assets/:id/passport (TC2-034)
   * Builds the comprehensive equipment passport projection containing specification,
   * warranty timeline, commissioning evidence, defects, and audit trail.
   */
  async getEquipmentPassport(ctx: TenantActorContext, projectId: string, assetId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const assetRes = await client.query(
        `SELECT * FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL`,
        [ctx.orgId, projectId, assetId],
      );
      if (!assetRes.rows.length) {
        throw new NotFoundException({ code: 'ASSET_NOT_FOUND', detail: 'Equipment not found.' });
      }
      const asset = assetRes.rows[0];

      // 1. Linked Documents & Versions
      const { rows: docs } = await client.query(
        `SELECT d.id AS document_id, d.title, d.doc_type_key, d.category_key,
                dv.id AS version_id, dv.version_no, dv.revision_code, dv.file_status,
                dv.review_status, dv.issue_date, dv.expiry_date, so.size_bytes, so.sha256
           FROM document_assets da
           JOIN documents d ON d.id = da.document_id AND d.org_id = da.org_id
           JOIN document_versions dv ON dv.document_id = d.id AND dv.org_id = d.org_id
           LEFT JOIN storage_objects so ON so.id = dv.object_id
          WHERE da.org_id = $1 AND da.project_id = $2 AND da.asset_id = $3
            AND dv.deleted_at IS NULL
          ORDER BY dv.version_no DESC`,
        [ctx.orgId, projectId, assetId],
      );

      // 2. Linked Requirements
      const { rows: requirements } = await client.query(
        `SELECT r.id, r.requirement_key, r.title, r.status, r.mandatory, r.doc_type_key, r.due_at,
                COALESCE(qualification.has_qualified_evidence, false) AS has_qualified_evidence,
                COALESCE(qualification.has_valid_waiver, false) AS has_valid_waiver
           FROM requirements r
           LEFT JOIN LATERAL (
             SELECT
               COALESCE((
                 SELECT bool_or(
                   r.asset_id = $3 OR EXISTS (
                     SELECT 1 FROM document_assets da
                      WHERE da.org_id = r.org_id AND da.project_id = r.project_id
                        AND da.document_id = d.id AND da.asset_id = $3
                   )
                 )
                   FROM document_requirements dr
                   JOIN documents d
                     ON d.org_id = dr.org_id AND d.project_id = dr.project_id
                    AND d.id = dr.document_id AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
                   JOIN document_versions dv
                     ON dv.org_id = d.org_id AND dv.project_id = d.project_id
                    AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
                    AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                    AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                    AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                   JOIN storage_objects so
                     ON so.org_id = dv.org_id AND so.id = dv.object_id
                    AND so.status = 'READY' AND so.sha256 IS NOT NULL
                    AND so.observed_size_bytes = so.size_bytes
                    AND so.provider_version_id IS NOT NULL
                  WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id
                    AND dr.requirement_id = r.id
                    AND NOT EXISTS (
                      SELECT 1 FROM evidence_revalidations er
                       WHERE er.org_id = dv.org_id AND er.project_id = dv.project_id
                         AND er.document_version_id = dv.id
                         AND er.asset_id = $3
                         AND er.status IN ('PENDING', 'MISMATCH')
                    )
               ), false) AS has_qualified_evidence,
               EXISTS (
                 SELECT 1 FROM waivers w
                  WHERE w.org_id = r.org_id AND w.project_id = r.project_id
                    AND w.requirement_id = r.id AND w.status = 'ACTIVE'
                    AND w.type IN ('WAIVE', 'NOT_APPLICABLE')
                    AND (r.mandatory = false OR (
                      w.second_approved_by IS NOT NULL AND w.second_approved_by <> w.approved_by
                    ))
               ) AS has_valid_waiver
           ) qualification ON true
          WHERE r.org_id = $1 AND r.project_id = $2 AND (r.asset_id = $3 OR r.id IN (
            SELECT dr.requirement_id FROM document_requirements dr
            JOIN document_assets da ON da.document_id = dr.document_id
            WHERE da.asset_id = $3 AND da.org_id = $1
          ))
            AND r.superseded_at IS NULL
          ORDER BY r.requirement_key ASC`,
        [ctx.orgId, projectId, assetId],
      );

      // 3. Warranty Events
      const { rows: warrantyEvents } = await client.query(
        `SELECT * FROM warranty_events
          WHERE org_id = $1 AND project_id = $2 AND asset_id = $3
          ORDER BY registered_at DESC`,
        [ctx.orgId, projectId, assetId],
      );

      // 4. Defects
      const { rows: defects } = await client.query(
        `SELECT d.*, u.name AS raised_by_name
           FROM defects d
           LEFT JOIN users u ON u.id = d.raised_by
          WHERE d.org_id = $1 AND d.project_id = $2 AND d.asset_id = $3
          ORDER BY d.raised_at DESC`,
        [ctx.orgId, projectId, assetId],
      );

      // 5. Asset Identity Revisions (XP13)
      const { rows: identityRevisions } = await client.query(
        `SELECT id, revision_no, tag, name, make, model, serial_no, location, change_type, reason,
                effective_from, effective_to, created_at
           FROM asset_identity_revisions
          WHERE org_id = $1 AND project_id = $2 AND asset_id = $3
          ORDER BY revision_no DESC`,
        [ctx.orgId, projectId, assetId],
      );

      // 6. Evidence Revalidations (XP13 / Gap 1)
      const { rows: revalidations } = await client.query(
        `SELECT er.id, er.scope_key, air.reason, er.status, er.revalidation_notes AS notes,
                dv.uploaded_by AS uploader_user_id,
                er.reviewed_by AS verified_by, er.reviewed_at AS verified_at,
                er.created_at, u.name AS verified_by_name
           FROM evidence_revalidations er
           LEFT JOIN asset_identity_revisions air ON air.id = er.identity_revision_id
           LEFT JOIN document_versions dv ON dv.id = er.document_version_id
           LEFT JOIN users u ON u.id = er.reviewed_by
          WHERE er.org_id = $1 AND er.project_id = $2 AND er.asset_id = $3
          ORDER BY er.created_at DESC`,
        [ctx.orgId, projectId, assetId],
      );

      // 7. Upstream Procurement Order Lines (XP15)
      const { rows: procurementLines } = await client.query(
        `SELECT pol.id, pol.line_no, pol.asset_category_key, pol.description, pol.quantity, pol.make, pol.model,
                po.id AS po_id, po.po_number, po.status AS po_status, po.ordered_at, po.promised_delivery_at,
                p.name AS supplier_name
           FROM procurement_order_lines pol
           JOIN procurement_orders po ON po.id = pol.po_id AND po.org_id = pol.org_id
           LEFT JOIN parties p ON p.id = po.supplier_party_id
          WHERE pol.org_id = $1 AND pol.project_id = $2 AND pol.asset_id = $3`,
        [ctx.orgId, projectId, assetId],
      );

      // Compute warranty status & remaining days
      const now = new Date();
      let isUnderWarranty = false;
      let remainingWarrantyDays = 0;
      if (asset.warranty_end) {
        const endDate = new Date(asset.warranty_end);
        const diffMs = endDate.getTime() - now.getTime();
        remainingWarrantyDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        isUnderWarranty = diffMs > 0;
      }

      const approvedDocs = docs.filter((d) => d.review_status === 'APPROVED');
      const openDefects = defects.filter((d) => d.status === 'OPEN');
      const criticalDefects = openDefects.filter((d) => d.severity === 'CRITICAL' || d.severity === 'HIGH');
      const mandatoryReqs = requirements.filter((r) => r.mandatory);
      const satisfiedReqs = mandatoryReqs.filter((r) => r.has_qualified_evidence === true || r.has_valid_waiver === true);

      const readinessPercentage =
        mandatoryReqs.length > 0
          ? Math.round((satisfiedReqs.length / mandatoryReqs.length) * 100)
          : 100;

      // Deterministic QR verification payload for physical label scanning
      const qrPayload = {
        assetId: asset.id,
        projectId,
        tag: asset.tag,
        serialNo: asset.serial_no || null,
        categoryKey: asset.category_key,
        passportUrl: `/projects/${projectId}/assets/${asset.id}/passport`,
        verifyUrl: `/guest/verify/assets/${asset.id}`,
        signatureSha256: createHash('sha256')
          .update(`${ctx.orgId}:${projectId}:${asset.id}:${asset.tag}:${asset.serial_no || ''}`)
          .digest('hex'),
      };

      return {
        asset,
        qrCode: qrPayload,
        warranty: {
          start: asset.warranty_start,
          end: asset.warranty_end,
          basis: asset.warranty_start_basis,
          isUnderWarranty,
          remainingDays: remainingWarrantyDays,
          events: warrantyEvents,
        },
        readiness: {
          readinessPercentage,
          totalRequirements: requirements.length,
          satisfiedRequirementsCount: satisfiedReqs.length,
          mandatoryCount: mandatoryReqs.length,
          linkedDocumentsCount: docs.length,
          approvedDocumentsCount: approvedDocs.length,
          openDefectsCount: openDefects.length,
          criticalDefectsCount: criticalDefects.length,
          isDlpReady: openDefects.length === 0 && (mandatoryReqs.length === 0 || satisfiedReqs.length === mandatoryReqs.length),
        },
        requirements,
        documents: docs,
        defects,
        identityRevisions,
        revalidations,
        procurement: procurementLines,
      };
    });
  }

  /**
   * API-079: POST /projects/:projectId/assets/match-candidates
   * Deterministic equipment candidate matching based on filename, tokens, and serial dictionaries (Top 25 Item 21).
   * Generates suggestions with confidence scoring for human confirmation without auto-attaching or fabricating links.
   */
  async matchAssetCandidates(
    ctx: TenantActorContext,
    projectId: string,
    query: { filename?: string; text?: string; tagCandidate?: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: assetList } = await client.query(
        `SELECT id, tag, name, category_key, make, model, serial_no, location
         FROM assets
         WHERE org_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
        [ctx.orgId, projectId],
      );

      const targetText = [query.filename, query.text, query.tagCandidate]
        .filter(Boolean)
        .join(' ')
        .toUpperCase();

      const candidates: Array<{
        assetId: string;
        tag: string;
        name: string;
        make: string | null;
        model: string | null;
        serialNo: string | null;
        matchScore: number;
        matchBasis: 'EXACT_TAG' | 'SERIAL_NUMBER' | 'MODEL' | 'TAG_SUBSTRING';
        confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      }> = [];

      for (const a of assetList) {
        const upperTag = a.tag.toUpperCase();
        const upperSerial = a.serial_no ? a.serial_no.toUpperCase() : null;
        const upperModel = a.model ? a.model.toUpperCase() : null;

        // 1. Exact Tag Boundary Match (e.g. "CH-01")
        const tagRegex = new RegExp(`(^|[^A-Z0-9])${upperTag}([^A-Z0-9]|$)`, 'i');
        if (tagRegex.test(targetText)) {
          candidates.push({
            assetId: a.id,
            tag: a.tag,
            name: a.name,
            make: a.make,
            model: a.model,
            serialNo: a.serial_no,
            matchScore: 1.0,
            matchBasis: 'EXACT_TAG',
            confidence: 'HIGH',
          });
          continue;
        }

        // 2. Serial Number Match
        if (upperSerial && upperSerial.length >= 4 && targetText.includes(upperSerial)) {
          candidates.push({
            assetId: a.id,
            tag: a.tag,
            name: a.name,
            make: a.make,
            model: a.model,
            serialNo: a.serial_no,
            matchScore: 0.95,
            matchBasis: 'SERIAL_NUMBER',
            confidence: 'HIGH',
          });
          continue;
        }

        // 3. Model Match
        if (upperModel && upperModel.length >= 4 && targetText.includes(upperModel)) {
          candidates.push({
            assetId: a.id,
            tag: a.tag,
            name: a.name,
            make: a.make,
            model: a.model,
            serialNo: a.serial_no,
            matchScore: 0.8,
            matchBasis: 'MODEL',
            confidence: 'MEDIUM',
          });
          continue;
        }

        // 4. Substring Tag Match
        if (targetText.includes(upperTag)) {
          candidates.push({
            assetId: a.id,
            tag: a.tag,
            name: a.name,
            make: a.make,
            model: a.model,
            serialNo: a.serial_no,
            matchScore: 0.65,
            matchBasis: 'TAG_SUBSTRING',
            confidence: 'LOW',
          });
        }
      }

      candidates.sort((a, b) => b.matchScore - a.matchScore);

      return {
        query: { filename: query.filename, tagCandidate: query.tagCandidate },
        totalMatches: candidates.length,
        candidates: candidates.slice(0, 10),
      };
    });
  }
}
