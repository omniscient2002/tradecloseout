import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { WorkItemsService } from './work-items.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller(['api/v1/work-items', 'work-items'])
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  @Get()
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('project.read')
  async listWorkItems(
    @Req() req: any,
    @Query('projectId') projectId?: string,
    @Query('type') type?: string,
    @Query('priority') priority?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.workItemsService.listWorkItems(req.userContext, {
      projectId,
      type,
      priority,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
