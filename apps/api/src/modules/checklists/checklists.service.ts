// apps/api/src/modules/checklists/checklists.service.ts
// Dual-approver mandatory waivers & requirements lifecycle (RT-023, CB-004)

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { RequirementStatus, WaiverStatus } from '@tradecloseout/shared';

@Injectable()
export class ChecklistsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-061 POST /requirements/:id/waivers (RT-023, CB-004)
   */
  async requestWaiver(
    ctx: ExecutionContext,
    requirementId: string,
    reason: string,
    type: 'WAIVE' | 'NOT_APPLICABLE' = 'WAIVE',
  ) {
    if (!reason || reason.trim().length < 10) {
      throw new ConflictException('REASON_TOO_SHORT: Minimum 10 characters required');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const reqRes = await client.query(
        `SELECT * FROM requirements WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, requirementId],
      );
      if (!reqRes.rows.length) {
        throw new NotFoundException('REQUIREMENT_NOT_FOUND');
      }
      const req = reqRes.rows[0];
      const waiverId = uuidv7();

      if (req.mandatory) {
        // Mandatory requirement requires dual approval (RT-023, CB-004)
        await client.query(
          `INSERT INTO waivers (
            id, org_id, project_id, requirement_id, type, is_mandatory_item,
            reason, requested_by, approved_by, status
          ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $7, $8)`,
          [
            waiverId,
            ctx.orgId,
            req.project_id,
            req.id,
            type,
            reason,
            ctx.userId,
            WaiverStatus.PENDING_SECOND_APPROVAL,
          ],
        );

        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE org_id = $2 AND id = $3`,
          [RequirementStatus.PENDING_WAIVER, ctx.orgId, req.id],
        );

        return { waiverId, status: WaiverStatus.PENDING_SECOND_APPROVAL, requirementStatus: RequirementStatus.PENDING_WAIVER };
      } else {
        // Non-mandatory single approval: second_approved_by is null (CB-004)
        await client.query(
          `INSERT INTO waivers (
            id, org_id, project_id, requirement_id, type, is_mandatory_item,
            reason, requested_by, approved_by, second_approved_by, status
          ) VALUES ($1, $2, $3, $4, $5, false, $6, $7, $7, NULL, $8)`,
          [
            waiverId,
            ctx.orgId,
            req.project_id,
            req.id,
            type,
            reason,
            ctx.userId,
            WaiverStatus.ACTIVE,
          ],
        );

        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE org_id = $2 AND id = $3`,
          [RequirementStatus.WAIVED, ctx.orgId, req.id],
        );

        return { waiverId, status: WaiverStatus.ACTIVE, requirementStatus: RequirementStatus.WAIVED };
      }
    });
  }

  /**
   * API-061A POST /waivers/:id/countersign (RT-023, CB-004)
   */
  async countersignWaiver(
    ctx: ExecutionContext,
    waiverId: string,
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const waiverRes = await client.query(
        `SELECT * FROM waivers WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, waiverId],
      );
      if (!waiverRes.rows.length) {
        throw new NotFoundException('WAIVER_NOT_FOUND');
      }
      const waiver = waiverRes.rows[0];

      if (waiver.status !== WaiverStatus.PENDING_SECOND_APPROVAL) {
        throw new ConflictException('WAIVER_NOT_PENDING_SECOND_APPROVAL');
      }

      // Second approver must be different from first approver
      if (waiver.approved_by === ctx.userId) {
        throw new ForbiddenException('SECOND_APPROVER_MUST_BE_DISTINCT: Approver cannot countersign own waiver');
      }

      // Mark waiver ACTIVE with second_approved_by and second_approved_at (CB-004)
      await client.query(
        `UPDATE waivers
         SET second_approved_by = $1, second_approved_at = now(), status = $2
         WHERE org_id = $3 AND id = $4`,
        [ctx.userId, WaiverStatus.ACTIVE, ctx.orgId, waiver.id],
      );

      // Transition requirement to WAIVED
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
  async listRequirements(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM requirements
         WHERE org_id = $1 AND project_id = $2 AND superseded_at IS NULL
         ORDER BY milestone_key ASC, title ASC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * POST /projects/:projectId/requirements
   */
  async createRequirement(
    ctx: ExecutionContext,
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
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Ensure a snapshot exists for this project
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

      // 2. Insert requirement conforming to composite foreign keys
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
}
