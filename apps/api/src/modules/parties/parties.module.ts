// apps/api/src/modules/parties/parties.module.ts

import { Module } from '@nestjs/common';
import { PartiesService } from './parties.service';
import { SupplierGuestService } from './supplier-guest.service';
import { PartiesController } from './parties.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PartiesController],
  providers: [PartiesService, SupplierGuestService],
  exports: [PartiesService, SupplierGuestService],
})
export class PartiesModule {}
