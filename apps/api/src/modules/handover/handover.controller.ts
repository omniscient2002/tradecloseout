// apps/api/src/modules/handover/handover.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HandoverService } from './handover.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  /**
   * API-118: GET /api/v1/projects/:id/readiness
   */
  @Get('projects/:projectId/handover/readiness')
  @UseGuards(SessionAuthGuard, PermissionGuard)
  @RequirePermission('package.generate')
  async evaluateReadiness(@Req() req: any, @Param('projectId') projectId: string) {
    return this.handoverService.evaluateProjectReadiness(req.userContext, projectId);
  }

  /**
   * API-110: POST /api/v1/projects/:id/packages
   */
  @Post('projects/:projectId/handover/packages')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
   * API-112: POST /api/v1/projects/:id/handover/ra-bill-pack
   */
  @Post('projects/:projectId/handover/ra-bill-pack')
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
  @UseGuards(SessionAuthGuard, PermissionGuard)
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
}
