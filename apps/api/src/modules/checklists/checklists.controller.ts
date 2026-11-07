// apps/api/src/modules/checklists/checklists.controller.ts
// Checklists & Waivers Controller (API-050..067)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChecklistsService } from './checklists.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionCsrfGuard, PermissionGuard)
export class ChecklistsController {
  constructor(private readonly checklistsService: ChecklistsService) {}

  @Get('projects/:projectId/requirements')
  @RequirePermission('document.read')
  async listRequirements(@Req() req: any, @Param('projectId') projectId: string) {
    return this.checklistsService.listRequirements(req.userContext, projectId);
  }

  @Post('projects/:projectId/requirements')
  @RequirePermission('checklist.manage')
  async createRequirement(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { key: string; title: string; groupKey?: string; docTypeCode?: string; mandatory?: boolean; assetTag?: string; dueDate?: string },
  ) {
    return this.checklistsService.createRequirement(req.userContext, projectId, dto);
  }

  @Post(['projects/:projectId/snapshots', 'projects/:projectId/checklist/snapshots'])
  @RequirePermission('project.manage')
  async createSnapshot(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto?: { comment?: string },
  ) {
    return this.checklistsService.createSnapshot(req.userContext, projectId, dto);
  }

  @Post(['projects/:projectId/checklists/import-l3', 'projects/:projectId/checklist/import-l3'])
  @RequirePermission('project.manage')
  async importL3Checklist(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      profileName?: string;
      requirements: Array<{
        key?: string;
        title: string;
        docTypeKey?: string;
        groupKey?: string;
        mandatory?: boolean;
        scopeType?: 'PROJECT' | 'ASSET_CATEGORY' | 'ASSET';
        assetCategoryKey?: string;
        assetId?: string;
      }>;
    },
  ) {
    return this.checklistsService.importL3Checklist(req.userContext, projectId, dto);
  }

  @Post('projects/:projectId/requirements/:id/change-requests')
  @RequirePermission('checklist.manage')
  async requestChange(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') requirementId: string,
    @Body() dto: { changeType: 'ADD' | 'REMOVE' | 'MODIFY'; reason: string; deltaJson?: any },
  ) {
    return this.checklistsService.requestChange(req.userContext, projectId, requirementId, dto);
  }

  @Get('projects/:projectId/change-requests')
  @RequirePermission('document.read')
  async listChangeRequests(@Req() req: any, @Param('projectId') projectId: string) {
    return this.checklistsService.listChangeRequests(req.userContext, projectId);
  }

  @Post('change-requests/:id/decide')
  @RequirePermission('checklist.manage')
  async decideChangeRequest(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return this.checklistsService.decideChangeRequest(req.userContext, id, dto);
  }

  @Post('requirements/:id/waivers')
  @RequirePermission('requirement.waive')
  async requestWaiver(
    @Req() req: any,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('type') type?: 'WAIVE' | 'NOT_APPLICABLE',
  ) {
    return this.checklistsService.requestWaiver(req.userContext, id, reason, type);
  }

  @Post([
    'waivers/:id/countersign',
    'projects/:projectId/checklists/waivers/:id/countersign',
    'projects/:projectId/waivers/:id/countersign',
    'requirements/:id/waivers/countersign',
    'requirements/:id/waivers/approve',
  ])
  @RequirePermission('requirement.waive_second')
  async countersignWaiver(@Req() req: any, @Param('id') id: string) {
    return this.checklistsService.countersignWaiver(req.userContext, id);
  }
}
