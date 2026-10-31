// apps/api/src/modules/packages/packages.controller.ts
// Packages & Submissions Controller (API-110..118B)

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PackagesService } from './packages.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

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
