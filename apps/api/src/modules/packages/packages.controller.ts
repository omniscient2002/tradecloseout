// apps/api/src/modules/packages/packages.controller.ts
// Packages & Submissions Controller (API-110..118B)

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { PackagesService } from './packages.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get('projects/:projectId/dossier/pdf')
  @RequirePermission('document.read')
  async getDossierPdf(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const pdfBytes = await this.packagesService.generateDossierPdf(req.userContext, projectId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Handover-Dossier-${projectId}.pdf`);
    res.send(Buffer.from(pdfBytes));
  }

  @Post('submissions/:submissionId/recipients/:recipientId/decision')
  @RequirePermission('package.accept')
  async recordRecipientDecision(
    @Req() req: any,
    @Param('submissionId') submissionId: string,
    @Param('recipientId') recipientId: string,
    @Body('decision') decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT',
    @Body('comment') comment?: string,
  ) {
    return this.packagesService.recordRecipientDecision(
      req.userContext,
      submissionId,
      recipientId,
      decision,
      comment,
    );
  }
}
