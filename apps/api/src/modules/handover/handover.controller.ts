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
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { HandoverService } from './handover.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';
import { RequireIdempotency } from '../../common/decorators/idempotency.decorator';
import { GenerateHandoverPackageDto, SubmitPackageDto } from './dto/handover-packages.dto';

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
  @RequirePermission('package.download')
  async listPackages(@Req() req: any, @Param('projectId') projectId: string) {
    return this.handoverService.listPackages(req.userContext, projectId);
  }

  /**
   * API-110: POST /api/v1/projects/:projectId/packages
   */
  @Post(['projects/:projectId/packages', 'projects/:projectId/handover/packages'])
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.generate')
  @RequireIdempotency()
  async generateHandoverPackage(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateHandoverPackageDto,
  ) {
    return this.handoverService.requestHandoverPackageGeneration(req.userContext, projectId, dto);
  }

  /**
   * API-111: GET /api/v1/packages/:id
   */
  @Get('packages/:id')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.download')
  async getPackage(@Req() req: any, @Param('id') id: string) {
    return this.handoverService.getPackage(req.userContext, id);
  }

  @Get('projects/:projectId/packages/:id')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.download')
  async getProjectPackage(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.handoverService.getProjectPackage(req.userContext, projectId, id);
  }

  @Get('projects/:projectId/packages/:packageId/download')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.download')
  async getPackageDownloadUrl(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('packageId') packageId: string,
  ) {
    return this.handoverService.getPackageDownloadUrl(req.userContext, projectId, packageId);
  }

  /**
   * API-114: POST /api/v1/packages/:id/submit
   */
  @Post('packages/:id/submit')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.submit')
  @RequireIdempotency()
  async submitPackage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitPackageDto,
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
    @Body()
    body: {
      decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT' | 'ACCEPTED' | 'ACCEPTED_WITH_EXCEPTIONS' | 'REJECTED' | string;
      remarks?: string;
      comment?: string;
      exceptionItems?: Array<{ title: string; docTypeKey: string; reason: string }>;
    },
  ) {
    const rawDecision = String(body?.decision || '').trim().toUpperCase();
    let decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT';
    if (rawDecision === 'ACCEPT' || rawDecision === 'ACCEPTED') {
      decision = 'ACCEPT';
    } else if (rawDecision === 'ACCEPT_WITH_EXCEPTIONS' || rawDecision === 'ACCEPTED_WITH_EXCEPTIONS') {
      decision = 'ACCEPT_WITH_EXCEPTIONS';
    } else if (rawDecision === 'REJECT' || rawDecision === 'REJECTED') {
      decision = 'REJECT';
    } else {
      throw new BadRequestException({
        code: 'INVALID_DECISION',
        title: 'Invalid submission decision',
        detail: `Decision '${body?.decision}' is unrecognized. Expected ACCEPT, ACCEPT_WITH_EXCEPTIONS, or REJECT.`,
      });
    }

    const remarks = body.remarks !== undefined ? body.remarks : body.comment;

    return this.handoverService.recordRecipientSubmissionDecision(
      req.userContext,
      '',
      submissionId,
      {
        recipientPartyId: recipientId,
        decision,
        remarks,
        exceptionItems: body.exceptionItems,
      },
    );
  }

  /**
   * Downloads the latest verified full dossier produced by the worker.
   * Presigned storage URL expires in 15 minutes; no synthetic PDF is returned.
   */
  @Get('projects/:projectId/dossier/pdf')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('package.download')
  async getDossierPdf(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const artifact = await this.handoverService.getLatestDossierDownloadUrl(
      req.userContext, projectId,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, artifact.downloadUrl);
  }

  /**
   * API-125: POST /api/v1/projects/:projectId/archive-exports
   * Generates a portable, self-verifying project archive manifest & verification receipt (Top 25 Item 7).
   */
  @Post('projects/:projectId/archive-exports')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('export.data')
  @RequireIdempotency()
  async exportProjectArchive(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { purpose?: string; includeArchiveFile?: boolean },
  ) {
    return this.handoverService.exportProjectArchive(req.userContext, projectId, dto);
  }

  /**
   * API-126: GET /api/v1/projects/:projectId/archive-exports
   */
  @Get('projects/:projectId/archive-exports')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('export.data')
  async listArchiveExports(@Req() req: any, @Param('projectId') projectId: string) {
    return this.handoverService.listArchiveExports(req.userContext, projectId);
  }

  /**
   * API-127: GET /api/v1/projects/:projectId/archive-exports/:exportId
   */
  @Get('projects/:projectId/archive-exports/:exportId')
  @UseGuards(SessionCsrfGuard, PermissionGuard)
  @RequirePermission('export.data')
  async getArchiveExport(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.handoverService.getArchiveExport(req.userContext, projectId, exportId);
  }
}
