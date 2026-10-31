// apps/api/src/modules/documents/documents.controller.ts
// Documents Controller (API-080..097)

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';

@Controller('api/v1')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('projects/:projectId/documents/upload-intents')
  @RequirePermission('document.upload')
  async createUploadIntent(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { mimeType: string; sizeBytes: number; fileName: string; requirementId?: string },
  ) {
    return this.documentsService.createUploadIntent(req.userContext, projectId, dto);
  }

  @Post('document-versions/:id/refresh-upload-urls')
  @RequirePermission('document.upload')
  async refreshUploadUrls(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.refreshUploadUrls(req.userContext, id);
  }

  @Post('projects/:projectId/documents/bulk-import-intents')
  @RequirePermission('document.bulk_import')
  async createBulkImportIntent(@Req() req: any, @Param('projectId') projectId: string) {
    return this.documentsService.createBulkImportIntent(req.userContext, projectId);
  }

  @Post('bulk-imports/:id/dry-run')
  @RequirePermission('document.bulk_import')
  async dryRunBulkImport(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.dryRunBulkImport(req.userContext, id);
  }

  @Post('bulk-imports/:id/commit')
  @RequirePermission('document.bulk_import')
  async commitBulkImport(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.commitBulkImport(req.userContext, id);
  }
}
