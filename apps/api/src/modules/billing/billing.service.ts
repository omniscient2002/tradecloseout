// apps/api/src/modules/billing/billing.service.ts
// Rule 46 GST Invoicing, Section 194J TDS & Razorpay Webhooks (FR-BIL-001..012, RT-015, RT-030)

import { Injectable, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';

/** PH2-G18-007: active offers must be complete, bounded and safe to represent. */
export function publicPlanLimits(value: unknown): {
  maxActiveProjects: number;
  maxSeats: number;
  maxStorageBytes: number;
  maxPackageGenerationsPerMonth: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceUnavailableException({ code: 'ACTIVE_PLAN_CONFIGURATION_INVALID' });
  }
  const record = value as Record<string, unknown>;
  const fields = ['maxActiveProjects','maxSeats','maxStorageBytes',
    'maxPackageGenerationsPerMonth'] as const;
  for (const field of fields) {
    const amount = record[field];
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
      // Never substitute a fabricated Starter/zero value for a malformed offer.
      throw new ServiceUnavailableException({ code: 'ACTIVE_PLAN_CONFIGURATION_INVALID' });
    }
  }
  return {
    maxActiveProjects: record.maxActiveProjects as number,
    maxSeats: record.maxSeats as number,
    maxStorageBytes: record.maxStorageBytes as number,
    maxPackageGenerationsPerMonth: record.maxPackageGenerationsPerMonth as number,
  };
}

