// apps/api/src/modules/assets/assets.service.ts
// Asset Register, Dynamic Requirement Instantiation & CSV Import/Export (API-070..076, RT-003, WF-07, FR-AST-006, FR-AST-008, CB-002)

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { RequirementStatus } from '@tradecloseout/shared';

@Injectable()
export class AssetsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-071 POST /projects/:id/assets
   */
  async createAsset(
    ctx: ExecutionContext,
    projectId: string,
    dto: { tag: string; name: string; categoryKey: string; make?: string; model?: string; serialNo?: string; location?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const assetId = uuidv7();

      // 1. Insert Asset strictly matching SQL schema (CB-002)
      const insertRes = await client.query(
        `INSERT INTO assets (
          id, org_id, project_id, tag, name, category_key,
          make, model, serial_no, location, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11)
        RETURNING *`,
        [
          assetId,
          ctx.orgId,
          projectId,
          dto.tag.trim().toUpperCase(),
          dto.name.trim(),
          dto.categoryKey,
          dto.make || null,
          dto.model || null,
          dto.serialNo || null,
          dto.location || null,
          ctx.userId,
        ],
      );
      const asset = insertRes.rows[0];

      // 2. Dynamic requirement expansion for asset-scoped items (RT-003, WF-07, CB-002)
      const snapshotRes = await client.query(
        `SELECT id, resolved_payload_json FROM checklist_snapshots
         WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [ctx.orgId, projectId],
      );

      if (snapshotRes.rows.length) {
        const snapshotId = snapshotRes.rows[0].id;
        const payload = snapshotRes.rows[0].resolved_payload_json;
        const reqDefs = payload.requirements || [];

        for (const def of reqDefs) {
          if ((def.scope === 'A' || def.scope === 'AC') && def.assetCategoryKey === dto.categoryKey) {
            const reqId = uuidv7();
            await client.query(
              `INSERT INTO requirements (
                id, org_id, project_id, current_snapshot_id, asset_id, scope_key,
                requirement_key, group_key, title, doc_type_key, mandatory, milestone_key, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                reqId,
                ctx.orgId,
                projectId,
                snapshotId,
                asset.id,
                `asset:${asset.id}`,
                `${def.key}:${asset.tag}`,
                def.groupKey || 'EQUIPMENT_DOCS',
                `${def.title} — ${asset.tag}`,
                def.docTypeKey || 'DT-025',
                def.mandatory ?? true,
                def.milestoneKey || 'INSTALLATION',
                RequirementStatus.NOT_STARTED,
              ],
            );
          }
        }
      }

      return asset;
    });
  }

  /**
   * API-070 GET /projects/:id/assets
   */
  async listAssets(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
  async getAsset(ctx: ExecutionContext, projectId: string, assetId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
    ctx: ExecutionContext,
    projectId: string,
    assetId: string,
    dto: { name?: string; make?: string; model?: string; serialNo?: string; location?: string; status?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
   * API-074 DELETE /projects/:projectId/assets/:id (FR-AST-006, FR-AST-008, TC-AST-02)
   */
  async deleteAsset(ctx: ExecutionContext, projectId: string, assetId: string, hard = false) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // TC-AST-02: Hard-deleting an asset with approved documents is blocked
      const docRes = await client.query(
        `SELECT d.id FROM document_assets da
           JOIN documents d ON d.id = da.document_id
          WHERE da.org_id = $1 AND da.project_id = $2 AND da.asset_id = $3
            AND d.current_approved_version_id IS NOT NULL LIMIT 1`,
        [ctx.orgId, projectId, assetId],
      );

      if (docRes.rows.length > 0 && hard) {
        throw new ConflictException({
          code: 'CANNOT_HARD_DELETE_ASSET_WITH_APPROVED_DOCS',
          title: 'Asset has approved handover documents',
          detail: 'This asset is associated with approved closeout documents. Use retirement or soft-delete instead.',
        });
      }

      // Soft delete preserves historical documents and lineage (FR-AST-008)
      const res = await client.query(
        `UPDATE assets
            SET deleted_at = now(), status = 'RETIRED', updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL
          RETURNING *`,
        [ctx.orgId, projectId, assetId],
      );

      if (!res.rows.length) throw new NotFoundException('ASSET_NOT_FOUND');
      return { success: true, assetId };
    });
  }

  /**
   * API-075 POST /projects/:projectId/assets/import (CSV/Excel batch dry-run & insertion)
   */
  async importAssets(
    ctx: ExecutionContext,
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
        // Continue or report error
      }
    }

    return { dryRun: false, importedCount: created.length, assets: created };
  }

  /**
   * API-076 GET /projects/:projectId/assets/export
   */
  async exportAssets(ctx: ExecutionContext, projectId: string) {
    const assets = await this.listAssets(ctx, projectId);
    return {
      projectId,
      exportedAt: new Date().toISOString(),
      count: assets.length,
      data: assets,
    };
  }
}
