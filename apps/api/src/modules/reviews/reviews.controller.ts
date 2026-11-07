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
  ValidationPipe,
  Headers,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import {
  ReviewsService,
  DecisionDto,
  ReviewCommentDto,
} from './reviews.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';
import { RequireIdempotency } from '../../common/decorators/idempotency.decorator';
import { DecideVersionReviewDto } from './dto/decide-review.dto';
import { ExternalApprovalDto } from './dto/external-approval.dto';

@Controller('api/v1')
@UseGuards(SessionCsrfGuard, PermissionGuard)
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
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: DecisionDto,
  ) {
    const match = ifMatch?.match(/^"?([1-9]\d*)"?$/);
    const expectedRowVersion = match ? Number(match[1]) : dto.expectedRowVersion;
    return this.reviewsService.decideReview(req.userContext, id, { ...dto, expectedRowVersion });
  }

  @Post('projects/:projectId/reviews')
  @RequirePermission('review.decide')
  async recordProjectReview(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: { documentVersionId: string; decision: any; comment?: string; method?: any; expectedRowVersion?: number },
  ) {
    const match = ifMatch?.match(/^"?([1-9]\d*)"?$/);
    const expectedRowVersion = match ? Number(match[1]) : dto.expectedRowVersion;
    return this.reviewsService.recordVersionReview(req.userContext, projectId, { ...dto, expectedRowVersion });
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

  @Post([
    'projects/:projectId/document-versions/:versionId/decision',
    'projects/:projectId/reviews/:versionId/decision',
    'projects/:projectId/reviews/:versionId',
  ])
  @RequirePermission('review.decide')
  @RequireIdempotency()
  async decideVersionReview(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: DecideVersionReviewDto,
  ) {
    const decisionMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT'> = {
      APPROVE: 'APPROVE',
      APPROVED: 'APPROVE',
      REQUEST_CHANGES: 'REQUEST_CHANGES',
      CHANGES_REQUESTED: 'REQUEST_CHANGES',
      REJECT: 'REJECT',
      REJECTED: 'REJECT',
    };
    const mappedDecision = decisionMap[dto.decision];
    if (!mappedDecision) {
      throw new BadRequestException({
        code: 'INVALID_DECISION',
        detail: `Decision must be one of: APPROVE, APPROVED, REQUEST_CHANGES, CHANGES_REQUESTED, REJECT, REJECTED`,
      });
    }
    const match = ifMatch?.match(/^"?([1-9]\d*)"?$/);
    const expectedRowVersion = match ? Number(match[1]) : dto.expectedRowVersion;
    return this.reviewsService.recordVersionReview(req.userContext, projectId, {
      documentVersionId: versionId,
      decision: mappedDecision,
      comment: dto.comment,
      expectedRowVersion,
      method: dto.method || 'IN_APP',
      occurredAt: dto.occurredAt,
      occurredAtPrecision: dto.occurredAtPrecision,
      backdatingReason: dto.backdatingReason,
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
  @RequirePermission('review.decide')
  @RequireIdempotency()
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
  @RequireIdempotency()
  async recordExternalApproval(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })) dto: ExternalApprovalDto,
  ) {
    const match = ifMatch?.match(/^"([1-9]\d*)"$/);
    if (!match) throw new HttpException({ code: 'IF_MATCH_REQUIRED', detail: 'Supply the current document version in If-Match.' }, 428);
    return this.reviewsService.recordExternalApproval(req.userContext, id, dto, Number(match[1]));
  }

  @Get('projects/:projectId/external-review-options')
  @RequirePermission('review.record_external')
  async getExternalReviewOptions(@Req() req: any, @Param('projectId') projectId: string) {
    return this.reviewsService.getExternalReviewOptions(req.userContext, projectId);
  }
}
