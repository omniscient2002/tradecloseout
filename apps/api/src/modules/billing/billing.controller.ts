// apps/api/src/modules/billing/billing.controller.ts
// Billing & GST Invoices Controller (API-150..160)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { GstEinvoiceTdsService } from './gst-einvoice-tds.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly gstEinvoiceService: GstEinvoiceTdsService,
  ) {}

  @Get('billing/plans')
  async listPlans() {
    return this.billingService.listPlans();
  }

  @Get('billing/invoices')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async listInvoices(@Req() req: any) {
    return this.billingService.listInvoices(req.userContext);
  }

  @Post('billing/invoices')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
    return this.billingService.createInvoice(req.userContext, dto);
  }

  @Post('billing/invoices/:id/tds')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
    },
  ) {
    return this.billingService.recordTds(req.userContext, invoiceId, dto);
  }

  @Post('billing/rule46-invoices')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
    return this.gstEinvoiceService.issueRule46GstInvoice(req.userContext, {
      subscriptionId: dto.subscriptionId,
      description: dto.description,
      subtotalPaise: BigInt(dto.subtotalPaise),
      buyerGstin: dto.buyerGstin,
      buyerStateCode: dto.buyerStateCode,
    });
  }

  @Post('billing/tds/:id/reconcile')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
  async handleRazorpayWebhook(
    @Body() payload: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.billingService.handleRazorpayWebhook(payload, signature || '');
  }
}
