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
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';
import { RequireIdempotency } from '../../common/decorators/idempotency.decorator';
import { parseLifecycleInput } from './project-lifecycle-input';

@Controller('api/v1/projects')
@UseGuards(SessionCsrfGuard, PermissionGuard)
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
    @Body()
    dto: {
      code: string;
      name: string;
      projectType?: string;
      clientPartyId?: string;
      mcPartyId?: string;
      consultantPartyId?: string;
      contractValuePaise?: string | number | bigint;
      startDate?: string;
      targetHandoverDate?: string;
    },
  ) {
    return this.projectsService.createProject(req.userContext, dto);
  }

  @Get(':id')
  @RequirePermission('project.read')
  async getProject(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.getProject(req.userContext, id);
  }

  @Get(':id/dashboard')
  @RequirePermission('project.read')
  async getProjectDashboard(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.getProjectDashboard(req.userContext, id);
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
  @RequireIdempotency()
  async activateProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,false,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.activateProject(ctx,id,input.expectedRowVersion,input.reason);
  }

  @Post(':id/handover')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async handoverProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,false,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.handoverProject(ctx,id,input.expectedRowVersion,input.reason);
  }

  @Post(':id/suspend')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async suspendProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,true,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.suspendProject(ctx,id,input.expectedRowVersion,input.reason);
  }

  @Post(':id/close')
  @RequirePermission('project.close')
  @RequireIdempotency()
  async closeProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,false,true);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.closeProject(ctx,id,input.expectedRowVersion,{closureDate:input.closureDate,reason:input.reason});
  }

  @Post(':id/reopen')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async reopenProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,true,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.reopenProject(ctx,id,input.expectedRowVersion,input.reason);
  }

  @Post(':id/resume')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async resumeProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,true,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.transitionProject(ctx,id,'RESUME',input.expectedRowVersion,input.reason!);
  }

  @Post(':id/cancel')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async cancelProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,true,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.transitionProject(ctx,id,'CANCEL',input.expectedRowVersion,input.reason!);
  }

  @Post(':id/archive')
  @RequirePermission('project.manage')
  @RequireIdempotency()
  async archiveProject(@Req() req:any,@Param('id') id:string,@Body() dto:unknown){
    const input=parseLifecycleInput(dto,true,false);
    const ctx={...req.userContext,idempotencyKey:req.headers?.['idempotency-key']};
    return this.projectsService.transitionProject(ctx,id,'ARCHIVE',input.expectedRowVersion,input.reason!);
  }

  @Get(':id/contracts')
  @RequirePermission('contract.manage')
  async listContracts(@Req() req: any, @Param('id') id: string) {
    return this.projectsService.listContracts(req.userContext, id);
  }

  @Post(':id/contracts')
  @RequirePermission('contract.manage')
  async createContract(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.projectsService.createContract(req.userContext, id, dto);
  }

  @Post(':id/contracts/:contractId/variations')
  @RequirePermission('contract.manage')
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
  @RequirePermission('contract.manage')
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
