import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CommissioningController } from './commissioning.controller';
import { CommissioningService } from './commissioning.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CommissioningController],
  providers: [CommissioningService],
  exports: [CommissioningService],
})
export class CommissioningModule {}
