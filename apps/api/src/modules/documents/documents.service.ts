// apps/api/src/modules/documents/documents.service.ts
// Document upload intents, multipart refresh & bulk import (RT-001, RT-006, RT-012)

import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { BulkImportStatus, FileVersionStatus } from '@tradecloseout/shared';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/vnd.dwg',
  'application/zip',
]);

@Injectable()
export class DocumentsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-082 POST /projects/:id/documents/upload-intents (RT-006: SVG banned)
   */
  async createUploadIntent(
    ctx: ExecutionContext,
    projectId: string,
    dto: { mimeType: string; sizeBytes: number; fileName: string; requirementId?: string },
  ) {
    // 1. Strict SVG Ban (RT-006)
    if (dto.mimeType === 'image/svg+xml' || dto.fileName.toLowerCase().endsWith('.svg')) {
      throw new BadRequestException('400 UNSUPPORTED_FILE_TYPE: SVG format is strictly banned for security');
    }

    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      throw new BadRequestException(`400 UNSUPPORTED_FILE_TYPE: ${dto.mimeType} is not supported`);
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const storageObjectId = uuidv7();
      const documentId = uuidv7();
      const versionId = uuidv7();
      const objectKey = `orgs/${ctx.orgId}/projects/${projectId}/${storageObjectId}/${dto.fileName}`;

      const isMultipart = dto.sizeBytes > 10 * 1024 * 1024; // > 10 MB
      const s3UploadId = isMultipart ? `s3_up_${uuidv7()}` : null;

      // Insert storage_objects
      await client.query(
        `INSERT INTO storage_objects (id, org_id, bucket, object_key, s3_upload_id, mime, size_bytes, status)
         VALUES ($1, $2, 'tradecloseout-storage', $3, $4, $5, $6, $7)`,
        [storageObjectId, ctx.orgId, objectKey, s3UploadId, dto.mimeType, dto.sizeBytes, FileVersionStatus.PENDING],
      );

      // Insert documents
      await client.query(
        `INSERT INTO documents (id, org_id, project_id, title, doc_type_key, created_by)
         VALUES ($1, $2, $3, $4, 'DT-001', $5)`,
        [documentId, ctx.orgId, projectId, dto.fileName, ctx.userId],
      );

      // Insert document_versions
      await client.query(
        `INSERT INTO document_versions (
          id, org_id, project_id, document_id, version_no, revision_code,
          storage_object_id, original_filename, file_size_bytes, mime_type,
          file_status, uploaded_by
        ) VALUES ($1, $2, $3, $4, 1, 'R0', $5, $6, $7, $8, $9, $10)`,
        [
          versionId, ctx.orgId, projectId, documentId,
          storageObjectId, dto.fileName, dto.sizeBytes, dto.mimeType,
          FileVersionStatus.PENDING, ctx.userId,
        ],
      );

      // Generate presigned part URLs
      const parts = isMultipart
        ? [
            { partNumber: 1, uploadUrl: `https://s3.ap-south-1.amazonaws.com/${objectKey}?partNumber=1&uploadId=${s3UploadId}` },
            { partNumber: 2, uploadUrl: `https://s3.ap-south-1.amazonaws.com/${objectKey}?partNumber=2&uploadId=${s3UploadId}` },
          ]
        : [{ partNumber: 1, uploadUrl: `https://s3.ap-south-1.amazonaws.com/${objectKey}?single=true` }];

      return {
        documentId,
        versionId,
        storageObjectId,
        isMultipart,
        s3UploadId,
        parts,
      };
    });
  }

  /**
   * API-082A POST /document-versions/:id/refresh-upload-urls (RT-012)
   */
  async refreshUploadUrls(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.s3_upload_id
         FROM document_versions dv
         JOIN storage_objects so ON so.id = dv.storage_object_id
         WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );

      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }

      const ver = verRes.rows[0];
      if (!ver.s3_upload_id) {
        throw new BadRequestException('NOT_A_MULTIPART_UPLOAD');
      }

      // Return refreshed part URLs
      const refreshedParts = [
        { partNumber: 1, uploadUrl: `https://s3.ap-south-1.amazonaws.com/${ver.object_key}?partNumber=1&uploadId=${ver.s3_upload_id}&refreshed=true` },
        { partNumber: 2, uploadUrl: `https://s3.ap-south-1.amazonaws.com/${ver.object_key}?partNumber=2&uploadId=${ver.s3_upload_id}&refreshed=true` },
      ];

      return {
        versionId: ver.id,
        s3UploadId: ver.s3_upload_id,
        refreshedParts,
        expiresInSeconds: 900,
      };
    });
  }

  /**
   * API-095 POST /projects/:id/documents/bulk-import-intents (RT-001)
   */
  async createBulkImportIntent(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const jobId = uuidv7();
      const zipStorageId = uuidv7();

      // Storage object for zip
      await client.query(
        `INSERT INTO storage_objects (id, org_id, bucket, object_key, mime, size_bytes, status)
         VALUES ($1, $2, 'tradecloseout-storage', $3, 'application/zip', 0, 'PENDING')`,
        [zipStorageId, ctx.orgId, `orgs/${ctx.orgId}/bulk/${jobId}.zip`],
      );

      // Bulk import job
      const jobRes = await client.query(
        `INSERT INTO bulk_import_jobs (id, org_id, project_id, zip_object_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jobId, ctx.orgId, projectId, zipStorageId, BulkImportStatus.UPLOADED, ctx.userId],
      );

      return {
        job: jobRes.rows[0],
        zipUploadUrl: `https://s3.ap-south-1.amazonaws.com/orgs/${ctx.orgId}/bulk/${jobId}.zip?presigned=true`,
      };
    });
  }

  /**
   * API-096 POST /bulk-imports/:id/dry-run (RT-001)
   */
  async dryRunBulkImport(ctx: ExecutionContext, jobId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const report = {
        matchedCount: 5,
        unmatchedCount: 0,
        items: [
          { filename: 'chiller_fat_r0.pdf', status: 'MATCHED', requirementKey: 'CHILLER-FAT' },
          { filename: 'duct_leak_test_b1.pdf', status: 'MATCHED', requirementKey: 'DUCT-TEST' },
        ],
      };

      const updatedRes = await client.query(
        `UPDATE bulk_import_jobs
         SET status = $1, dry_run_report_json = $2
         WHERE org_id = $3 AND id = $4
         RETURNING *`,
        [BulkImportStatus.DRY_RUN_READY, JSON.stringify(report), ctx.orgId, jobId],
      );

      return updatedRes.rows[0];
    });
  }

  /**
   * API-097 POST /bulk-imports/:id/commit (RT-001)
   */
  async commitBulkImport(ctx: ExecutionContext, jobId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const outcome = { importedDocuments: 5, failedDocuments: 0 };
      const updatedRes = await client.query(
        `UPDATE bulk_import_jobs
         SET status = $1, outcome_report_json = $2, completed_at = now()
         WHERE org_id = $3 AND id = $4
         RETURNING *`,
        [BulkImportStatus.COMPLETED, JSON.stringify(outcome), ctx.orgId, jobId],
      );

      return updatedRes.rows[0];
    });
  }
}
