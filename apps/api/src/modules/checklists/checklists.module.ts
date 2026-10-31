import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service';

@Module({
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
