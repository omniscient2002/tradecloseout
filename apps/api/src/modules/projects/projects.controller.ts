// apps/api/src/modules/projects/projects.controller.ts
// Projects Controller (API-030..044)

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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

  @Patch(':id')
  @RequirePermission('project.manage')
  async updateProject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { name?: string; code?: string; clientPartyId?: string },
  ) {
    return this.projectsService.updateProject(req.userContext, id, dto);
  }

  @Post(':id/activate')
  @RequirePermission('project.manage')
  async activateProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.activateProject(req.userContext, id);
  }

  @Post(':id/suspend')
  @RequirePermission('project.manage')
  async suspendProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.suspendProject(req.userContext, id);
  }

  @Post(':id/close')
  @RequirePermission('project.manage')
  async closeProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.closeProject(req.userContext, id);
  }

  @Get(':id/contracts')
  @RequirePermission('project.read')
  async listContracts(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.listContracts(req.userContext, id);
  }

  @Post(':id/contracts')
  @RequirePermission('project.manage')
  async createContract(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.projectsService.createContract(req.userContext, id, dto);
  }

  @Post(':id/contracts/:contractId/variations')
  @RequirePermission('project.manage')
  async createVariation(
    @Req() req: any,
    @Param('id') id: string,
    @Param('contractId') contractId: string,
    @Body() dto: any,
  ) {
    return this.projectsService.createVariation(req.userContext, id, contractId, dto);
  }

  @Get(':id/specifications')
  @RequirePermission('project.read')
  async listSpecifications(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.listSpecifications(req.userContext, id);
  }

  @Post(':id/specifications')
  @RequirePermission('project.manage')
  async createSpecification(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.projectsService.createSpecification(req.userContext, id, dto);
  }

  @Get(':id/members')
  @RequirePermission('project.read')
  async listProjectMembers(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.listProjectMembers(req.userContext, id);
  }

  @Post(':id/members')
  @RequirePermission('project.manage')
  async addProjectMember(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { userId: string; role: string },
  ) {
    return this.projectsService.addProjectMember(req.userContext, id, dto);
  }

  @Delete(':id/members/:userId')
  @RequirePermission('project.manage')
  async removeProjectMember(
    @Req() req: any,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.projectsService.removeProjectMember(req.userContext, id, targetUserId);
  }
}