@Injectable()
export class BillingService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-150 GET /billing/plans
   * Fix Business Risk 5: Includes Single-Project Closeout Pass (interval = ONE_TIME_PROJECT)
   */
  async listPlans() {
    // Prices and entitlements come only from activated billing configuration.
    // Previously this endpoint fabricated plan IDs and fixed INR prices that
    // did not necessarily exist in the database or payment provider.
    const { rows } = await this.db.getPool().query(
      `SELECT id, code, name, price_paise::text AS price_paise,
              interval, limits_json
         FROM plans WHERE status = 'ACTIVE'
         ORDER BY price_paise ASC, code ASC`,
    );
    return rows.map((plan: any) => {
      const limits = publicPlanLimits(plan.limits_json);
      let pricePaise: bigint;
      try { pricePaise = BigInt(plan.price_paise); }
      catch { throw new ServiceUnavailableException({ code: 'ACTIVE_PLAN_CONFIGURATION_INVALID' }); }
      if (pricePaise < 0n || pricePaise > 9223372036854775807n) {
        throw new ServiceUnavailableException({ code: 'ACTIVE_PLAN_CONFIGURATION_INVALID' });
      }
      return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        pricePaise: pricePaise.toString(),
        // Numeric INR is an optional convenience, never a lossy financial fact.
        priceInr: pricePaise <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(pricePaise) / 100 : null,
        billingPeriod: ['MONTH', 'MONTHLY'].includes(plan.interval) ? 'MONTHLY'
          : ['YEAR', 'ANNUAL'].includes(plan.interval) ? 'ANNUAL' : plan.interval,
        maxProjects: limits.maxActiveProjects,
        storageGb: limits.maxStorageBytes / (1024 ** 3),
        limits,
      };
    });
  }

  /**
   * API-151 GET /billing/invoices
   */
  async listInvoices(ctx: ExecutionContext) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT i.*, 
                json_agg(t.*) FILTER (WHERE t.id IS NOT NULL) as tds_deductions
         FROM invoices i
         LEFT JOIN invoice_tds t ON t.invoice_id = i.id
         WHERE i.org_id = $1
         GROUP BY i.id
         ORDER BY i.issued_at DESC`,
        [ctx.orgId],
      );
      return res.rows;
    });
  }

  /**
   * API-152 POST /billing/invoices (Generates Rule 46 GST compliant invoice with SAC 998315)
   */
  async createInvoice(
    ctx: ExecutionContext,
    dto: {
      subtotalPaise: number;
      buyerGstin?: string;
      placeOfSupply: string; // State code e.g. '07' (Delhi), '06' (Haryana), '29' (Karnataka)
      isInterState?: boolean;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const subtotal = BigInt(dto.subtotalPaise);
      const isInter = Boolean(dto.isInterState);

      // 18% GST (SAC 998315)
      const taxRateBps = 1800;
      const taxPaise = (subtotal * BigInt(taxRateBps)) / 10000n;
      const totalPaise = subtotal + taxPaise;

      const invoiceId = uuidv7();
      const countRes = await client.query(
        `SELECT count(*) FROM invoices WHERE org_id = $1`,
        [ctx.orgId],
      );
      const seqNo = Number(countRes.rows[0].count) + 1;
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      const number = `TC-INV-${seqNo.toString().padStart(3, '0')}-${randSuffix}`;

      const res = await client.query(
        `INSERT INTO invoices (
          id, org_id, number, status, subtotal_paise, tax_paise, total_paise,
          tax_rate_bps, sac, place_of_supply, buyer_gstin, einvoice_status
        ) VALUES ($1, $2, $3, 'ISSUED', $4, $5, $6, $7, '998315', $8, $9, 'NOT_APPLICABLE')
        RETURNING *`,
        [
          invoiceId,
          ctx.orgId,
          number,
          subtotal.toString(),
          taxPaise.toString(),
          totalPaise.toString(),
          taxRateBps,
          dto.placeOfSupply || '07',
          dto.buyerGstin || null,
        ],
      );

      return {
        ...res.rows[0],
        eInvoiceExemptionNotice:
          'Declaration under Rule 48(4) CGST: Aggregate turnover below statutory threshold (CBIC Notification 10/2023-CT).',
      };
    });
  }

  /**
   * API-153 POST /billing/invoices/:id/tds (Records Section 194J TDS deduction - RT-030)
   */
  async recordTds(
    ctx: ExecutionContext,
    invoiceId: string,
    dto: {
      section: '194J_A_2PCT' | '194J_B_10PCT' | '194C';
      rateBps: number;
      amountPaise: number;
      certificateReference?: string;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const invRes = await client.query(
        `SELECT * FROM invoices WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, invoiceId],
      );
      if (!invRes.rows.length) {
        throw new NotFoundException('INVOICE_NOT_FOUND');
      }

      const tdsId = uuidv7();
      const status = dto.certificateReference ? 'CERTIFICATE_UPLOADED' : 'PENDING_CERTIFICATE';

      const res = await client.query(
        `INSERT INTO invoice_tds (
          id, org_id, invoice_id, section, rate_bps, amount_paise, certificate_reference, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          tdsId,
          ctx.orgId,
          invoiceId,
          dto.section || '194J_A_2PCT',
          dto.rateBps || 200,
          dto.amountPaise,
          dto.certificateReference || null,
          status,
        ],
      );

      return res.rows[0];
    });
  }

  /**
   * API-160 POST /webhooks/razorpay (Idempotent signature verification, Finding N05 & XP03)
   */
  async handleRazorpayWebhook(
    payload: Buffer | undefined,
    signature: string,
    razorpayEventId?: string,
  ) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED',
        detail: 'Configure a Razorpay webhook secret before accepting events.',
      });
    }
    if (!Buffer.isBuffer(payload) || payload.length === 0 || payload.length > 256 * 1024) {
      throw new BadRequestException('PAYMENT_WEBHOOK_INVALID_RAW_BODY');
    }
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new BadRequestException('PAYMENT_WEBHOOK_SIGNATURE_REQUIRED');
    }
    // Verify Razorpay's HMAC over the exact received request bytes.
    const expected = createHmac('sha256', webhookSecret).update(payload).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (!timingSafeEqual(expected, supplied)) {
      throw new BadRequestException('INVALID_PAYMENT_WEBHOOK_SIGNATURE');
    }
    // Razorpay sends a distinct event ID as an HTTP header. Never use its
    // business entity IDs (payment/subscription) for webhook deduplication.
    if (!razorpayEventId || !/^[A-Za-z0-9_-]{8,128}$/.test(razorpayEventId)) {
      throw new BadRequestException('PAYMENT_WEBHOOK_EVENT_ID_REQUIRED');
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(payload.toString('utf8'));
    } catch {
      throw new BadRequestException('PAYMENT_WEBHOOK_INVALID_JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.event !== 'string' || !/^[a-z0-9._-]{3,128}$/.test(body.event) ||
        !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
      throw new BadRequestException('PAYMENT_WEBHOOK_INVALID_EVENT');
    }

    // Security boundary: this write-only function stores authenticated global
    // events without tenant context. It performs NO subscription update, invoice
    // payment, entitlement grant or payment settlement. Business processing
    // requires an independently mapped provider reference and reconciliation.
    let outcome: string;
    try {
      const result = await this.db.getPool().query(
        `SELECT record_verified_razorpay_webhook($1::uuid, $2::text, $3::text, $4::text, $5::jsonb) AS outcome`,
        [
          uuidv7(),
          razorpayEventId,
          body.event,
          createHash('sha256').update(payload).digest('hex'),
          JSON.stringify(body),
        ],
      );
      outcome = result.rows[0]?.outcome;
    } catch {
      // Tell Razorpay to retry. Never acknowledge an event that was not
      // durably recorded, even if its signature was valid.
      throw new ServiceUnavailableException({
        code: 'PAYMENT_WEBHOOK_INBOX_UNAVAILABLE',
        detail: 'Verified event could not be durably recorded. Retry delivery.',
      });
    }
    if (outcome === 'PAYLOAD_CONFLICT') {
      throw new ConflictException('PAYMENT_WEBHOOK_EVENT_ID_COLLISION');
    }
    if (outcome !== 'RECEIVED' && outcome !== 'DUPLICATE') {
      throw new ServiceUnavailableException('PAYMENT_WEBHOOK_RECEIPT_UNCONFIRMED');
    }
    return {
      status: 'RECEIVED_FOR_RECONCILIATION',
      eventId: razorpayEventId,
      duplicate: outcome === 'DUPLICATE',
      processed: false,
    };
  }
}
