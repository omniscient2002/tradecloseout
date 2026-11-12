// apps/api/src/modules/notifications/notifications.service.ts
// IST Quiet Hours, Deduplication & Rupee-at-Risk Owner Digest (FR-NOT-001..014, RT-029)

import { Injectable, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { isIndiaQuietHour } from '@tradecloseout/shared';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Checks whether the current time falls within IST quiet hours (22:00 - 08:00 IST)
   */
  isIstQuietHour(date: Date = new Date()): boolean {
    return isIndiaQuietHour(date);
  }

  /**
   * API-130 POST /notifications (Deduplicated with quiet hour deferral)
   */
  async createNotification(
    ctx: ExecutionContext,
    dto: {
      projectId?: string;
      channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
      eventKey: string;
      payload: Record<string, any>;
      dedupKey: string;
      isUrgent?: boolean;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const isQuiet = this.isIstQuietHour();
      const shouldDefer = (dto.channel === 'SMS' || dto.channel === 'WHATSAPP') && isQuiet && !dto.isUrgent;

      const notificationId = uuidv7();
      // External channels without active delivery provider adapters must be recorded as QUEUED,
      // never falsely reported as SENT (TC-F017 / Sol Part A1). IN_APP notifications are delivered in-app.
      const isExternal = dto.channel === 'SMS' || dto.channel === 'WHATSAPP' || dto.channel === 'EMAIL';
      const status = isExternal ? 'QUEUED' : (shouldDefer ? 'QUEUED' : 'SENT');
      const sentAt = status === 'SENT' ? new Date() : null;

      const res = await client.query(
        `INSERT INTO notifications (
          id, org_id, project_id, recipient_user_id, channel, event_key, payload_json, status, dedup_key, sent_at, gateway_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id))
        -- A duplicate producer may not rewrite content already dispatched or
        -- claimed by a worker. Provider idempotency is bound to the row ID.
        DO UPDATE SET payload_json = CASE
          WHEN notifications.status='QUEUED' AND notifications.delivery_attempts=0
               AND notifications.claim_token IS NULL THEN EXCLUDED.payload_json
          ELSE notifications.payload_json END
        RETURNING *`,
        [
          notificationId,
          ctx.orgId,
          dto.projectId || null,
          ctx.userId,
          dto.channel,
          dto.eventKey,
          JSON.stringify(dto.payload),
          status,
          dto.dedupKey,
          sentAt,
          isExternal ? 'PENDING' : 'DELIVERED',
        ],
      );

      return {
        notification: res.rows[0],
        deferredForQuietHours: shouldDefer,
      };
    });
  }

  /**
   * API-131 GET /notifications
   */
  async listNotifications(ctx: ExecutionContext) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM notifications
         WHERE org_id = $1 AND recipient_user_id = $2
           AND (
             project_id IS NULL OR
             EXISTS (
               SELECT 1 FROM projects p
                WHERE p.org_id = notifications.org_id
                  AND p.id = notifications.project_id
                  AND p.purged_at IS NULL
                  AND (
                    $3::boolean OR EXISTS (
                      SELECT 1 FROM project_members pm
                       WHERE pm.org_id = p.org_id AND pm.project_id = p.id
                         AND pm.user_id = $2 AND pm.status = 'ACTIVE'
                    )
                  )
             )
           )
         ORDER BY created_at DESC LIMIT 50`,
        [ctx.orgId, ctx.userId, ctx.orgRole === 'R-OWNER' || ctx.orgRole === 'R-ADMIN'],
      );
      return res.rows;
    });
  }

  /**
   * Weekly Rupee-at-Risk Owner Digest (BR-GTM-07, RT-029)
   */
  async getOwnerDigest(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new BadRequestException('PROJECT_NOT_FOUND');
      }
      const proj = projRes.rows[0];

      // Fetch blocking requirements grouped by milestone
      const reqRes = await client.query(
        `SELECT milestone_key, count(*) as count
         FROM requirements
         WHERE org_id = $1 AND project_id = $2 AND mandatory = true AND status IN ('NOT_STARTED', 'MISSING', 'EXPIRED', 'CHANGES_REQUESTED')
         GROUP BY milestone_key`,
        [ctx.orgId, projectId],
      );

      // Contract value in paise (integer) and retention basis points from project columns (T19, Finding N21)
      const contractValuePaise = proj.contract_value_paise != null
        ? BigInt(proj.contract_value_paise)
        : (proj.site_json?.contract_value_inr != null ? BigInt(Math.round(Number(proj.site_json.contract_value_inr) * 100)) : null);

      const retentionBps = proj.retention_bps != null
        ? Number(proj.retention_bps)
        : (proj.site_json?.retention_percent != null ? Math.round(Number(proj.site_json.retention_percent) * 100) : null);

      const retentionMoneyGatedPaise = contractValuePaise != null && retentionBps != null
        ? (contractValuePaise * BigInt(retentionBps)) / 10000n
        : null;

      const contractValueInr = contractValuePaise != null
        ? Number(contractValuePaise) / 100
        : null;

      const retentionMoneyGatedInr = retentionMoneyGatedPaise != null
        ? Number(retentionMoneyGatedPaise) / 100
        : null;

      return {
        projectId: proj.id,
        projectCode: proj.code,
        projectName: proj.name,
        currency: 'INR',
        contractValuePaise: contractValuePaise?.toString() || null,
        contractValueInr,
        retentionMoneyGatedPaise: retentionMoneyGatedPaise?.toString() || null,
        retentionMoneyGatedInr,
        blockingRequirementsByMilestone: reqRes.rows,
        generatedAt: new Date(),
        recipientRole: 'R-OWNER',
      };
    });
  }
}
