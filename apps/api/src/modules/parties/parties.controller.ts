// apps/api/src/modules/parties/parties.controller.ts
// Guest Access & OTP Verification Controller (API-028, API-028A, API-028B, RT-014)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { PartiesService } from './parties.service';

export interface VerifyGuestOtpDto {
  code: string;
}

@Controller('api/v1/guest')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  /**
   * API-028 GET /api/v1/guest/:token
   */
  @Get(':token')
  async getGuestGrant(@Param('token') token: string) {
    return this.partiesService.getGuestGrant(token);
  }

  /**
   * API-028A POST /api/v1/guest/:token/otp/request
   */
  @Post(':token/otp/request')
  async requestGuestOtp(@Param('token') token: string) {
    return this.partiesService.requestGuestOtp(token);
  }

  /**
   * API-028B POST /api/v1/guest/:token/otp/verify
   */
  @Post(':token/otp/verify')
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
