// apps/api/src/modules/notifications/notifications.service.ts
// IST Quiet Hours, Deduplication & Rupee-at-Risk Owner Digest (FR-NOT-001..014, RT-029)

import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
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

  /** Canonical equality rejects attempts to reuse a notification identity with new meaning. */
  private canonicalNotificationJson(value: unknown): string {
    const sort = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(sort);
      if (entry && typeof entry === 'object') {
        return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, sort(val)]));
      }
      return entry;
    };
    return JSON.stringify(sort(value));
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
    // PH2-G20-001: external delivery is an internal template-only workflow.
    // A user cannot turn arbitrary JSON into an email or SMS by changing channel.
    if (dto.channel !== 'IN_APP') {
      throw new ServiceUnavailableException({
        code: 'EXTERNAL_NOTIFICATION_TEMPLATES_REQUIRED',
        detail: 'External notifications require a reviewed server-owned event template.',
      });
    }
    if (typeof dto.eventKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(dto.eventKey) ||
        typeof dto.dedupKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(dto.dedupKey) ||
        !dto.payload || Array.isArray(dto.payload) || typeof dto.payload !== 'object' ||
        (dto.projectId !== undefined && (typeof dto.projectId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(dto.projectId)))) {
      throw new UnprocessableEntityException({ code: 'INVALID_NOTIFICATION_INPUT' });
    }
    const canonicalPayload = this.canonicalNotificationJson(dto.payload);
    if (Buffer.byteLength(canonicalPayload, 'utf8') > 4096) {
      throw new UnprocessableEntityException({ code: 'NOTIFICATION_PAYLOAD_TOO_LARGE' });
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // PH2-G20-002: a global POST guard cannot authorize a project ID
      // carried only in the body. Recheck membership under the same transaction.
      if (dto.projectId) {
        const { rows: projects } = await client.query(
          `SELECT id FROM projects
            WHERE org_id = $1 AND id = $2 AND purged_at IS NULL
            FOR SHARE`,
          [ctx.orgId, dto.projectId],
        );
        if (!projects.length) throw new NotFoundException('PROJECT_NOT_FOUND');
        if (ctx.orgRole !== 'R-OWNER' && ctx.orgRole !== 'R-ADMIN') {
          const { rows: members } = await client.query(
            `SELECT 1 FROM project_members
              WHERE org_id = $1 AND project_id = $2 AND user_id = $3
                AND status = 'ACTIVE' FOR SHARE`,
            [ctx.orgId, dto.projectId, ctx.userId],
          );
          if (!members.length) throw new NotFoundException('PROJECT_NOT_FOUND');
        }
      }

      const { rows: inserted } = await client.query(
        `INSERT INTO notifications (
          id, org_id, project_id, recipient_user_id, channel, event_key,
          payload_json, status, dedup_key, sent_at, gateway_state
        ) VALUES ($1, $2, $3, $4, 'IN_APP', $5, $6, 'SENT', $7, now(), 'DELIVERED')
        ON CONFLICT (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id))
        DO NOTHING RETURNING *`,
        [uuidv7(), ctx.orgId, dto.projectId ?? null, ctx.userId,
          dto.eventKey, canonicalPayload, dto.dedupKey],
      );
      if (inserted.length) return { notification: inserted[0], deferredForQuietHours: false };

      const { rows: existing } = await client.query(
        `SELECT * FROM notifications
          WHERE org_id = $1 AND dedup_key = $2 AND channel = 'IN_APP'
            AND recipient_user_id = $3 FOR SHARE`,
        [ctx.orgId, dto.dedupKey, ctx.userId],
      );
      const previous = existing[0];
      const previousPayload = typeof previous?.payload_json === 'string'
        ? JSON.parse(previous.payload_json) : previous?.payload_json;
      if (!previous || previous.project_id !== (dto.projectId ?? null) ||
          previous.event_key !== dto.eventKey ||
          this.canonicalNotificationJson(previousPayload) !== canonicalPayload) {
        throw new ConflictException({
          code: 'NOTIFICATION_DEDUP_CONFLICT',
          detail: 'A notification key was reused with different content or scope.',
        });
      }
      // The first event wins; retries may not rewrite delivered content.
      return { notification: previous, deferredForQuietHours: false };
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
