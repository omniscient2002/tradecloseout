// apps/api/src/modules/organisations/organisations.controller.ts
// Organisations Controller (API-010..019, FR-ORG, WF-21, AUD-014)

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
import { OrganisationsService } from './organisations.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1/orgs/:orgId')
@UseGuards(SessionCsrfGuard, PermissionGuard)
export class OrganisationsController {
  constructor(private readonly orgsService: OrganisationsService) {}

  @Get('dashboard')
  @RequirePermission('org.read')
  async getDashboard(@Req() req: any, @Param('orgId') orgId: string) {
    return this.orgsService.getDashboard(req.userContext, orgId);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  async getAuditLog(@Req() req: any, @Param('orgId') orgId: string) {
    return this.orgsService.getAuditLog(req.userContext, orgId);
  }

  @Get()
  @RequirePermission('org.read')
  async getOrganisation(@Req() req: any, @Param('orgId') orgId: string) {
    return this.orgsService.getOrganisation(req.userContext, orgId);
  }

  @Patch()
  @RequirePermission('org.manage')
  async updateOrganisation(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Body() dto: any,
  ) {
    return this.orgsService.updateOrganisation(req.userContext, orgId, dto);
  }

  @Get('members')
  @RequirePermission('org.read')
  async listMembers(@Req() req: any, @Param('orgId') orgId: string) {
    return this.orgsService.listMembers(req.userContext, orgId);
  }

  @Post('invitations')
  @RequirePermission('org.manage')
  async createInvitation(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Body() dto: { email: string; role: string },
  ) {
    return this.orgsService.createInvitation(req.userContext, orgId, dto);
  }

  @Delete('invitations/:id')
  @RequirePermission('org.manage')
  async revokeInvitation(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Param('id') invitationId: string,
  ) {
    return this.orgsService.revokeInvitation(req.userContext, orgId, invitationId);
  }

  @Patch('members/:userId')
  @RequirePermission('org.manage')
  async updateMemberRole(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: { role: string },
  ) {
    return this.orgsService.updateMemberRole(req.userContext, orgId, targetUserId, dto);
  }

  @Get('members/:userId/offboarding-gap-report')
  @RequirePermission('org.manage')
  async getOffboardingGapReport(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.orgsService.getOffboardingGapReport(req.userContext, orgId, targetUserId);
  }

  @Delete('members/:userId')
  @RequirePermission('org.manage')
  async removeMember(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body('reassignToUserId') reassignToUserId?: string,
  ) {
    return this.orgsService.removeMember(req.userContext, orgId, targetUserId, reassignToUserId);
  }

  @Post('transfer-ownership')
  @RequirePermission('org.transfer_ownership')
  async transferOwnership(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Body() dto: { targetUserId: string },
  ) {
    return this.orgsService.transferOwnership(req.userContext, dto.targetUserId);
  }

  @Post('reassign-work')
  @RequirePermission('org.manage')
  async reassignWork(
    @Req() req: any,
    @Param('orgId') orgId: string,
    @Body() dto: { fromUserId: string; toUserId: string },
  ) {
    return this.orgsService.reassignWork(req.userContext, orgId, dto);
  }
}
