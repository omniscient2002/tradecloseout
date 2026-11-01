// apps/api/src/modules/notifications/notifications.service.ts
// IST Quiet Hours, Deduplication & Rupee-at-Risk Owner Digest (FR-NOT-001..014, RT-029)

import { Injectable, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Checks whether the current time falls within IST quiet hours (22:00 - 08:00 IST)
   */
  isIstQuietHour(date: Date = new Date()): boolean {
    const istString = date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const hour = parseInt(istString.split(', ')[1].split(':')[0], 10);
    return hour >= 22 || hour < 8;
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
      const status = shouldDefer ? 'QUEUED' : 'SENT';
      const sentAt = shouldDefer ? null : new Date();

      const res = await client.query(
        `INSERT INTO notifications (
          id, org_id, project_id, recipient_user_id, channel, event_key, payload_json, status, dedup_key, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id))
        DO UPDATE SET payload_json = EXCLUDED.payload_json
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
         WHERE org_id = $1 AND (recipient_user_id = $2 OR channel = 'IN_APP')
         ORDER BY created_at DESC LIMIT 50`,
        [ctx.orgId, ctx.userId],
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

      const contractValueInr = proj.site_json?.contract_value_inr || 15000000; // default ₹1.5 Cr
      const retentionPercent = proj.site_json?.retention_percent || 5.0; // 5%
      const retentionMoneyGatedInr = (contractValueInr * retentionPercent) / 100;

      return {
        projectId: proj.id,
        projectCode: proj.code,
        projectName: proj.name,
        currency: 'INR',
        contractValueInr,
        retentionMoneyGatedInr,
        blockingRequirementsByMilestone: reqRes.rows,
        generatedAt: new Date(),
        recipientRole: 'R-OWNER',
      };
    });
  }
}
