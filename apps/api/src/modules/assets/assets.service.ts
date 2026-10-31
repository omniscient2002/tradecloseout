// apps/api/src/modules/assets/assets.service.ts
// Asset Register & Dynamic Requirement Instantiation (RT-003, WF-07, FR-AST-006, CB-002)

import { Injectable, NotFoundException } from '@nestjs/common';
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
          dto.tag,
          dto.name,
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
}
