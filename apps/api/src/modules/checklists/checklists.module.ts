import { Module } from '@nestjs/common';
import { ChecklistsService } from './checklists.service';
import { ChecklistsController } from './checklists.controller';

@Module({
  imports: [],
  controllers: [ChecklistsController],
  providers: [ChecklistsService],
  exports: [ChecklistsService],
})
export class ChecklistsModule {}
