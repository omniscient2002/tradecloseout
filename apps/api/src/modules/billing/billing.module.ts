// apps/api/src/modules/billing/billing.module.ts

import {ProjectOfferController} from './project-offer.controller';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { WarrantyAndBillingService } from './warranty-and-billing.service';
import { GstEinvoiceTdsService } from './gst-einvoice-tds.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BillingController,ProjectOfferController],
  providers: [BillingService, WarrantyAndBillingService, GstEinvoiceTdsService],
  exports: [BillingService, WarrantyAndBillingService, GstEinvoiceTdsService],
})
export class BillingModule {}
