// apps/api/src/modules/checklists/checklists.controller.ts
// Checklists & Waivers Controller (API-050..061A)

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
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ChecklistsController {
  constructor(private readonly checklistsService: ChecklistsService) {}

  @Get('projects/:projectId/requirements')
  @RequirePermission('document.read')
  async listRequirements(@Req() req: any, @Param('projectId') projectId: string) {
    return this.checklistsService.listRequirements(req.userContext, projectId);
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

  @Post('waivers/:id/countersign')
  @RequirePermission('requirement.waive_second')
  async countersignWaiver(@Req() req: any, @Param('id') id: string) {
    return this.checklistsService.countersignWaiver(req.userContext, id);
  }
}
