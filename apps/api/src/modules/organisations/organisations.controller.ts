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
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1/orgs/:orgId')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class OrganisationsController {
  constructor(private readonly orgsService: OrganisationsService) {}

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
  @RequirePermission('org.manage')
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
