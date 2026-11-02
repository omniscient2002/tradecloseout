// apps/api/src/modules/reviews/reviews.controller.ts
// Reviews Controller (API-062, API-100..107)

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ReviewsService,
  DecisionDto,
  ExternalApprovalDto,
  ReviewCommentDto,
} from './reviews.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('requirements/:id/submit-review')
  @RequirePermission('document.upload')
  async submitReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { documentVersionId: string; remarks?: string },
  ) {
    return this.reviewsService.submitReview(req.userContext, id, dto);
  }

  @Get('projects/:projectId/reviews')
  @RequirePermission('review.decide')
  async listReviews(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
  ) {
    return this.reviewsService.listReviews(req.userContext, projectId, { status });
  }

  @Get('reviews/:id')
  @RequirePermission('review.decide')
  async getReview(@Req() req: any, @Param('id') id: string) {
    return this.reviewsService.getReview(req.userContext, id);
  }

  @Post('reviews/:id/decisions')
  @RequirePermission('review.decide')
  async decideReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.reviewsService.decideReview(req.userContext, id, dto);
  }

  @Post('projects/:projectId/reviews')
  @RequirePermission('review.decide')
  async recordProjectReview(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { documentVersionId: string; decision: any; comment?: string; method?: any },
  ) {
    return this.reviewsService.recordVersionReview(req.userContext, projectId, dto);
  }

  @Get('projects/:projectId/document-versions/:versionId')
  @RequirePermission('document.read')
  async getVersionReviewDetail(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.reviewsService.getVersionReviewDetail(req.userContext, projectId, versionId);
  }

  @Post('projects/:projectId/document-versions/:versionId/decision')
  @RequirePermission('review.decide')
  async decideVersionReview(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Body() dto: { method: string; decision: any; comment?: string },
  ) {
    return this.reviewsService.recordVersionReview(req.userContext, projectId, {
      documentVersionId: versionId,
      decision: dto.decision,
      comment: dto.comment,
      method: dto.method,
    });
  }

  @Post('reviews/:id/comments')
  @RequirePermission('review.decide')
  async addComment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewCommentDto,
  ) {
    return this.reviewsService.addComment(req.userContext, id, dto);
  }

  @Post('reviews/:id/override')
  @RequirePermission('review.override')
  async overrideReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: { justification: string; decision: 'APPROVE' | 'REJECT' },
  ) {
    return this.reviewsService.overrideReview(req.userContext, id, dto);
  }

  @Post('reviews/bulk-decisions')
  @RequirePermission('review.decide')
  async bulkDecisions(
    @Req() req: any,
    @Body() dto: { reviewIds: string[]; decision: 'APPROVE' | 'REJECT'; comment?: string },
  ) {
    return this.reviewsService.bulkDecisions(req.userContext, dto);
  }

  @Post('document-versions/:id/external-approval')
  @RequirePermission('review.record_external')
  async recordExternalApproval(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ExternalApprovalDto,
  ) {
    return this.reviewsService.recordExternalApproval(req.userContext, id, dto);
  }
}
