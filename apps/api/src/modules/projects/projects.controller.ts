// apps/api/src/modules/projects/projects.controller.ts
// Projects Controller (API-030..034)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1/projects')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @RequirePermission('project.read')
  async listProjects(@Req() req: any) {
    return this.projectsService.listProjects(req.userContext);
  }

  @Post()
  @RequirePermission('project.create')
  async createProject(
    @Req() req: any,
    @Body() dto: { code: string; name: string; projectType?: string; clientPartyId?: string },
  ) {
    return this.projectsService.createProject(req.userContext, dto);
  }

  @Get(':id')
  @RequirePermission('project.read')
  async getProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.getProject(req.userContext, id);
  }

  @Post(':id/activate')
  @RequirePermission('project.manage')
  async activateProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.activateProject(req.userContext, id);
  }
}
