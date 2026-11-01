// apps/api/src/modules/notifications/notifications.controller.ts
// Notifications & Owner Digest Controller (API-130..135)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @RequirePermission('document.read')
  async listNotifications(@Req() req: any) {
    return this.notificationsService.listNotifications(req.userContext);
  }

  @Post('notifications')
  @RequirePermission('document.read')
  async createNotification(
    @Req() req: any,
    @Body()
    dto: {
      projectId?: string;
      channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';
      eventKey: string;
      payload: Record<string, any>;
      dedupKey: string;
      isUrgent?: boolean;
    },
  ) {
    return this.notificationsService.createNotification(req.userContext, dto);
  }

  @Get('projects/:projectId/owner-digest')
  @RequirePermission('project.read')
  async getOwnerDigest(@Req() req: any, @Param('projectId') projectId: string) {
    return this.notificationsService.getOwnerDigest(req.userContext, projectId);
  }
}
