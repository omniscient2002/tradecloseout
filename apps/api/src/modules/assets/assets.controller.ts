// apps/api/src/modules/assets/assets.controller.ts
// Assets Controller (API-070..076)

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1/projects/:projectId/assets')
@UseGuards(SessionCsrfGuard, PermissionGuard)
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

  @Get('export')
  @RequirePermission('asset.read')
  async exportAssets(@Req() req: any, @Param('projectId') projectId: string) {
    return this.assetsService.exportAssets(req.userContext, projectId);
  }

  @Post('import')
  @RequirePermission('asset.manage')
  async importAssets(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body('items') items: any[],
    @Query('dryRun') dryRun?: string,
  ) {
    return this.assetsService.importAssets(req.userContext, projectId, items || [], dryRun === 'true');
  }

  @Get(':id')
  @RequirePermission('asset.read')
  async getAsset(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
  ) {
    return this.assetsService.getAsset(req.userContext, projectId, assetId);
  }

  @Patch(':id')
  @RequirePermission('asset.manage')
  async updateAsset(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
    @Body() dto: any,
  ) {
    return this.assetsService.updateAsset(req.userContext, projectId, assetId, dto);
  }

  @Delete(':id')
  @RequirePermission('asset.manage')
  async deleteAsset(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
    @Query('hard') hard?: string,
  ) {
    return this.assetsService.deleteAsset(req.userContext, projectId, assetId, hard === 'true');
  }
}
