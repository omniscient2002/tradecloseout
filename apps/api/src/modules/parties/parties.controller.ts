// apps/api/src/modules/parties/parties.controller.ts
// Guest Access, Grants, Supplier Upload Links & OTP Controller (API-024..029, RT-014)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { PartiesService, CreateGuestGrantDto } from './parties.service';
import { SupplierGuestService } from './supplier-guest.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

export interface VerifyGuestOtpDto {
  code: string;
}

@Controller('api/v1')
export class PartiesController {
  constructor(
    private readonly partiesService: PartiesService,
    private readonly supplierGuestService: SupplierGuestService,
  ) {}

  /**
   * API-021 GET /api/v1/parties
   */
  @Get('parties')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('party.read')
  async getParties(@Req() req: any) {
    return this.partiesService.getParties(req.userContext);
  }

  /**
   * API-022 POST /api/v1/parties
   */
  @Post('parties')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('party.manage')
  async createParty(
    @Req() req: any,
    @Body()
    dto: {
      name: string;
      types: string[];
      gstin?: string;
      email?: string;
      phone?: string;
    },
  ) {
    return this.partiesService.createParty(req.userContext, dto);
  }

  /**
   * API-027 POST /api/v1/projects/:projectId/supplier-links
   */
  @Post('projects/:projectId/supplier-links')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async createSupplierLink(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      supplierPartyId: string;
      requirementIds: string[];
      expiresInDays?: number;
      otpRequired?: boolean;
    },
  ) {
    return this.supplierGuestService.createScopedSupplierUploadLink(req.userContext, projectId, dto);
  }

  /**
   * API-024 POST /api/v1/projects/:projectId/guest-grants
   */
  @Post('projects/:projectId/guest-grants')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('party.manage')
  async createGuestGrant(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateGuestGrantDto,
  ) {
    return this.partiesService.createGuestGrant(req.userContext, projectId, dto);
  }

  /**
   * API-025 POST /api/v1/guest-grants/:id/revoke
   */
  @Post('guest-grants/:id/revoke')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('party.manage')
  async revokeGuestGrant(@Req() req: any, @Param('id') id: string) {
    return this.partiesService.revokeGuestGrant(req.userContext, id);
  }

  /**
   * API-026 POST /api/v1/projects/:projectId/supplier-upload-links
   */
  @Post('projects/:projectId/supplier-upload-links')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async createSupplierUploadLink(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      supplierPartyId: string;
      requirementIds: string[];
      phone?: string;
      email?: string;
      expiresInDays?: number;
    },
  ) {
    return this.partiesService.createSupplierUploadLink(req.userContext, projectId, dto);
  }

  /**
   * API-028 GET /api/v1/guest/:token
   */
  @Get('guest/:token')
  async getGuestGrant(@Param('token') token: string) {
    return this.partiesService.getGuestGrant(token);
  }

  /**
   * API-028A POST /api/v1/guest/:token/otp/request
   */
  @Post('guest/:token/otp/request')
  async requestGuestOtp(@Param('token') token: string) {
    return this.partiesService.requestGuestOtp(token);
  }

  /**
   * API-028B POST /api/v1/guest/:token/otp/verify
   */
  @Post('guest/:token/otp/verify')
  async verifyGuestOtp(
    @Param('token') token: string,
    @Body() body: VerifyGuestOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.code) {
      throw new BadRequestException('OTP code is required');
    }

    const result = await this.partiesService.verifyGuestOtp(token, body.code);

    // Set HTTP-only guest session cookie
    res.cookie('tc_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return {
      activeOrgId: result.activeOrgId,
      grantId: result.grantId,
      csrfToken: result.csrfToken,
    };
  }
}
