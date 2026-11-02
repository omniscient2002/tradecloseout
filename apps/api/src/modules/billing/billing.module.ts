// apps/api/src/modules/billing/billing.module.ts

import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { WarrantyAndBillingService } from './warranty-and-billing.service';
import { GstEinvoiceTdsService } from './gst-einvoice-tds.service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BillingController],
  providers: [BillingService, WarrantyAndBillingService, GstEinvoiceTdsService],
  exports: [BillingService, WarrantyAndBillingService, GstEinvoiceTdsService],
})
export class BillingModule {}
