// apps/api/src/modules/checklists/checklists.service.ts
// Dual-approver mandatory waivers & requirements lifecycle (RT-023)

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
   * API-061 POST /requirements/:id/waivers (RT-023)
   */
  async requestWaiver(
    ctx: ExecutionContext,
    requirementId: string,
    reason: string,
  ) {
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
        // Mandatory requirement requires dual approval (RT-023)
        await client.query(
          `INSERT INTO waivers (
            id, org_id, project_id, requirement_id, reason,
            approved_by_user_id, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [waiverId, ctx.orgId, req.project_id, req.id, reason, ctx.userId, WaiverStatus.PENDING_SECOND_APPROVAL],
        );

        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE id = $2`,
          [RequirementStatus.PENDING_WAIVER, req.id],
        );

        return { waiverId, status: WaiverStatus.PENDING_SECOND_APPROVAL, requirementStatus: RequirementStatus.PENDING_WAIVER };
      } else {
        // Non-mandatory single approval
        await client.query(
          `INSERT INTO waivers (
            id, org_id, project_id, requirement_id, reason,
            approved_by_user_id, second_approved_by_user_id, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
          [waiverId, ctx.orgId, req.project_id, req.id, reason, ctx.userId, WaiverStatus.ACTIVE],
        );

        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE id = $2`,
          [RequirementStatus.WAIVED, req.id],
        );

        return { waiverId, status: WaiverStatus.ACTIVE, requirementStatus: RequirementStatus.WAIVED };
      }
    });
  }

  /**
   * API-061A POST /waivers/:id/countersign (RT-023)
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
      if (waiver.approved_by_user_id === ctx.userId) {
        throw new ForbiddenException('SECOND_APPROVER_MUST_BE_DISTINCT');
      }

      // Mark waiver ACTIVE
      await client.query(
        `UPDATE waivers
         SET second_approved_by_user_id = $1, status = $2
         WHERE id = $3`,
        [ctx.userId, WaiverStatus.ACTIVE, waiver.id],
      );

      // Transition requirement to WAIVED
      await client.query(
        `UPDATE requirements
         SET status = $1, updated_at = now(), row_version = row_version + 1
         WHERE id = $2`,
        [RequirementStatus.WAIVED, waiver.requirement_id],
      );

      return { waiverId: waiver.id, status: WaiverStatus.ACTIVE, requirementStatus: RequirementStatus.WAIVED };
    });
  }
}
