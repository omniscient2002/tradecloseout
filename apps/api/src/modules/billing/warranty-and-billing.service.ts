import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';

@Injectable()
export class WarrantyAndBillingService {
  constructor(private readonly pool: Pool) {}

  /**
   * WF-24 / API-180: Record OEM Warranty Event & Detect Basis Conflicts (AUD-D-03)
   * Flags a conflict if the OEM registration basis (e.g. COMMISSIONING) disagrees with
   * the asset's contracted warranty_start_basis (e.g. HANDOVER).
   */
  async recordWarrantyEvent(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      assetId: string;
      eventType: 'REGISTRATION' | 'CONFIRMATION' | 'CLAIM' | 'EXTENSION';
      oemReference: string;
      registeredAt: string;
      warrantyStart: string;
      warrantyEnd: string;
      basis: 'COMMISSIONING' | 'HANDOVER' | 'ACCEPTANCE' | 'SUPPLY';
      evidenceObjectId?: string;
    },
  ) {
    if (new Date(input.warrantyEnd) < new Date(input.warrantyStart)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'warrantyEnd must be on or after warrantyStart (WF-24).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: assetRows } = await client.query(
        `SELECT id, tag, warranty_start_basis, warranty_start
           FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, input.assetId],
      );
      if (assetRows.length === 0) {
        throw new UnprocessableEntityException({ code: 'NOT_FOUND', detail: 'Asset not found.' });
      }
      const asset = assetRows[0];

      // Detect basis mismatch between OEM certificate and contract (WF-24 Step 3)
      const hasBasisConflict = asset.warranty_start_basis !== input.basis;
      const eventStatus = hasBasisConflict ? 'DISPUTED' : 'CONFIRMED';
      const warrantyEventId = uuidv7();

      await client.query(
        `INSERT INTO warranty_events
          (id, org_id, project_id, asset_id, event_type, status, oem_reference,
           registered_at, warranty_start, warranty_end, basis, evidence_object_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          warrantyEventId,
          ctx.orgId,
          projectId,
          input.assetId,
          input.eventType,
          eventStatus,
          input.oemReference.trim(),
          input.registeredAt,
          input.warrantyStart,
          input.warrantyEnd,
          input.basis,
          input.evidenceObjectId ?? null,
          ctx.userId,
        ],
      );

      // Update asset dates if confirmed and no prior warranty_start exists (FR-AST-012)
      if (!hasBasisConflict) {
        await client.query(
          `UPDATE assets
              SET warranty_start = COALESCE(warranty_start, $4),
                  warranty_end = COALESCE(warranty_end, $5),
                  row_version = row_version + 1,
                  updated_at = now()
            WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, input.assetId, input.warrantyStart, input.warrantyEnd],
        );
      }

      emit({
        eventType: 'WARRANTY_EVENT_RECORDED',
        projectId,
        entityType: 'WARRANTY_EVENT',
        entityId: warrantyEventId,
        afterJson: {
          assetTag: asset.tag,
          status: eventStatus,
          hasBasisConflict,
        },
      });

      return { warrantyEventId, status: eventStatus, hasBasisConflict };
    });
  }

  /**
   * WF-25 / API-183: Close Defect / Snag Item with Mandatory Closure Evidence (AUD-D-04)
   */
  async closeDefect(
    ctx: TenantActorContext,
    projectId: string,
    defectId: string,
    closureEvidenceObjectId: string,
  ) {
    if (!closureEvidenceObjectId) {
      throw new UnprocessableEntityException({
        code: 'CLOSURE_EVIDENCE_REQUIRED',
        detail: 'Closing a defect requires uploading closure evidence (WF-25).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      await client.query(
        `UPDATE defects
            SET status = 'CLOSED',
                closure_evidence_object_id = $4,
                closed_at = now(),
                closed_by = $5,
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, defectId, closureEvidenceObjectId, ctx.userId],
      );

      emit({
        eventType: 'DEFECT_CLOSED',
        projectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: { status: 'CLOSED', closureEvidenceObjectId },
      });

      return { defectId, status: 'CLOSED' };
    });
  }

  async listWarrantyEvents(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT we.*, a.tag AS asset_tag, a.name AS asset_name
           FROM warranty_events we
           LEFT JOIN assets a ON a.id = we.asset_id
          WHERE we.org_id = $1 AND we.project_id = $2
          ORDER BY we.created_at DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async listDefects(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT d.*, a.tag AS asset_tag, u.name AS raised_by_name
           FROM defects d
           LEFT JOIN assets a ON a.id = d.asset_id
           LEFT JOIN users u ON u.id = d.raised_by
          WHERE d.org_id = $1 AND d.project_id = $2
          ORDER BY d.created_at DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async createDefect(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      title: string;
      description?: string;
      assetId?: string;
      severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
      location?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const defectId = uuidv7();
      await client.query(
        `INSERT INTO defects
           (id, org_id, project_id, asset_id, title, description, severity, status, location, raised_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9, now())`,
        [
          defectId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.title,
          input.description || null,
          input.severity || 'MINOR',
          input.location || null,
          ctx.userId,
        ],
      );

      emit({
        eventType: 'DEFECT_RAISED',
        projectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: { title: input.title, severity: input.severity || 'MINOR' },
      });

      return { defectId, status: 'OPEN' };
    });
  }

  async getSubscription(ctx: TenantActorContext) {
    const { rows } = await this.pool.query(
      `SELECT s.*, p.name AS plan_name, p.code AS plan_tier, p.limits_json, p.price_paise, p.interval
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1
        ORDER BY s.created_at DESC LIMIT 1`,
      [ctx.orgId],
    );
    if (!rows.length) {
      return {
        id: uuidv7(),
        planName: 'Growth Plan',
        planTier: 'GROWTH',
        status: 'ACTIVE',
        seatLimit: 20,
        storageQuotaBytes: 100 * 1024 * 1024 * 1024,
        pricePaise: 999900,
        limitsJson: { maxActiveProjects: 15, maxSeats: 20, maxStorageBytes: 100 * 1024 * 1024 * 1024 },
      };
    }
    const sub = rows[0];
    const limits = sub.limits_json || {};
    return {
      ...sub,
      seatLimit: limits.maxSeats || 20,
      storageQuotaBytes: limits.maxStorageBytes || 100 * 1024 * 1024 * 1024,
      maxActiveProjects: limits.maxActiveProjects || 15,
    };
  }

  /**
   * API-160: POST /api/v1/webhooks/razorpay
   * Verifies Razorpay HMAC-SHA256 signature, deduplicates by event_id (10 §12.1),
   * and updates subscription state.
   */
  async processRazorpayWebhook(rawBody: string, signatureHeader: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const expectedHmac = createHmac('sha256', secret).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expectedHmac, 'utf8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf8');
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        detail: 'Razorpay webhook HMAC verification failed.',
      });
    }

    const event = JSON.parse(rawBody);
    const eventId: string = event.id;
    const orgId: string | undefined = event.payload?.subscription?.entity?.notes?.orgId;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotent deduplication by event_id (10 §12.1)
      const { rowCount } = await client.query(
        `INSERT INTO payment_events (id, org_id, provider, event_id, type, payload_json)
         VALUES ($1, $2, 'RAZORPAY', $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING`,
        [uuidv7(), orgId ?? null, eventId, event.event, JSON.stringify({ id: eventId, event: event.event })],
      );

      if (rowCount === 0) {
        await client.query('COMMIT');
        return { processed: false, duplicate: true };
      }

      if (orgId) {
        await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
        if (event.event === 'subscription.charged') {
          await client.query(
            `UPDATE subscriptions
                SET status = 'ACTIVE', row_version = row_version + 1, updated_at = now()
              WHERE org_id = $1`,
            [orgId],
          );
        } else if (event.event === 'subscription.halted') {
          await client.query(
            `UPDATE subscriptions
                SET status = 'PAST_DUE', row_version = row_version + 1, updated_at = now()
              WHERE org_id = $1`,
            [orgId],
          );
        }
      }

      await client.query('COMMIT');
      return { processed: true, duplicate: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * FR-BIL-011 / BR-BIL-14: Record Customer TDS Deduction Against an Invoice
   */
  async recordInvoiceTdsDeduction(
    ctx: TenantActorContext,
    input: {
      invoiceId: string;
      section: string; // e.g., '194J' or '194C'
      rateBps: number;
      amountPaise: bigint;
      certificateReference?: string;
      deductedAt: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const tdsId = uuidv7();
      await client.query(
        `INSERT INTO invoice_tds
          (id, org_id, invoice_id, section, rate_bps, amount_paise, certificate_reference, deducted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tdsId,
          ctx.orgId,
          input.invoiceId,
          input.section.trim().toUpperCase(),
          input.rateBps,
          input.amountPaise.toString(),
          input.certificateReference ?? null,
          input.deductedAt,
        ],
      );

      emit({
        eventType: 'INVOICE_TDS_RECORDED',
        entityType: 'INVOICE',
        entityId: input.invoiceId,
        afterJson: {
          tdsId,
          section: input.section,
          rateBps: input.rateBps,
          amountPaise: input.amountPaise.toString(),
        },
      });

      return { tdsId, invoiceId: input.invoiceId };
    });
  }
}
