// apps/api/src/modules/notifications/notifications.controller.ts
// Notifications & Owner Digest Controller (API-130..135)

import {
  Controller,
  Get,
  Query,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionCsrfGuard, PermissionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @RequirePermission('notification.read')
  async listNotifications(@Req() req: any) {
    return this.notificationsService.listNotifications(req.userContext);
  }

  @Get('notifications/operations') @RequirePermission('notification.manage')
  operations(@Req()req:any){return this.notificationsService.operationalMetrics(req.userContext);}

  @Get('notifications/inbox') @RequirePermission('notification.read')
  inbox(@Req()req:any,@Query('limit')limit?:string,@Query('cursor')cursor?:string){return this.notificationsService.inbox(req.userContext,limit===undefined?25:Number(limit),cursor);}
  @Get('notifications/:id/attempts') @RequirePermission('notification.manage')
  attempts(@Req()req:any,@Param('id')id:string){return this.notificationsService.attemptHistory(req.userContext,id);}
  @Post('notifications/:id/read') @RequirePermission('notification.read')
  read(@Req()req:any,@Param('id')id:string){return this.notificationsService.markRead(req.userContext,id);}
  @Get('notification-preferences') @RequirePermission('notification.read')
  preferences(@Req()req:any){return this.notificationsService.preferences(req.userContext);}
  @Post('notification-preferences') @RequirePermission('notification.read')
  preference(@Req()req:any,@Body()dto:unknown){return this.notificationsService.updatePreference(req.userContext,dto);}

  @Post('notification-preferences/unsubscribe-link') @RequirePermission('notification.read')
  unsubscribeLink(@Req()req:any,@Body('category')category:unknown){return this.notificationsService.unsubscribeLink(req.userContext,category);}
  @Post('notifications/:id/redrive') @RequirePermission('notification.manage')
  redrive(@Req()req:any,@Param('id')id:string,@Body('reason')reason:unknown){return this.notificationsService.redrive(req.userContext,id,reason);}

  @Post('notifications')
  @RequirePermission('notification.manage')
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
