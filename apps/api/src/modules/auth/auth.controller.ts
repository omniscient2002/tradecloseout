// apps/api/src/modules/auth/auth.controller.ts
// Auth Controller (API-001..009B)

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService, OtpRequestDto, OtpVerifyDto } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  async requestOtp(@Body() dto: any) {
    const res = await this.authService.requestOtp(dto);
    return {
      channel: dto.identifier?.includes('@') ? 'EMAIL' : 'SMS',
      expiresInSeconds: 300,
      devOtpPreview: (res as any).debugOtp || (res as any).devOtpPreview,
      ...res,
    };
  }

  @Post('otp/verify')
  async verifyOtp(
    @Body() dto: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const normalizedDto = {
      ...dto,
      code: dto.code || dto.otp,
    };
    const result = await this.authService.verifyOtp(normalizedDto);

    // Set HTTP-only session cookie
    res.cookie('tc_session', result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return {
      user: result.user,
      activeOrgId: result.activeOrgId,
      csrfToken: result.csrfToken,
    };
  }

  @Get('orgs')
  async listOrgs(@Req() req: any) {
    const session = await this.extractSession(req);
    return this.authService.getUserOrgs(session.user_id);
  }

  @Post('switch-org')
  async switchOrg(
    @Req() req: any,
    @Body('orgId') targetOrgId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.extractSession(req);
    const result = await this.authService.switchOrg(session.user_id, session.id, targetOrgId);
    return result;
  }

  @Get('me')
  async me(@Req() req: any) {
    const session = await this.extractSession(req);
    return {
      userId: session.user_id,
      name: session.user_name,
      activeOrgId: session.active_org_id,
      orgRole: session.org_role,
    };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('tc_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { ok: true, message: 'Logged out successfully' };
  }

  @Get('logout')
  async logoutGet(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('tc_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { ok: true, message: 'Logged out successfully' };
  }

  private async extractSession(req: Request) {
    const token = req.cookies?.['tc_session'] || (req.headers['authorization']?.replace(/^Bearer /, ''));
    if (!token) {
      throw new UnauthorizedException('SESSION_MISSING');
    }
    const session = await this.authService.getSessionByToken(token);
    if (!session) {
      throw new UnauthorizedException('SESSION_INVALID');
    }
    return session;
  }
}
