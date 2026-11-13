// apps/api/src/modules/notifications/notifications.module.ts

import { Module } from '@nestjs/common';
import {NotificationPublicController} from './notification-public.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [],
  controllers: [NotificationsController,NotificationPublicController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
