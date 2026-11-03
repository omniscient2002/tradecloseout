// apps/api/src/modules/handover/handover.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { HandoverService } from './handover.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  /**
   * API-118: GET /api/v1/projects/:projectId/readiness
   */
  @Get(['projects/:projectId/readiness', 'projects/:projectId/handover/readiness', 'projects/:projectId/packages/readiness'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.generate')
  async evaluateReadiness(@Req() req: any, @Param('projectId') projectId: string) {
    return this.handoverService.evaluateProjectReadiness(req.userContext, projectId);
  }

  /**
   * API-110: GET /api/v1/projects/:projectId/packages
   */
  @Get('projects/:projectId/packages')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async listPackages(@Req() req: any, @Param('projectId') projectId: string) {
    return this.handoverService.listPackages(req.userContext, projectId);
  }

  /**
   * API-110: POST /api/v1/projects/:projectId/packages
   */
  @Post(['projects/:projectId/packages', 'projects/:projectId/handover/packages'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.generate')
  async generateHandoverPackage(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      overrideReason?: string;
      excludedRequirementIds?: Array<{ requirementId: string; reason: string }>;
    },
  ) {
    return this.handoverService.requestHandoverPackageGeneration(req.userContext, projectId, dto);
  }

  /**
   * API-111: GET /api/v1/packages/:id
   */
  @Get('packages/:id')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async getPackage(@Req() req: any, @Param('id') id: string) {
    return this.handoverService.getPackage(req.userContext, id);
  }

  /**
   * API-114: POST /api/v1/packages/:id/submit
   */
  @Post('packages/:id/submit')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.submit')
  async submitPackage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: {
      recipients: Array<{
        partyId?: string;
        email: string;
        name: string;
        isRequiredApprover?: boolean;
        role?: string;
      }>;
      coverNote?: string;
    },
  ) {
    return this.handoverService.createSubmission(req.userContext, '', {
      packageId: id,
      recipients: dto.recipients,
      coverNote: dto.coverNote,
    });
  }

  /**
   * API-113: POST /api/v1/projects/:projectId/submissions
   */
  @Post('projects/:projectId/submissions')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.submit')
  async createSubmission(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: {
      packageId?: string;
      recipients: Array<{
        partyId?: string;
        email: string;
        name: string;
        isRequiredApprover?: boolean;
        role?: string;
      }>;
      coverNote?: string;
    },
  ) {
    return this.handoverService.createSubmission(req.userContext, projectId, dto);
  }

  /**
   * API-112: POST /api/v1/projects/:projectId/handover/ra-bill-pack
   */
  @Post('projects/:projectId/handover/ra-bill-pack')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.generate')
  async compileRaBillEvidencePack(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      milestoneKey: 'MOBILISATION' | 'SUBMISSION' | 'DELIVERY' | 'INSTALLATION' | 'COMMISSIONING' | 'HANDOVER' | 'FINAL_BILL';
      billNumber: string;
      billAmountInr?: number;
      description?: string;
    },
  ) {
    return this.handoverService.compileRaBillEvidencePack(req.userContext, projectId, dto);
  }

  /**
   * API-115: POST /api/v1/projects/:projectId/submissions/:submissionId/decision
   */
  @Post('projects/:projectId/submissions/:submissionId/decision')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.accept')
  async recordSubmissionDecision(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('submissionId') submissionId: string,
    @Body()
    dto: {
      recipientPartyId: string;
      decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT';
      remarks?: string;
      exceptionItems?: Array<{ title: string; docTypeKey: string; reason: string }>;
    },
  ) {
    return this.handoverService.recordRecipientSubmissionDecision(
      req.userContext,
      projectId,
      submissionId,
      dto,
    );
  }

  /**
   * API-117: POST /api/v1/submissions/:submissionId/recipients/:recipientId/decision
   */
  @Post('submissions/:submissionId/recipients/:recipientId/decision')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.accept')
  async recordRecipientDecision(
    @Req() req: any,
    @Param('submissionId') submissionId: string,
    @Param('recipientId') recipientId: string,
    @Body('decision') decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT',
    @Body('comment') comment?: string,
  ) {
    return this.handoverService.recordRecipientSubmissionDecision(
      req.userContext,
      '',
      submissionId,
      {
        recipientPartyId: recipientId,
        decision,
        remarks: comment,
      },
    );
  }

  /**
   * Pure-Node front matter and TOC PDF for Handover Dossier
   */
  @Get('projects/:projectId/dossier/pdf')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('document.read')
  async getDossierPdf(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const pdfBytes = await this.handoverService.generateDossierPdf(req.userContext, projectId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Handover-Dossier-${projectId}.pdf`);
    res.send(Buffer.from(pdfBytes));
  }
}
