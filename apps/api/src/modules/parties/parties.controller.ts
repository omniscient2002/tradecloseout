import { assertAuthenticationOrigin, AUTH_INTENT_COOKIE, hashAuthIntent, setAuthenticationIntent } from '../identity/auth-security';
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
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

export interface VerifyGuestOtpDto {
  code?: string;
  otp?: string;
  challengeId?: string;
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
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('party.read')
  async getParties(@Req() req: any) {
    return this.partiesService.getParties(req.userContext);
  }

  /**
   * API-022 POST /api/v1/parties
   */
  @Post('parties')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
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
  @UseGuards(SessionCsrfGuard, PermissionGuard)
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
  @UseGuards(SessionCsrfGuard, PermissionGuard)
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
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('party.manage')
  async revokeGuestGrant(@Req() req: any, @Param('id') id: string) {
    return this.partiesService.revokeGuestGrant(req.userContext, id);
  }

  /**
   * API-026 POST /api/v1/projects/:projectId/supplier-upload-links
   */
  @Post('projects/:projectId/supplier-upload-links')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
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
   * API-029A POST /api/v1/projects/:projectId/procurement-orders
   * PO & vendor-document obligation schedule (Top 25 Item 2).
   */
  @Post('projects/:projectId/procurement-orders')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('party.manage')
  async createProcurementOrder(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: any,
  ) {
    return this.partiesService.createProcurementOrder(req.userContext, projectId, dto);
  }

  /**
   * API-029B GET /api/v1/projects/:projectId/procurement-orders
   */
  @Get('projects/:projectId/procurement-orders')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('party.read')
  async listProcurementOrders(
    @Req() req: any,
    @Param('projectId') projectId: string,
  ) {
    return this.partiesService.listProcurementOrders(req.userContext, projectId);
  }

  /**
   * API-028 GET /api/v1/guest/:token
   */
  @Get('guest/:token')
  async getGuestGrant(@Param('token') token: string) {
    return this.partiesService.getGuestGrant(token);
  }

  @Get('guest/me/context')
  @UseGuards(SessionCsrfGuard)
  async getGuestSessionContext(@Req() req: any) {
    return this.partiesService.getGuestSessionContext(req.userContext);
  }

  /**
   * API-028A POST /api/v1/guest/:token/otp/request
   */
  @Post('guest/:token/otp/request')
  async requestGuestOtp(
    @Param('token') token: string, @Req() req?: any,
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertAuthenticationOrigin(req);
    const intentHash = setAuthenticationIntent(res);
    return this.partiesService.requestGuestOtp(
      token, String(req?.ip || req?.socket?.remoteAddress || 'unknown'), intentHash,
    );
  }

  /**
   * API-028B POST /api/v1/guest/:token/otp/verify
   */
  @Post('guest/:token/otp/verify')
  async verifyGuestOtp(
    @Param('token') token: string,
    @Body() body: VerifyGuestOtpDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: any,
  ) {
    assertAuthenticationOrigin(req);
    const code = body?.code || (body as any)?.otp;
    if (!code || !body?.challengeId) {
      throw new BadRequestException('OTP code and challenge ID are required');
    }

    const rawIntent = req?.cookies?.[AUTH_INTENT_COOKIE];
    const intentHash = typeof rawIntent === 'string' ? hashAuthIntent(rawIntent) : null;
    const result = await this.partiesService.verifyGuestOtp(token, code, body.challengeId, intentHash);
    res.clearCookie(AUTH_INTENT_COOKIE, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'strict', path: '/',
    });

    // Set HTTP-only guest session cookie
    res.cookie('tc_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return {
      activeOrgId: result.activeOrgId,
      grantId: result.grantId,
      csrfToken: result.csrfToken,
      authGeneration: 'authGeneration' in result ? result.authGeneration : undefined,
    };
  }

  /**
   * API-028C POST /api/v1/guest/:token/session
   * Legacy session exchange is disabled; guests authenticate through OTP verification.
   */
  @Post('guest/:token/session')
  async createGuestSession(
    @Param('token') token: string,
    @Body('pin') pin: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.partiesService.createGuestSession(token, pin);

    res.cookie('tc_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return {
      activeOrgId: result.activeOrgId,
      grantId: result.grantId,
      csrfToken: result.csrfToken,
      authGeneration: 'authGeneration' in result ? result.authGeneration : undefined,
    };
  }

  @Post([
    'projects/:projectId/supplier-obligations/:id/intake',
    'projects/:projectId/supplier-document-obligations/:id/intake',
  ])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async intakeSupplierObligation(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') obligationId: string,
    @Body() dto: { decision?: 'ACCEPT' | 'REJECT'; notes?: string; documentVersionId?: string },
  ) {
    return this.partiesService.intakeSupplierObligation(req.userContext, projectId, obligationId, dto);
  }
}
