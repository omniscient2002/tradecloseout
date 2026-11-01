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
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

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

  @Post('webhooks/razorpay')
  async handleRazorpayWebhook(
    @Body() payload: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.billingService.handleRazorpayWebhook(payload, signature || '');
  }
}
