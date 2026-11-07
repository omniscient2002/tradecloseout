// apps/api/src/modules/billing/billing.service.ts
// Rule 46 GST Invoicing, Section 194J TDS & Razorpay Webhooks (FR-BIL-001..012, RT-015, RT-030)

import { Injectable, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';

@Injectable()
export class BillingService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-150 GET /billing/plans
   * Fix Business Risk 5: Includes Single-Project Closeout Pass (interval = ONE_TIME_PROJECT)
   */
  async listPlans() {
    return [
      {
        id: 'plan-starter',
        code: 'STARTER',
        name: 'Starter Tier',
        priceInr: 4999,
        billingPeriod: 'MONTHLY',
        maxProjects: 2,
        storageGb: 20,
      },
      {
        id: 'plan-growth',
        code: 'GROWTH',
        name: 'Growth Tier',
        priceInr: 9999,
        billingPeriod: 'MONTHLY',
        maxProjects: 10,
        storageGb: 100,
      },
      {
        id: 'plan-project-pass',
        code: 'PROJECT_PASS',
        name: 'Single-Project Closeout Pass',
        priceInr: 24999,
        billingPeriod: 'ONE_TIME_PROJECT',
        maxProjects: 1,
        storageGb: 10,
        description: '18 months active execution + 8 years read-only DLP/audit archive hosting. Billable to site prelims.',
      },
      {
        id: 'plan-enterprise',
        code: 'ENTERPRISE',
        name: 'Enterprise Tier',
        priceInr: 49999,
        billingPeriod: 'MONTHLY',
        maxProjects: 50,
        storageGb: 1000,
      },
    ];
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
  async handleRazorpayWebhook(payload: Buffer | undefined, signature: string) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED',
        title: 'Payment webhook unavailable',
        detail: 'Razorpay webhook processing is disabled until HMAC verification and durable processing are configured (XP03/XP22).',
      });
    }

    if (!signature) {
      throw new BadRequestException('PAYMENT_WEBHOOK_SIGNATURE_REQUIRED');
    }

    // Razorpay signs the exact raw bytes, not JSON.stringify(parsedBody).
    // Malformed signatures never reach timingSafeEqual, which requires
    // buffers of equal length.
    if (!Buffer.isBuffer(payload)) {
      throw new BadRequestException('PAYMENT_WEBHOOK_RAW_BODY_REQUIRED');
    }
    const expected = createHmac('sha256', webhookSecret).update(payload).digest();
    const supplied = /^[a-f0-9]{64}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      throw new BadRequestException('INVALID_PAYMENT_WEBHOOK_SIGNATURE');
    }

    // V03: Never falsely claim PROCESSED_IDEMPOTENTLY until durable inbox ledger is active
    throw new ServiceUnavailableException({
      code: 'PAYMENT_WEBHOOK_PROCESSING_UNAVAILABLE',
      title: 'Payment webhook processing unavailable',
      detail: 'Webhook ingestion is disabled until raw-body verification and durable event inbox ledger are enabled.',
    });
  }
}
