// apps/api/src/modules/billing/billing.controller.ts
// Billing & GST Invoices Controller (API-150..160)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  Req,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { GstEinvoiceTdsService } from './gst-einvoice-tds.service';
import { WarrantyAndBillingService } from './warranty-and-billing.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly gstEinvoiceService: GstEinvoiceTdsService,
    private readonly warrantyAndBillingService: WarrantyAndBillingService,
  ) {}

  private assertInvoiceIssuanceEnabled() {
    // Live tax/invoice issuance must be explicitly enabled only after a
    // documented GST/tax review and provider reconciliation acceptance.
    // Webhook receipt itself NEVER means money was settled.
    if (process.env.ENABLE_TAX_INVOICE_ISSUANCE !== 'true') {
      throw new ServiceUnavailableException({
        code: 'TAX_INVOICE_ISSUANCE_DISABLED',
        detail: 'Tax invoice issuance requires independent finance/legal release approval.',
      });
    }
  }

  @Get('billing/plans')
  async listPlans() {
    return this.billingService.listPlans();
  }

  @Get(['billing/invoices', 'orgs/current/invoices'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async listInvoices(@Req() req: any) {
    return this.billingService.listInvoices(req.userContext);
  }

  @Get('orgs/current/subscription')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async getCurrentSubscription(@Req() req: any) {
    return this.warrantyAndBillingService.getSubscription(req.userContext);
  }

  @Post(['billing/invoices', 'orgs/current/invoices'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async createInvoice(
    @Req() req: any,
    @Body()
    dto: {
      subtotalPaise: number;
      buyerGstin?: string;
      placeOfSupply: string;
      isInterState?: boolean;
    },
  ) {
    this.assertInvoiceIssuanceEnabled();
    return this.billingService.createInvoice(req.userContext, dto);
  }

  @Post(['billing/invoices/:id/tds', 'orgs/current/tds'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async recordTds(
    @Req() req: any,
    @Param('id') invoiceId: string,
    @Body()
    dto: {
      section: '194J_A_2PCT' | '194J_B_10PCT' | '194C';
      rateBps: number;
      amountPaise: number;
      certificateReference?: string;
      invoiceId?: string;
    },
  ) {
    return this.billingService.recordTds(req.userContext, invoiceId || dto.invoiceId || '', dto);
  }

  @Post('projects/:id/warranty-events')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('warranty.manage')
  async recordWarrantyEvent(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body()
    dto: {
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
    return this.warrantyAndBillingService.recordWarrantyEvent(req.userContext, projectId, dto);
  }

  @Get('projects/:id/warranty-events')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async listWarrantyEvents(@Req() req: any, @Param('id') projectId: string) {
    return this.warrantyAndBillingService.listWarrantyEvents(req.userContext, projectId);
  }

  @Get('projects/:id/commercial-readiness')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async getCommercialReadiness(@Req() req: any, @Param('id') projectId: string) {
    return this.warrantyAndBillingService.getCommercialReadiness(req.userContext, projectId);
  }

  @Get('projects/:id/defects')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async listDefects(@Req() req: any, @Param('id') projectId: string) {
    return this.warrantyAndBillingService.listDefects(req.userContext, projectId);
  }

  @Post('projects/:id/defects')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('defect.manage')
  async createDefect(
    @Req() req: any,
    @Param('id') projectId: string,
    @Body()
    dto: {
      title: string;
      description?: string;
      assetId?: string;
      severity?: 'MINOR' | 'MAJOR' | 'CRITICAL';
      location?: string;
    },
  ) {
    return this.warrantyAndBillingService.createDefect(req.userContext, projectId, dto);
  }

  @Post(['defects/:id/remedy', 'projects/:projectId/defects/:id/remedy'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('defect.manage')
  async submitDefectRemedy(
    @Req() req: any,
    @Param('id') defectId: string,
    @Param('projectId') projectId: string,
    @Body() dto: { remedyEvidenceObjectId: string; expectedRowVersion?: number },
  ) {
    return this.warrantyAndBillingService.submitDefectRemedy(
      req.userContext,
      projectId || '',
      defectId,
      dto.remedyEvidenceObjectId,
      dto.expectedRowVersion,
    );
  }

  @Post(['defects/:id/close', 'projects/:projectId/defects/:id/close'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('defect.manage')
  async closeDefect(
    @Req() req: any,
    @Param('id') defectId: string,
    @Param('projectId') projectId: string,
    @Body() dto: { closureEvidenceObjectId: string; expectedRowVersion?: number },
  ) {
    return this.warrantyAndBillingService.closeDefect(
      req.userContext,
      projectId || '',
      defectId,
      dto.closureEvidenceObjectId,
      dto.expectedRowVersion,
    );
  }

  @Post('billing/rule46-invoices')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async issueRule46GstInvoice(
    @Req() req: any,
    @Body()
    dto: {
      subscriptionId: string;
      description: string;
      subtotalPaise: string | number;
      buyerGstin?: string | null;
      buyerStateCode: string;
    },
  ) {
    this.assertInvoiceIssuanceEnabled();
    return this.gstEinvoiceService.issueRule46GstInvoice(req.userContext, {
      subscriptionId: dto.subscriptionId,
      description: dto.description,
      subtotalPaise: BigInt(dto.subtotalPaise),
      buyerGstin: dto.buyerGstin,
      buyerStateCode: dto.buyerStateCode,
    });
  }

  @Post('billing/tds/:id/reconcile')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async reconcileForm16a(
    @Req() req: any,
    @Param('id') tdsId: string,
    @Body()
    dto: {
      form16aCertificateRef: string;
      certificateObjectId: string;
    },
  ) {
    return this.gstEinvoiceService.reconcileForm16aTdsCertificate(
      req.userContext,
      tdsId,
      dto.form16aCertificateRef,
      dto.certificateObjectId,
    );
  }

  @Post('webhooks/razorpay')
  @HttpCode(202)
  async handleRazorpayWebhook(
    @Req() req: any,
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') eventId: string,
  ) {
    return this.billingService.handleRazorpayWebhook(
      req.rawBody, signature || '', eventId || '',
    );
  }
}
