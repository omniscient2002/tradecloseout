import { Injectable, Optional, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';

export interface GspEinvoiceClient {
  generateIrn(payload: {
    invoiceNumber: string;
    issueDate: string;
    supplierGstin: string;
    buyerGstin: string;
    placeOfSupplyStateCode: string;
    sacCode: string;
    subtotalPaise: bigint;
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    totalPaise: bigint;
  }): Promise<{ irn: string; signedQrPayload: string; ackNo: string; ackDate: string }>;
}

@Injectable()
export class GstEinvoiceTdsService {
  constructor(
    private readonly pool: Pool,
    @Optional() private readonly gspClient?: GspEinvoiceClient,
  ) {}

  /**
   * Issues a Rule 46 compliant GST Tax Invoice with sequential FY numbering,
   * automatic intra-state (CGST+SGST) vs inter-state (IGST) calculation,
   * and optional NIC IRP e-Invoice (IRN + QR) generation via GSP (FR-BIL-005, RT-015).
   */
  async issueRule46GstInvoice(
    ctx: TenantActorContext,
    input: {
      subscriptionId: string;
      description: string;
      subtotalPaise: bigint;
      buyerGstin?: string | null;
      buyerStateCode: string; // 2-digit Indian state code e.g. '27' (MH), '36' (TS)
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // 1. Load active tax configuration from billing_tax_configs (zero hardcoded tax rates per FR-BIL-009)
      const { rows: taxConfigs } = await client.query(
        `SELECT sac_code, gst_rate_bps, supplier_state_code, supplier_gstin, einvoice_enabled
           FROM billing_tax_configs
          WHERE active = true
          ORDER BY effective_from DESC
          LIMIT 1`,
      );
      if (taxConfigs.length === 0) {
        throw new UnprocessableEntityException({
          code: 'TAX_CONFIG_MISSING',
          detail: 'No active row in billing_tax_configs. Configure GST/SAC before issuing invoices.',
        });
      }
      const taxCfg = taxConfigs[0];

      // 2. Generate gapless sequential Rule 46 invoice number under FOR UPDATE lock
      const fy = this.computeIndianFinancialYear(new Date());
      await client.query(
        `INSERT INTO invoice_sequences (financial_year, last_seq_no)
         VALUES ($1, 0)
         ON CONFLICT (financial_year) DO NOTHING`,
        [fy],
      );
      const { rows: seqRows } = await client.query(
        `UPDATE invoice_sequences
            SET last_seq_no = last_seq_no + 1, updated_at = now()
          WHERE financial_year = $1
          RETURNING last_seq_no`,
        [fy],
      );
      const seqNo = String(seqRows[0].last_seq_no).padStart(5, '0');
      const invoiceNumber = `TC/${fy}/${seqNo}`; // <= 16 chars per GST Rule 46

      // 3. Compute Intra-State (CGST + SGST) vs Inter-State (IGST) split in integer paise
      const placeOfSupply = input.buyerGstin
        ? input.buyerGstin.slice(0, 2)
        : input.buyerStateCode;
      const isIntraState = placeOfSupply === taxCfg.supplier_state_code;

      const rateBps = BigInt(taxCfg.gst_rate_bps);
      const totalTaxPaise = (input.subtotalPaise * rateBps) / 10000n;
      const cgstPaise = isIntraState ? totalTaxPaise / 2n : 0n;
      const sgstPaise = isIntraState ? totalTaxPaise - cgstPaise : 0n;
      const igstPaise = isIntraState ? 0n : totalTaxPaise;
      const grandTotalPaise = input.subtotalPaise + totalTaxPaise;

      // 4. Optional GSP IRP e-Invoicing (IRN + Signed QR) when enabled and B2B GSTIN present
      let irn: string | null = null;
      let qrPayload: string | null = null;
      let einvoiceStatus = 'NOT_APPLICABLE';

      if (taxCfg.einvoice_enabled && input.buyerGstin && this.gspClient) {
        const irpRes = await this.gspClient.generateIrn({
          invoiceNumber,
          issueDate: new Date().toISOString().slice(0, 10),
          supplierGstin: taxCfg.supplier_gstin,
          buyerGstin: input.buyerGstin,
          placeOfSupplyStateCode: placeOfSupply,
          sacCode: taxCfg.sac_code,
          subtotalPaise: input.subtotalPaise,
          cgstPaise,
          sgstPaise,
          igstPaise,
          totalPaise: grandTotalPaise,
        });
        irn = irpRes.irn;
        qrPayload = irpRes.signedQrPayload;
        einvoiceStatus = 'IRN_GENERATED';
      }

      const invoiceId = uuidv7();
      await client.query(
        `INSERT INTO invoices
          (id, org_id, subscription_id, number, status, subtotal_paise, tax_paise,
           total_paise, tax_rate_bps, sac, buyer_gstin, place_of_supply,
           irn, qr_payload, einvoice_status, issued_at)
         VALUES ($1,$2,$3,$4,'ISSUED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
        [
          invoiceId,
          ctx.orgId,
          input.subscriptionId,
          invoiceNumber,
          input.subtotalPaise.toString(),
          totalTaxPaise.toString(),
          grandTotalPaise.toString(),
          taxCfg.gst_rate_bps,
          taxCfg.sac_code,
          input.buyerGstin ?? null,
          placeOfSupply,
          irn,
          qrPayload,
          einvoiceStatus,
        ],
      );

      await client.query(
        `INSERT INTO invoice_lines
          (id, org_id, invoice_id, description, quantity, unit_paise, tax_rate_bps, amount_paise)
         VALUES ($1,$2,$3,$4,1,$5,$6,$5)`,
        [
          uuidv7(),
          ctx.orgId,
          invoiceId,
          input.description,
          input.subtotalPaise.toString(),
          taxCfg.gst_rate_bps,
        ],
      );

      emit({
        eventType: 'GST_INVOICE_ISSUED',
        entityType: 'INVOICE',
        entityId: invoiceId,
        afterJson: {
          invoiceNumber,
          subtotalPaise: input.subtotalPaise.toString(),
          cgstPaise: cgstPaise.toString(),
          sgstPaise: sgstPaise.toString(),
          igstPaise: igstPaise.toString(),
          grandTotalPaise: grandTotalPaise.toString(),
          einvoiceStatus,
        },
      });

      return {
        invoiceId,
        invoiceNumber,
        placeOfSupply,
        taxBreakdown: {
          subtotalPaise: input.subtotalPaise.toString(),
          cgstPaise: cgstPaise.toString(),
          sgstPaise: sgstPaise.toString(),
          igstPaise: igstPaise.toString(),
          totalPaise: grandTotalPaise.toString(),
        },
        irn,
        einvoiceStatus,
      };
    });
  }

  /**
   * RT-030: Reconciles a pending customer TDS deduction when the quarterly Form 16A PDF is uploaded.
   */
  async reconcileForm16aTdsCertificate(
    ctx: TenantActorContext,
    tdsId: string,
    form16aCertificateRef: string,
    certificateObjectId: string,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rowCount } = await client.query(
        `UPDATE invoice_tds
            SET certificate_reference = $3,
                certificate_object_id = $4,
                status = 'RECONCILED'
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, tdsId, form16aCertificateRef.trim().toUpperCase(), certificateObjectId],
      );

      if (rowCount === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'TDS deduction record not found.' });
      }

      emit({
        eventType: 'INVOICE_TDS_FORM16A_RECONCILED',
        entityType: 'INVOICE_TDS',
        entityId: tdsId,
        afterJson: { form16aCertificateRef, status: 'RECONCILED' },
      });

      return { tdsId, status: 'RECONCILED', form16aCertificateRef };
    });
  }

  private computeIndianFinancialYear(date: Date): string {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1; // 1..12
    const startYear = month >= 4 ? year : year - 1;
    const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
    return `${startYear}-${endYearShort}`;
  }
}
