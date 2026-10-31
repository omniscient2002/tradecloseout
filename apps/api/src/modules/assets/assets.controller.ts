// apps/api/src/modules/assets/assets.controller.ts
// Assets Controller (API-070..076)

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1/projects/:projectId/assets')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  @RequirePermission('asset.read')
  async listAssets(@Req() req: any, @Param('projectId') projectId: string) {
    return this.assetsService.listAssets(req.userContext, projectId);
  }

  @Post()
  @RequirePermission('asset.manage')
  async createAsset(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { tag: string; name: string; categoryKey: string; make?: string; model?: string; serialNo?: string; location?: string },
  ) {
    return this.assetsService.createAsset(req.userContext, projectId, dto);
  }
}
