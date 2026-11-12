// apps/api/src/modules/notifications/notifications.service.ts
// IST Quiet Hours, Deduplication & Rupee-at-Risk Owner Digest (FR-NOT-001..014, RT-029)

import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { isIndiaQuietHour } from '@tradecloseout/shared';
import { getProjectCommercialSummary, paiseToSafeInr } from '../projects/project-commercial-summary';

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
    return JSON.stringify(sort(value)) ?? '';
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
    if (dto.channel !== 'IN_APP' && ctx.actorType !== 'SYSTEM') {
      throw new ServiceUnavailableException({
        code: 'EXTERNAL_NOTIFICATION_TEMPLATES_REQUIRED',
        detail: 'External notifications require a reviewed server-owned event template.',
      });
    }
    if (typeof dto.eventKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(dto.eventKey) ||
        typeof dto.dedupKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(dto.dedupKey) ||
        !dto.payload || Array.isArray(dto.payload) || typeof dto.payload !== 'object' ||
        (dto.projectId !== undefined && (typeof dto.projectId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.projectId)))) {
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

      const external = dto.channel !== 'IN_APP';
      const { rows: inserted } = await client.query(
        `INSERT INTO notifications (
          id, org_id, project_id, recipient_user_id, channel, event_key,
          payload_json, status, dedup_key, sent_at, gateway_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (org_id, dedup_key, channel, COALESCE(recipient_user_id, recipient_party_id))
        DO NOTHING RETURNING *`,
        [uuidv7(), ctx.orgId, dto.projectId ?? null, ctx.userId,
          dto.channel, dto.eventKey, canonicalPayload,
          external ? 'QUEUED' : 'SENT', dto.dedupKey,
          external ? null : new Date(), external ? 'PENDING' : 'DELIVERED'],
      );
      if (inserted.length) return { notification: inserted[0], deferredForQuietHours: false };

      const { rows: existing } = await client.query(
        `SELECT * FROM notifications
          WHERE org_id = $1 AND dedup_key = $2 AND channel = $4
            AND recipient_user_id = $3 FOR SHARE`,
        [ctx.orgId, dto.dedupKey, ctx.userId, dto.channel],
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
    // Owner-only financial projection: project.read does not grant billing visibility.
    if (ctx.actorType !== 'USER' || ctx.orgRole !== 'R-OWNER') {
      throw new ForbiddenException({ code: 'OWNER_DIGEST_RESTRICTED' });
    }
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rows: currentOwners } = await client.query(
        `SELECT 1 FROM memberships
          WHERE org_id = $1 AND user_id = $2
            AND role = 'R-OWNER' AND status = 'ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      if (!currentOwners.length) {
        throw new ForbiddenException({ code: 'OWNER_DIGEST_RESTRICTED' });
      }
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new BadRequestException('PROJECT_NOT_FOUND');
      }
      const proj = projRes.rows[0];

      // PH2-G20-009: due-date-based indicators only; closeout acceptance
      // still depends on the independent verified-evidence readiness check.
      // Future NOT_STARTED obligations and superseded rows are not overdue.
      const { rows: dueRows } = await client.query(
        `SELECT milestone_key, COUNT(*)::int AS count
           FROM requirements
          WHERE org_id=$1 AND project_id=$2 AND mandatory=true
            AND superseded_at IS NULL AND status <> 'NOT_APPLICABLE'
            AND (status='EXPIRED' OR
              (due_at IS NOT NULL AND due_at < now() AND
               status NOT IN ('APPROVED','APPROVED_EXTERNAL','WAIVED','NOT_APPLICABLE','HANDED_OVER')))
          GROUP BY milestone_key ORDER BY milestone_key`,
        [ctx.orgId, projectId],
      );
      const commercial = await getProjectCommercialSummary(client, ctx.orgId, projectId, proj);
      const contractValuePaise = commercial.contractValuePaise;
      const informationalRetentionExposurePaise = commercial.informationalRetentionExposurePaise;

      return {
        projectId: proj.id,
        projectCode: proj.code,
        projectName: proj.name,
        currency: 'INR',
        contractValuePaise,
        contractValueInr: paiseToSafeInr(contractValuePaise),
        financialSummaryBasis: commercial.basis,
        informationalRetentionExposurePaise,
        informationalRetentionExposureInr: paiseToSafeInr(informationalRetentionExposurePaise),
        // A contractual estimate is NOT evidence that payment or retention
        // has actually been withheld. Keep the deprecated "gated" fields NULL
        // until a separately verified financial event establishes that fact.
        retentionMoneyGatedPaise: null,
        retentionMoneyGatedInr: null,
        blockingRequirementsByMilestone: dueRows,
        overdueOrExpiredRequirementsByMilestone: dueRows,
        generatedAt: new Date(),
        recipientRole: 'R-OWNER',
      };
    });
  }
}
