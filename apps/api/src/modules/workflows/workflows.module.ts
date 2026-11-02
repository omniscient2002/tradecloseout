import { Module } from '@nestjs/common';
import { V021WorkflowsService } from './v021-workflows.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [V021WorkflowsService],
  exports: [V021WorkflowsService],
})
export class WorkflowsModule {}
