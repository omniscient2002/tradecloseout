import { Controller, Post, Get, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { DigitalSignatureService, RecordCryptographicSignatureInput } from './digital-signature.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class DigitalSignatureController {
  constructor(private readonly signatureService: DigitalSignatureService) {}

  @Post('projects/:projectId/signatures')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.upload')
  async recordSignature(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: Omit<RecordCryptographicSignatureInput, 'projectId'>,
  ) {
    return this.signatureService.recordCryptographicSignature(req.userContext, {
      ...dto,
      projectId,
    });
  }

  @Get('signatures/verify/:code')
  async verifySignature(
    @Param('code') code: string,
    @Query('sha256') sha256?: string,
  ) {
    return this.signatureService.verifySignatureByCode(code, sha256);
  }
}
