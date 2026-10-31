// apps/api/src/modules/reviews/reviews.controller.ts
// Reviews Controller (API-100..106)

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReviewsService, DecisionDto, ExternalApprovalDto } from './reviews.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('reviews/:id/decisions')
  @RequirePermission('review.decide')
  async decideReview(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.reviewsService.decideReview(req.userContext, id, dto);
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
