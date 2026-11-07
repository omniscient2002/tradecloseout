import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  CommissioningService,
  CreateTabWorksheetInput,
  CreateInspectionInput,
  CreateSeasonalScheduleInput,
} from './commissioning.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller(['api/v1/projects/:projectId/commissioning', 'projects/:projectId/commissioning'])
export class CommissioningController {
  constructor(private readonly commissioningService: CommissioningService) {}

  @Post('tab-worksheets')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async recordTabWorksheet(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTabWorksheetInput,
  ) {
    return this.commissioningService.recordTabWorksheet(req.userContext, projectId, dto);
  }

  @Get('tab-worksheets')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async listTabWorksheets(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('assetId') assetId?: string,
  ) {
    return this.commissioningService.listTabWorksheets(req.userContext, projectId, assetId);
  }

  @Post('inspections')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async recordQualityInspection(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateInspectionInput,
  ) {
    return this.commissioningService.recordQualityInspection(req.userContext, projectId, dto);
  }

  @Post('inspections/:id/witness-sign')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async signInspectionWitness(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') inspectionId: string,
    @Body() dto: { partyName: string; representativeName: string; role: string; notes?: string },
  ) {
    return this.commissioningService.signInspectionWitness(req.userContext, projectId, inspectionId, dto);
  }

  @Post('seasonal-schedules')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('project.manage')
  async createSeasonalSchedule(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSeasonalScheduleInput,
  ) {
    return this.commissioningService.createSeasonalSchedule(req.userContext, projectId, dto);
  }

  @Get('seasonal-schedules')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('project.read')
  async listSeasonalSchedules(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    return this.commissioningService.listSeasonalSchedules(req.userContext, projectId);
  }

  @Put(['seasonal-schedules/:id', 'seasonal/:id'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('project.manage')
  async updateSeasonalSchedulePut(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') scheduleId: string,
    @Body() dto: { status: string; testResults?: Record<string, any>; notes?: string },
  ) {
    return this.commissioningService.updateSeasonalSchedule(req.userContext, projectId, scheduleId, dto);
  }

  @Patch(['seasonal-schedules/:id', 'seasonal/:id'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('project.manage')
  async updateSeasonalSchedulePatch(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') scheduleId: string,
    @Body() dto: { status: string; testResults?: Record<string, any>; notes?: string },
  ) {
    return this.commissioningService.updateSeasonalSchedule(req.userContext, projectId, scheduleId, dto);
  }
}
