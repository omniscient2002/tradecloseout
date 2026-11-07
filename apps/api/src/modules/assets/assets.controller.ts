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

  @Post('match-candidates')
  @RequirePermission('asset.read')
  async matchAssetCandidates(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { filename?: string; text?: string; tagCandidate?: string },
  ) {
    return this.assetsService.matchAssetCandidates(req.userContext, projectId, dto);
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
    @Body('conflictStrategy') conflictStrategy?: 'SKIP' | 'FAIL' | 'UPDATE',
    @Body('atomic') atomic?: boolean,
  ) {
    return this.assetsService.importAssets(req.userContext, projectId, items || [], dryRun === 'true', {
      conflictStrategy,
      atomic,
    });
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

  @Get(':id/passport')
  @RequirePermission('asset.read')
  async getEquipmentPassport(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
  ) {
    return this.assetsService.getEquipmentPassport(req.userContext, projectId, assetId);
  }

  @Get(':id/history')
  @RequirePermission('asset.read')
  async getAssetIdentityHistory(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
  ) {
    return this.assetsService.getAssetIdentityHistory(req.userContext, projectId, assetId);
  }

  @Patch(':id/revalidations/:revalidationId')
  @RequirePermission('asset.manage')
  async revalidateEvidence(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') assetId: string,
    @Param('revalidationId') revalidationId: string,
    @Body() dto: { status: 'CONFIRMED' | 'MISMATCH' | 'EXEMPT'; notes?: string; expectedRowVersion?: number },
  ) {
    return this.assetsService.revalidateEvidence(req.userContext, projectId, assetId, revalidationId, dto);
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
