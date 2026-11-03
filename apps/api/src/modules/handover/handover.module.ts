import { Module } from '@nestjs/common';
import { HandoverService } from './handover.service';
import { HandoverController } from './handover.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [HandoverController],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class HandoverModule {}
