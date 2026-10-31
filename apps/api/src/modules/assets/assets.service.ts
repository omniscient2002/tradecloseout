// apps/api/src/modules/assets/assets.service.ts
// Asset Register & Dynamic Requirement Instantiation (RT-003, WF-07, FR-AST-006)

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
    dto: { tag: string; description: string; categoryKey: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const assetId = uuidv7();

      // 1. Insert Asset
      const insertRes = await client.query(
        `INSERT INTO assets (id, org_id, project_id, tag, description, category_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         RETURNING *`,
        [assetId, ctx.orgId, projectId, dto.tag, dto.description, dto.categoryKey],
      );
      const asset = insertRes.rows[0];

      // 2. Dynamic requirement expansion for asset-scoped items (RT-003, WF-07)
      const snapshotRes = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
         WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [ctx.orgId, projectId],
      );

      if (snapshotRes.rows.length) {
        const payload = snapshotRes.rows[0].resolved_payload_json;
        const reqDefs = payload.requirements || [];

        for (const def of reqDefs) {
          if ((def.scope === 'A' || def.scope === 'AC') && def.assetCategoryKey === dto.categoryKey) {
            const reqId = uuidv7();
            await client.query(
              `INSERT INTO requirements (
                id, org_id, project_id, asset_id, scope_key, requirement_key,
                title, doc_type_key, mandatory, milestone_key, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                reqId,
                ctx.orgId,
                projectId,
                asset.id,
                `asset:${asset.id}`,
                `${def.key}:${asset.tag}`,
                `${def.title} — ${asset.tag}`,
                def.docTypeKey || 'DT-025',
                def.mandatory || false,
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
}
