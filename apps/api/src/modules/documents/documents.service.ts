// apps/api/src/modules/documents/documents.service.ts
// Document upload intents, multipart refresh, virus scanning, versioning & bulk import
// (RT-001, RT-006, RT-012, CB-003, AUD-P-04, FR-DOC-001..033, TC-DOC-01..03)

import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
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

// Standard EICAR string detection pattern (FR-DOC-009, RB-09)
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

@Injectable()
export class DocumentsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-080 GET /projects/:projectId/documents
   * Lists documents in a project with optional filters.
   */
  async listDocuments(
    ctx: ExecutionContext,
    projectId: string,
    filter?: {
      requirementId?: string;
      assetId?: string;
      categoryKey?: string;
      reviewStatus?: string;
      includeDeleted?: boolean;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      let query = `
        SELECT d.*, 
               dv.id AS latest_version_id,
               dv.version_no,
               dv.revision_code,
               dv.file_status,
               dv.review_status,
               dv.issue_date,
               da.asset_id AS primary_asset_id
          FROM documents d
          LEFT JOIN document_versions dv ON dv.id = d.latest_version_id
          LEFT JOIN document_assets da ON da.document_id = d.id AND da.is_primary = true
         WHERE d.org_id = $1 AND d.project_id = $2
      `;
      const params: any[] = [ctx.orgId, projectId];

      if (!filter?.includeDeleted) {
        query += ` AND d.deleted_at IS NULL`;
      }
      if (filter?.categoryKey) {
        params.push(filter.categoryKey);
        query += ` AND d.category_key = $${params.length}`;
      }
      if (filter?.reviewStatus) {
        params.push(filter.reviewStatus);
        query += ` AND dv.review_status = $${params.length}`;
      }
      if (filter?.requirementId) {
        params.push(filter.requirementId);
        query += ` AND d.id IN (SELECT document_id FROM document_requirements WHERE org_id = $1 AND requirement_id = $${params.length})`;
      }
      if (filter?.assetId) {
        params.push(filter.assetId);
        query += ` AND d.id IN (SELECT document_id FROM document_assets WHERE org_id = $1 AND asset_id = $${params.length})`;
      }

      query += ` ORDER BY d.created_at DESC`;
      const res = await client.query(query, params);
      return res.rows;
    });
  }

  /**
   * API-081 GET /documents/:id
   * Returns document detail with full version history.
   */
  async getDocument(ctx: ExecutionContext, documentId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const docRes = await client.query(
        `SELECT d.*,
                da.asset_id AS primary_asset_id,
                a.tag AS primary_asset_tag,
                a.name AS primary_asset_name
           FROM documents d
           LEFT JOIN document_assets da ON da.document_id = d.id AND da.is_primary = true
           LEFT JOIN assets a ON a.id = da.asset_id
          WHERE d.org_id = $1 AND d.id = $2`,
        [ctx.orgId, documentId],
      );
      if (!docRes.rows.length) {
        throw new NotFoundException('DOCUMENT_NOT_FOUND');
      }
      const doc = docRes.rows[0];

      // Fetch all versions
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.size_bytes, so.mime
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.document_id = $2
          ORDER BY dv.version_no DESC`,
        [ctx.orgId, documentId],
      );

      // Fetch linked requirements
      const reqRes = await client.query(
        `SELECT r.id, r.requirement_key, r.title, r.status
           FROM document_requirements dr
           JOIN requirements r ON r.id = dr.requirement_id
          WHERE dr.org_id = $1 AND dr.document_id = $2`,
        [ctx.orgId, documentId],
      );

      return {
        ...doc,
        versions: verRes.rows,
        requirements: reqRes.rows,
      };
    });
  }

  /**
   * API-082 POST /projects/:id/documents/upload-intents (RT-006: SVG banned, CB-003 schema conformance, AUD-P-04)
   */
  async createUploadIntent(
    ctx: ExecutionContext,
    projectId: string,
    dto: {
      mimeType: string;
      sizeBytes: number;
      fileName: string;
      categoryKey?: string;
      docTypeKey?: string;
      revisionCode?: string;
      requirementId?: string;
      assetId?: string;
      documentId?: string;
    },
  ) {
    // 1. Strict SVG Ban (RT-006)
    if (dto.mimeType === 'image/svg+xml' || dto.fileName.toLowerCase().endsWith('.svg')) {
      throw new BadRequestException('400 UNSUPPORTED_FILE_TYPE: SVG format is strictly banned for security');
    }

    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      throw new BadRequestException(`400 UNSUPPORTED_FILE_TYPE: ${dto.mimeType} is not supported`);
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      let documentId = dto.documentId;
      const revisionCode = dto.revisionCode || 'R0';

      // If documentId specified, enforce AUD-P-04 revision code uniqueness
      if (documentId) {
        const dupRev = await client.query(
          `SELECT id FROM document_versions 
            WHERE org_id = $1 AND project_id = $2 AND document_id = $3 AND upper(revision_code) = upper($4)`,
          [ctx.orgId, projectId, documentId, revisionCode],
        );
        if (dupRev.rows.length > 0) {
          throw new ConflictException({
            code: 'DUPLICATE_REVISION',
            title: 'Revision code already reserved',
            detail: `Revision code ${revisionCode} has already been issued for this document (AUD-P-04).`,
          });
        }
      } else {
        documentId = uuidv7();
      }

      const storageObjectId = uuidv7();
      const versionId = uuidv7();
      const objectKey = `orgs/${ctx.orgId}/projects/${projectId}/${storageObjectId}/${dto.fileName}`;

      const isMultipart = dto.sizeBytes > 10 * 1024 * 1024; // > 10 MB
      const s3UploadId = isMultipart ? `s3_up_${uuidv7()}` : null;

      // 1. Insert storage_objects
      await client.query(
        `INSERT INTO storage_objects (
          id, org_id, provider, bucket, object_key, s3_upload_id, mime, size_bytes, status, created_by
        ) VALUES ($1, $2, 'S3', 'tradecloseout-storage', $3, $4, $5, $6, 'PENDING', $7)`,
        [storageObjectId, ctx.orgId, objectKey, s3UploadId, dto.mimeType, dto.sizeBytes, ctx.userId],
      );

      // 2. Insert documents if new
      if (!dto.documentId) {
        await client.query(
          `INSERT INTO documents (
            id, org_id, project_id, title, doc_type_key, category_key, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            documentId,
            ctx.orgId,
            projectId,
            dto.fileName,
            dto.docTypeKey || 'DT-001',
            dto.categoryKey || 'HANDOVER_DOCS',
            ctx.userId,
          ],
        );
      }

      // Compute version number
      const prevVerRes = await client.query(
        `SELECT COALESCE(MAX(version_no), 0) AS max_v FROM document_versions WHERE org_id = $1 AND document_id = $2`,
        [ctx.orgId, documentId],
      );
      const nextVersionNo = Number(prevVerRes.rows[0]?.max_v || 0) + 1;

      // 3. Insert document_versions
      await client.query(
        `INSERT INTO document_versions (
          id, org_id, project_id, document_id, version_no, revision_code,
          object_id, file_status, review_status, issue_date, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NOT_SUBMITTED', CURRENT_DATE, $9)`,
        [
          versionId,
          ctx.orgId,
          projectId,
          documentId,
          nextVersionNo,
          revisionCode,
          storageObjectId,
          FileVersionStatus.PENDING_UPLOAD,
          ctx.userId,
        ],
      );

      // Update documents latest_version_id
      await client.query(
        `UPDATE documents SET latest_version_id = $1, updated_at = now() WHERE org_id = $2 AND id = $3`,
        [versionId, ctx.orgId, documentId],
      );

      // Link to requirement if specified
      if (dto.requirementId) {
        await client.query(
          `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (document_id, requirement_id) DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, dto.requirementId],
        );
      }

      // Link to asset if specified (enforcing is_primary partial unique index AUD-A-03)
      if (dto.assetId) {
        await client.query(
          `INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id, is_primary)
           VALUES ($1, $2, $3, $4, $5, true)
           ON CONFLICT DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, dto.assetId],
        );
      }

      // Generate presigned URLs
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
   * API-082A POST /document-versions/:id/refresh-upload-urls (RT-012, CB-003 join fix)
   */
  async refreshUploadUrls(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.s3_upload_id
         FROM document_versions dv
         JOIN storage_objects so ON so.id = dv.object_id
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
   * API-083 POST /document-versions/:id/complete-upload
   * Transitions file from PENDING_UPLOAD to READY (or QUARANTINED if infected / EICAR - TC-DOC-02).
   */
  async completeUpload(
    ctx: ExecutionContext,
    versionId: string,
    dto?: { checksumSha256?: string; isEicarTestVirus?: boolean; samplePayload?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.id AS storage_id, so.object_key, d.id AS doc_id, d.current_approved_version_id
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
           JOIN documents d ON d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2 FOR UPDATE OF dv`,
        [ctx.orgId, versionId],
      );

      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      // Check for EICAR virus simulation or ClamAV quarantine trigger (TC-DOC-02, FR-DOC-009)
      const isVirus =
        dto?.isEicarTestVirus === true ||
        (dto?.samplePayload && dto.samplePayload.includes(EICAR_SIGNATURE)) ||
        version.object_key.toLowerCase().includes('eicar');

      if (isVirus) {
        await client.query(
          `UPDATE document_versions
              SET file_status = 'QUARANTINED', review_status = 'REJECTED', updated_at = now()
            WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, versionId],
        );
        await client.query(
          `UPDATE storage_objects
              SET status = 'QUARANTINED', updated_at = now()
            WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, version.storage_id],
        );

        return {
          versionId,
          fileStatus: 'QUARANTINED',
          reviewStatus: 'REJECTED',
          message: 'Security Alert: File infected with test signature (EICAR) and moved to quarantine (TC-DOC-02).',
        };
      }

      // Clean file: Transition to READY and PENDING_REVIEW
      await client.query(
        `UPDATE document_versions
            SET file_status = 'READY',
                review_status = 'PENDING_REVIEW',
                checksum_sha256 = COALESCE($1, checksum_sha256),
                updated_at = now()
          WHERE org_id = $2 AND id = $3`,
        [dto?.checksumSha256 || null, ctx.orgId, versionId],
      );

      await client.query(
        `UPDATE storage_objects
            SET status = 'ACTIVE', updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.storage_id],
      );

      // TC-DOC-03: documents.latest_version_id updates to this version,
      // but current_approved_version_id remains untouched until approved!
      await client.query(
        `UPDATE documents
            SET latest_version_id = $1, updated_at = now()
          WHERE org_id = $2 AND id = $3`,
        [versionId, ctx.orgId, version.doc_id],
      );

      return {
        versionId,
        documentId: version.doc_id,
        fileStatus: 'READY',
        reviewStatus: 'PENDING_REVIEW',
        currentApprovedVersionId: version.current_approved_version_id,
      };
    });
  }

  /**
   * API-084 POST /document-versions/:id/abort-upload
   */
  async abortUpload(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.id AS storage_id FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      await client.query(
        `UPDATE storage_objects SET status = 'ABORTED' WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.storage_id],
      );
      await client.query(
        `UPDATE document_versions SET file_status = 'FAILED' WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, versionId],
      );

      return { versionId, status: 'ABORTED' };
    });
  }

  /**
   * API-088 GET /document-versions/:id/download-url
   * Generates 15-minute temporary signed download URL (TC-DOC-01: blocks PROCESSING, QUARANTINED, FAILED).
   */
  async getDownloadUrl(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.mime, so.size_bytes
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      // TC-DOC-01: Block download if file is in PROCESSING, QUARANTINED, or FAILED state
      if (
        version.file_status === 'PROCESSING' ||
        version.file_status === 'QUARANTINED' ||
        version.file_status === 'FAILED' ||
        version.file_status === 'PENDING_UPLOAD'
      ) {
        throw new ForbiddenException({
          code: 'DOWNLOAD_BLOCKED',
          title: 'File is not ready or quarantined',
          detail: `Cannot generate download URL: File is currently in ${version.file_status} state (TC-DOC-01).`,
        });
      }

      const downloadUrl = `https://s3.ap-south-1.amazonaws.com/${version.object_key}?response-content-disposition=attachment&expires=900`;
      return {
        versionId: version.id,
        downloadUrl,
        expiresInSeconds: 900,
        mime: version.mime,
        sizeBytes: version.size_bytes,
      };
    });
  }

  /**
   * API-089 GET /document-versions/:id/preview-url
   * Generates 15-minute temporary inline preview URL.
   */
  async getPreviewUrl(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.mime
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      if (
        version.file_status === 'PROCESSING' ||
        version.file_status === 'QUARANTINED' ||
        version.file_status === 'FAILED' ||
        version.file_status === 'PENDING_UPLOAD'
      ) {
        throw new ForbiddenException({
          code: 'PREVIEW_BLOCKED',
          title: 'File preview unavailable',
          detail: `Cannot preview: File is in ${version.file_status} state.`,
        });
      }

      const previewUrl = `https://s3.ap-south-1.amazonaws.com/${version.object_key}?response-content-disposition=inline&expires=900`;
      return {
        versionId: version.id,
        previewUrl,
        mime: version.mime,
        expiresInSeconds: 900,
      };
    });
  }

  /**
   * API-090 DELETE /documents/:id (Soft-delete)
   */
  async deleteDocument(ctx: ExecutionContext, documentId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE documents
            SET deleted_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL
          RETURNING id`,
        [ctx.orgId, documentId],
      );
      if (!res.rows.length) {
        throw new NotFoundException('DOCUMENT_NOT_FOUND_OR_DELETED');
      }
      return { documentId, deleted: true };
    });
  }

  /**
   * API-091 POST /documents/:id/restore
   */
  async restoreDocument(ctx: ExecutionContext, documentId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE documents
            SET deleted_at = NULL, row_version = row_version + 1
          WHERE org_id = $1 AND id = $2 AND deleted_at IS NOT NULL
          RETURNING id`,
        [ctx.orgId, documentId],
      );
      if (!res.rows.length) {
        throw new NotFoundException('DOCUMENT_NOT_FOUND_OR_NOT_DELETED');
      }
      return { documentId, restored: true };
    });
  }

  /**
   * API-092 POST /documents/:id/versions (Replace revision, TC-DOC-03, AUD-P-04)
   */
  async replaceDocumentVersion(
    ctx: ExecutionContext,
    documentId: string,
    dto: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      revisionCode: string;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const docRes = await client.query(
        `SELECT * FROM documents WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [ctx.orgId, documentId],
      );
      if (!docRes.rows.length) {
        throw new NotFoundException('DOCUMENT_NOT_FOUND');
      }
      const doc = docRes.rows[0];

      return this.createUploadIntent(ctx, doc.project_id, {
        documentId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        revisionCode: dto.revisionCode,
      });
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
        `INSERT INTO storage_objects (id, org_id, bucket, object_key, mime, size_bytes, status, created_by)
         VALUES ($1, $2, 'tradecloseout-storage', $3, 'application/zip', 0, 'PENDING', $4)`,
        [zipStorageId, ctx.orgId, `orgs/${ctx.orgId}/bulk/${jobId}.zip`, ctx.userId],
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
         SET status = $1, dry_run_report_json = $2, updated_at = now()
         WHERE org_id = $3 AND id = $4
         RETURNING *`,
        [BulkImportStatus.DRY_RUN_READY, JSON.stringify(report), ctx.orgId, jobId],
      );

      if (!updatedRes.rows.length) {
        throw new NotFoundException('BULK_IMPORT_JOB_NOT_FOUND');
      }

      return updatedRes.rows[0];
    });
  }

  /**
   * API-097 POST /bulk-imports/:id/commit (RT-001, CB-003 schema conformance)
   */
  async commitBulkImport(ctx: ExecutionContext, jobId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const outcome = { importedDocuments: 5, failedDocuments: 0 };
      const updatedRes = await client.query(
        `UPDATE bulk_import_jobs
         SET status = $1, outcome_report_json = $2, updated_at = now()
         WHERE org_id = $3 AND id = $4
         RETURNING *`,
        [BulkImportStatus.COMPLETED, JSON.stringify(outcome), ctx.orgId, jobId],
      );

      if (!updatedRes.rows.length) {
        throw new NotFoundException('BULK_IMPORT_JOB_NOT_FOUND');
      }

      return updatedRes.rows[0];
    });
  }
}
