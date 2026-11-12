// apps/api/src/modules/documents/documents.controller.ts
// Documents Controller (API-080..097, TC-DOC-01..03)

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { PermissionGuard, RequirePermission } from '../../common/guards/permission.guard';
import { RequireIdempotency } from '../../common/decorators/idempotency.decorator';
import { CreateUploadIntentDto, CompleteUploadDto } from './dto/upload-intent.dto';

@Controller('api/v1')
@UseGuards(SessionCsrfGuard, PermissionGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('projects/:projectId/documents')
  @RequirePermission('document.read')
  async listDocuments(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('requirementId') requirementId?: string,
    @Query('assetId') assetId?: string,
    @Query('categoryKey') categoryKey?: string,
    @Query('reviewStatus') reviewStatus?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.documentsService.listDocuments(req.userContext, projectId, {
      requirementId,
      assetId,
      categoryKey,
      reviewStatus,
      includeDeleted: includeDeleted === 'true',
    });
  }

  @Get('documents/:id')
  @RequirePermission('document.read')
  async getDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.getDocument(req.userContext, id);
  }

  @Post(['projects/:projectId/documents/upload-intents', 'projects/:projectId/upload-intents'])
  @RequirePermission('document.upload')
  @RequireIdempotency()
  async createUploadIntent(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateUploadIntentDto,
  ) {
    return this.documentsService.createUploadIntent(req.userContext, projectId, dto);
  }

  @Post('document-versions/:id/refresh-upload-urls')
  @RequirePermission('document.upload')
  async refreshUploadUrls(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.refreshUploadUrls(req.userContext, id);
  }

  @Post([
    'document-versions/:id/complete',
    'document-versions/:id/complete-upload',
    'projects/:projectId/document-versions/:id/complete-upload',
  ])
  @RequirePermission('document.upload')
  @RequireIdempotency()
  async completeUpload(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    // Both route aliases must bind the upload to its actual project.
    return req.params?.projectId
      ? this.documentsService.completeUpload(req.userContext, req.params.projectId, id, dto)
      : this.documentsService.completeUpload(req.userContext, id, dto);
  }

  @Post('document-versions/:id/abort-upload')
  @RequirePermission('document.upload')
  async abortUpload(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.abortUpload(req.userContext, id);
  }

  @Get('document-versions/:id/download-url')
  @RequirePermission('document.download')
  async getDownloadUrl(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.getDownloadUrl(req.userContext, id);
  }

  @Get('document-versions/:id/preview-url')
  @RequirePermission('document.download')
  async getPreviewUrl(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.getPreviewUrl(req.userContext, id);
  }

  @Get('projects/:projectId/document-versions/:versionId/stream')
  @RequirePermission('document.download')
  async streamProjectPdf(
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    return this.documentsService.streamDocumentVersion(req.userContext, projectId, versionId, req, res);
  }

  @Get('document-versions/:versionId/stream')
  @RequirePermission('document.download')
  async streamDirectPdf(
    @Param('versionId') versionId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    return this.documentsService.streamDocumentVersion(req.userContext, undefined, versionId, req, res);
  }

  @Delete('documents/:id')
  @RequirePermission('document.delete')
  async deleteDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.deleteDocument(req.userContext, id);
  }

  @Post('documents/:id/restore')
  @RequirePermission('document.delete')
  async restoreDocument(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.restoreDocument(req.userContext, id);
  }

  @Post('documents/:id/versions')
  @RequirePermission('document.upload')
  async replaceDocumentVersion(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    dto: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      revisionCode: string;
    },
  ) {
    return this.documentsService.replaceDocumentVersion(req.userContext, id, dto);
  }

  @Post(['projects/:projectId/documents/bulk-import', 'projects/:projectId/documents/bulk-import-intents'])
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

  @Post('projects/:projectId/documents/:documentId/batch-links')
  @RequirePermission('document.upload')
  async linkBatchEvidence(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: { assetIds: string[]; requirementIds: string[] },
  ) {
    return this.documentsService.linkBatchEvidence(
      req.userContext,
      projectId,
      documentId,
      dto.assetIds || [],
      dto.requirementIds || [],
    );
  }

  @Post('projects/:projectId/transmittals/generate')
  @RequirePermission('document.upload')
  @RequireIdempotency()
  async generateTransmittalPack(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: { documentIds: string[]; notes?: string },
  ) {
    return this.documentsService.generateSubmittalTransmittalPack(
      req.userContext,
      projectId,
      dto.documentIds,
      dto.notes,
    );
  }

  @Post('projects/:projectId/transmittals/stamp-back')
  @RequirePermission('review.record_external')
  async processTransmittalStampBack(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body()
    dto: {
      transmittalNo: string;
      approverName: string;
      approverRoleOrg: string;
      decisionDate: string;
      evidenceObjectId?: string;
      versionIds: string[];
    },
  ) {
    return this.documentsService.processTransmittalStampBack(req.userContext, projectId, dto);
  }
}
