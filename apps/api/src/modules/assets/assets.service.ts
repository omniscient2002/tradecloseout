// apps/api/src/modules/assets/assets.service.ts
// Equipment / Assets Service with Dynamic Requirement Instantiation (API-070..076, WF-07, FR-AST-001..012, AUD-002)

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
   */
  async updateAsset(
    ctx: TenantActorContext,
    projectId: string,
    assetId: string,
    dto: { name?: string; make?: string; model?: string; serialNo?: string; location?: string; status?: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE assets
            SET name = COALESCE($1, name),
                make = COALESCE($2, make),
                model = COALESCE($3, model),
                serial_no = COALESCE($4, serial_no),
                location = COALESCE($5, location),
                status = COALESCE($6, status),
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $7 AND project_id = $8 AND id = $9 AND deleted_at IS NULL
          RETURNING *`,
        [
          dto.name?.trim(),
          dto.make?.trim(),
          dto.model?.trim(),
          dto.serialNo?.trim(),
          dto.location?.trim(),
          dto.status,
          ctx.orgId,
          projectId,
          assetId,
        ],
      );
      if (!res.rows.length) throw new NotFoundException('ASSET_NOT_FOUND');
      return res.rows[0];
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
  ) {
    const results: Array<{ tag: string; status: 'VALID' | 'CREATED' | 'ERROR'; error?: string }> = [];

    for (const item of items) {
      if (!item.tag || !item.name || !item.categoryKey) {
        results.push({ tag: item.tag || 'UNKNOWN', status: 'ERROR', error: 'Missing required fields tag, name, or categoryKey' });
        continue;
      }
      results.push({ tag: item.tag.trim().toUpperCase(), status: 'VALID' });
    }

    if (dryRun) {
      return { dryRun: true, total: items.length, results };
    }

    const created: any[] = [];
    for (const item of items) {
      try {
        const asset = await this.createAsset(ctx, projectId, item);
        created.push(asset);
      } catch (err: any) {
        // Skip errored or log
      }
    }

    return { dryRun: false, importedCount: created.length, assets: created };
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
           group_key, title, description, doc_type_key, mandatory, reviewer_role, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'NOT_STARTED')
         ON CONFLICT (project_id, requirement_key, scope_key) WHERE superseded_at IS NULL
         DO NOTHING`,
        [
          reqId,
          ctx.orgId,
          projectId,
          snapshot.id,
          def.key,
          scopeKey,
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
}
