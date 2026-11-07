import { Module } from '@nestjs/common';
import { HandoverService } from './handover.service';
import { HandoverController } from './handover.controller';
import { DatabaseModule } from '../../database/database.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DatabaseModule, DocumentsModule],
  controllers: [HandoverController],
  providers: [HandoverService],
  exports: [HandoverService],
})
export class HandoverModule {}
