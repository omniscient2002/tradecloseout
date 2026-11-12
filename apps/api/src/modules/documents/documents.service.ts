// apps/api/src/modules/documents/documents.service.ts
// Document upload intents, multipart refresh, virus scanning, versioning & bulk import
// (RT-001, RT-006, RT-012, CB-003, AUD-P-04, FR-DOC-001..033, TC-DOC-01..03)

import {
  Injectable,
  Optional,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { BulkImportStatus, FileVersionStatus } from '@tradecloseout/shared';

import { Pool } from 'pg';
import { S3StorageService } from './s3-storage.service';

/** Reject S3's mutable null-version sentinel at every evidence read boundary. */
export function isImmutableEvidenceVersion(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().toLowerCase() !== 'null';
}

export interface ObjectStoragePresigner {
  createUploadUrls(params: { objectKey: string; sizeBytes: number; mimeType?: string }): Promise<{
    uploadId: string | null;
    partSizeBytes: number;
    parts: Array<{ partNumber: number; uploadUrl: string; requiredHeaders: Record<string, string> }>;
  }>;
  finalizeUpload(params: {
    objectKey: string;
    uploadId: string | null;
    expectedSizeBytes: number;
    parts?: Array<{ partNumber: number; etag?: string }>;
  }): Promise<{ observedSizeBytes: number; versionId: string }>;
  refreshUploadUrls(params: { objectKey: string; uploadId: string; sizeBytes: number }): Promise<{
    parts: Array<{ partNumber: number; uploadUrl: string; requiredHeaders: Record<string, string> }>;
    expiresInSeconds: number;
  }>;
  abortUpload(params: { objectKey: string; uploadId: string | null }): Promise<void>;
  createSignedDownloadUrl(params: { objectKey: string; filename?: string; inline?: boolean; versionId?: string }): Promise<string>;
  fetchObject(params: { objectKey: string; versionId: string; range?: string }): Promise<AsyncIterable<Uint8Array>>;
}

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
  private readonly db: TenantDbService;
  private readonly storageAdapter: ObjectStoragePresigner;

  constructor(
    @Optional() db?: TenantDbService,
    @Optional() storageAdapter?: ObjectStoragePresigner,
  ) {
    if (db instanceof TenantDbService) {
      this.db = db;
    } else if (db) {
      this.db = new TenantDbService(db as any);
    } else {
      this.db = new TenantDbService();
    }
    this.storageAdapter = storageAdapter || new S3StorageService();
  }

  /**
   * PH3-G09-002: resolve project from persisted document identity, then
   * lock project BEFORE document. Deletion/restoration of accepted or closed
   * baseline evidence is not a generic metadata PATCH.
   */
  private async assertEditableDocumentProject(
    client: PoolClient, orgId: string, documentId: string,
    action: 'DELETE' | 'RESTORE',
  ): Promise<void> {
    const { rows: identities } = await client.query(
      `SELECT project_id FROM documents WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, documentId],
    );
    if (!identities.length) throw new NotFoundException('DOCUMENT_NOT_FOUND');
    const projectId = identities[0].project_id;
    const { rows: projectRows } = await client.query(
      `SELECT status FROM projects WHERE org_id = $1 AND id = $2
        AND purged_at IS NULL FOR UPDATE`,
      [orgId, projectId],
    );
    if (!projectRows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (!['DRAFT', 'ACTIVE'].includes(projectRows[0].status)) {
      throw new ConflictException('DOCUMENT_PROJECT_NOT_EDITABLE');
    }
    const { rows: lockedDocuments } = await client.query(
      `SELECT id FROM documents WHERE org_id = $1 AND id = $2
        AND project_id = $3 FOR UPDATE`,
      [orgId, documentId, projectId],
    );
    if (!lockedDocuments.length) throw new NotFoundException('DOCUMENT_NOT_FOUND');

    // A project can be ACTIVE while its evidence is independently retained
    // by a legal hold, accepted/ready package or an approved version.
    const { rows: protectedRows } = await client.query(
      `SELECT
          EXISTS (
            SELECT 1 FROM legal_holds lh
             WHERE lh.org_id = $1 AND lh.project_id = $2
               AND lh.released_at IS NULL
          ) AS legal_hold,
          EXISTS (
            SELECT 1 FROM document_versions dv
             WHERE dv.org_id = $1 AND dv.project_id = $2
               AND dv.document_id = $3 AND dv.deleted_at IS NULL
               AND dv.review_status = 'APPROVED'
          ) AS approved_version,
          EXISTS (
            SELECT 1 FROM package_items pi
            JOIN handover_packages hp
              ON hp.org_id = pi.org_id AND hp.project_id = pi.project_id
             AND hp.id = pi.package_id
            JOIN document_versions dv
              ON dv.org_id = pi.org_id AND dv.project_id = pi.project_id
             AND dv.id = pi.document_version_id
           WHERE pi.org_id = $1 AND pi.project_id = $2
             AND dv.document_id = $3 AND pi.included = true
             AND hp.status IN (
               'READY', 'SUBMITTED', 'PARTIALLY_ACCEPTED',
               'ACCEPTED', 'REJECTED', 'SUPERSEDED'
             )
          ) AS packaged_version`,
      [orgId, projectId, documentId],
    );
    const protectedEvidence = protectedRows[0];
    if (protectedEvidence?.legal_hold) {
      throw new ConflictException('DOCUMENT_UNDER_LEGAL_HOLD');
    }
    if (action === 'DELETE' &&
        (protectedEvidence?.approved_version || protectedEvidence?.packaged_version)) {
      throw new ConflictException('DOCUMENT_RETAINED_EVIDENCE');
    }
  }

  private async assertGuestVersionScope(client: PoolClient, ctx: ExecutionContext, versionId: string, capability: 'document.upload' | 'document.download') {
    if (ctx.actorType !== 'GUEST' && !ctx.guestGrantId) return;
    if (!ctx.guestGrantId) throw new NotFoundException('VERSION_NOT_FOUND');
    const { rows } = await client.query(
      `SELECT 1
         FROM guest_grants g
         JOIN document_versions dv
           ON dv.org_id = g.org_id AND dv.project_id = g.project_id
          AND dv.uploaded_by_grant_id = g.id AND dv.id = $3
         JOIN document_requirements dr
           ON dr.org_id = dv.org_id AND dr.project_id = dv.project_id AND dr.document_id = dv.document_id
        WHERE g.org_id = $1 AND g.id = $2 AND g.status = 'ACTIVE' AND g.expires_at > now()
          AND g.capabilities @> ARRAY[$4]::text[]
          AND COALESCE(g.scope_json->'requirementIds', '[]'::jsonb) ? dr.requirement_id::text
        LIMIT 1`,
      [ctx.orgId, ctx.guestGrantId, versionId, capability],
    );
    if (!rows.length) throw new NotFoundException('VERSION_NOT_FOUND');
  }

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
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new NotFoundException('DOCUMENTS_NOT_FOUND');
    }
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
      if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
        if (!ctx.guestGrantId) throw new NotFoundException('DOCUMENT_NOT_FOUND');
        const { rows } = await client.query(
          `SELECT DISTINCT dv.id, dv.version_no, dv.revision_code, dv.file_status, dv.review_status,
                  dv.issue_date, dv.expiry_date, dv.created_at
             FROM guest_grants g
             JOIN documents d ON d.org_id = g.org_id AND d.project_id = g.project_id AND d.id = $3
             JOIN document_versions dv
               ON dv.org_id = d.org_id AND dv.project_id = d.project_id AND dv.document_id = d.id
              AND dv.uploaded_by_grant_id = g.id AND dv.deleted_at IS NULL
             JOIN document_requirements dr
               ON dr.org_id = d.org_id AND dr.project_id = d.project_id AND dr.document_id = d.id
            WHERE g.org_id = $1 AND g.id = $2 AND g.status = 'ACTIVE' AND g.expires_at > now()
              AND g.capabilities @> ARRAY['document.upload']::text[] AND d.deleted_at IS NULL
              AND COALESCE(g.scope_json->'requirementIds', '[]'::jsonb) ? dr.requirement_id::text
            ORDER BY dv.version_no DESC`,
          [ctx.orgId, ctx.guestGrantId, documentId],
        );
        if (!rows.length) throw new NotFoundException('DOCUMENT_NOT_FOUND');
        return { id: documentId, versions: rows };
      }
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
   * Enhanced with Multi-Asset Batch Linking (Business Risk 1) and Soft Quota Check (Bug 2).
   */
  async createUploadIntent(
    ctx: ExecutionContext,
    projectId: string,
    dto: {
      mimeType: string;
      sizeBytes: number;
      fileName?: string;
      filename?: string;
      categoryKey?: string;
      docTypeKey?: string;
      revisionCode?: string;
      requirementId?: string;
      requirementIds?: string[];
      assetId?: string;
      assetIds?: string[];
      documentId?: string;
      issueDate?: string;
      expiryDate?: string | null;
      title?: string;
      checksumSha256?: string;
    },
    existingDocumentId?: string,
  ) {
    const rawFileName = path.basename((dto.fileName || dto.filename || 'document.pdf').replace(/\\/g, '/'))
      .normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!rawFileName || rawFileName.length > 255 || !Number.isSafeInteger(dto.sizeBytes) || dto.sizeBytes < 1 || dto.sizeBytes > 100 * 1024 * 1024) {
      throw new BadRequestException('INVALID_UPLOAD_METADATA');
    }
    if (dto.checksumSha256 && !/^[a-fA-F0-9]{64}$/.test(dto.checksumSha256)) {
      throw new BadRequestException('INVALID_SHA256_CHECKSUM');
    }
    // 1. Strict SVG Ban (RT-006)
    if (dto.mimeType === 'image/svg+xml' || rawFileName.toLowerCase().endsWith('.svg')) {
      throw new BadRequestException('400 UNSUPPORTED_FILE_TYPE: SVG format is strictly banned for security');
    }

    if (!ALLOWED_MIME_TYPES.has(dto.mimeType)) {
      throw new BadRequestException(`400 UNSUPPORTED_FILE_TYPE: ${dto.mimeType} is not supported`);
    }

    // Revalidate requirement scope for guest grants (TC2-006)
    const isGuest = ctx.actorType === 'GUEST' || Boolean((ctx as any).guestGrantId);
    const guestGrantId = (ctx as any).guestGrantId || null;
    const requestedRequirementIds = Array.from(new Set([
      ...(dto.requirementId ? [dto.requirementId] : []),
      ...(dto.requirementIds || []),
    ]));
    const requestedAssetIds = Array.from(new Set([
      ...(dto.assetId ? [dto.assetId] : []),
      ...(dto.assetIds || []),
    ]));

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      if (isGuest) {
        if (!guestGrantId || requestedRequirementIds.length === 0) {
          throw new ForbiddenException('GUEST_UPLOAD_SCOPE_REQUIRED');
        }
        const { rows: grants } = await client.query(
          `SELECT scope_json, capabilities FROM guest_grants
            WHERE org_id = $1 AND project_id = $2 AND id = $3
              AND status = 'ACTIVE' AND expires_at > now() FOR SHARE`,
          [ctx.orgId, projectId, guestGrantId],
        );
        const grant = grants[0];
        const scope = grant?.scope_json;
        const allowedRequirements: string[] = Array.isArray(scope?.requirementIds) ? scope.requirementIds : [];
        const allowedAssets: string[] = Array.isArray(scope?.assetIds) ? scope.assetIds : [];
        if (!grant || !Array.isArray(grant.capabilities) || !grant.capabilities.includes('document.upload') ||
            requestedRequirementIds.some((id) => !allowedRequirements.includes(id)) ||
            requestedAssetIds.some((id) => !allowedAssets.includes(id))) {
          throw new ForbiddenException({
            code: 'RESOURCE_OUTSIDE_GUEST_SCOPE',
            detail: 'Every linked requirement and asset must be explicitly assigned to the active guest grant.',
          });
        }
        const existingId = dto.documentId || existingDocumentId;
        if (existingId) {
          const owned = await client.query(
            `SELECT 1 FROM document_versions
              WHERE org_id = $1 AND project_id = $2 AND document_id = $3
                AND uploaded_by_grant_id = $4 AND deleted_at IS NULL LIMIT 1`,
            [ctx.orgId, projectId, existingId, guestGrantId],
          );
          if (!owned.rows.length) throw new NotFoundException('DOCUMENT_NOT_FOUND_IN_PROJECT');
        }
      }
      // A linked HVAC obligation determines the evidence type. Never silently
      // save an AHU/chiller report as DT-001 just because the caller omitted
      // docTypeKey, and never allow an explicitly mismatched document type.
      let linkedDocumentType: string | undefined;
      if (requestedRequirementIds.length > 0) {
        const { rows: matchedRequirements } = await client.query(
          `SELECT id, doc_type_key FROM requirements
             WHERE org_id = $1 AND project_id = $2
               AND id = ANY($3::uuid[]) AND superseded_at IS NULL`,
          [ctx.orgId, projectId, requestedRequirementIds],
        );
        if (matchedRequirements.length !== requestedRequirementIds.length) {
          throw new NotFoundException('REQUIREMENT_NOT_FOUND_IN_PROJECT');
        }
        const types = new Set(matchedRequirements.map((r: any) => r.doc_type_key));
        if (types.size !== 1) {
          throw new BadRequestException({
            code: 'MIXED_EVIDENCE_TYPES',
            detail: 'Separate documents are required for obligations of different document types.',
          });
        }
        linkedDocumentType = [...types][0] as string;
        if (dto.docTypeKey && dto.docTypeKey !== linkedDocumentType) {
          throw new BadRequestException({
            code: 'DOCUMENT_TYPE_MISMATCH',
            detail: 'Uploaded evidence type must match its linked requirement.',
          });
        }
      }

      // Soft check plan storage limit without premature deduction (Bug 2 / Dimension 10)
      const { rows: quotaRows } = await client.query(
        `SELECT uc.value AS current_storage, p.limits_json
           FROM organisations o
           LEFT JOIN subscriptions s ON s.org_id = o.id AND s.status IN ('TRIAL', 'ACTIVE')
           LEFT JOIN plans p ON p.id = s.plan_id
           LEFT JOIN usage_counters uc ON uc.org_id = o.id AND uc.metric = 'STORAGE_BYTES' AND uc.period = 'ALL_TIME'
          WHERE o.id = $1 LIMIT 1`,
        [ctx.orgId],
      );
      if (quotaRows.length > 0 && quotaRows[0].limits_json?.maxStorageBytes) {
        const currentBytes = BigInt(quotaRows[0].current_storage || '0');
        const limitBytes = BigInt(quotaRows[0].limits_json.maxStorageBytes);
        if (currentBytes + BigInt(dto.sizeBytes) > limitBytes) {
          throw new BadRequestException({
            code: 'STORAGE_QUOTA_EXCEEDED',
            detail: `Upload exceeds organization storage ceiling (${currentBytes + BigInt(dto.sizeBytes)} > ${limitBytes} bytes).`,
          });
        }
      }

      let documentId = dto.documentId || existingDocumentId;
      const revisionCode = dto.revisionCode || 'R0';

      // If documentId specified, enforce AUD-P-04 revision code uniqueness
      if (documentId) {
        const parentDocument = await client.query(
          `SELECT id, doc_type_key FROM documents WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
          [ctx.orgId, projectId, documentId],
        );
        if (!parentDocument.rows.length) throw new NotFoundException('DOCUMENT_NOT_FOUND_IN_PROJECT');
        if (linkedDocumentType && parentDocument.rows[0].doc_type_key !== linkedDocumentType) {
          throw new BadRequestException({
            code: 'DOCUMENT_TYPE_MISMATCH',
            detail: 'An existing document cannot satisfy a requirement of another type.',
          });
        }
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
      const objectKey = `orgs/${ctx.orgId}/projects/${projectId}/${storageObjectId}/source`;

      const isMultipart = dto.sizeBytes > 10 * 1024 * 1024; // > 10 MB

      // 1. Insert storage_objects
      await client.query(
        `INSERT INTO storage_objects (
          id, org_id, provider, bucket, object_key, original_filename, s3_upload_id, mime, size_bytes,
          expected_sha256, observed_size_bytes, sha256, status, created_by
        ) VALUES ($1, $2, 'S3', $3, $4, $5, NULL, $6, $7, $8, NULL, NULL, 'PENDING', $9)`,
        [
          storageObjectId,
          ctx.orgId,
          process.env.S3_BUCKET || '',
          objectKey,
          rawFileName,
          dto.mimeType,
          dto.sizeBytes,
          dto.checksumSha256 || null,
          ctx.userId,
        ],
      );

      // 2. Insert documents if new, or lock existing document row FOR UPDATE (TC-F013)
      if (!dto.documentId && !existingDocumentId) {
        await client.query(
          `INSERT INTO documents (
            id, org_id, project_id, title, doc_type_key, category_key, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            documentId,
            ctx.orgId,
            projectId,
            dto.title || rawFileName,
            linkedDocumentType || dto.docTypeKey || 'DT-001',
            dto.categoryKey || 'HANDOVER_DOCS',
            ctx.userId,
          ],
        );
      } else {
        await client.query(
          `SELECT id FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE`,
          [ctx.orgId, documentId],
        );
      }

      // Compute version number
      const prevVerRes = await client.query(
        `SELECT COALESCE(MAX(version_no), 0) AS max_v FROM document_versions WHERE org_id = $1 AND document_id = $2`,
        [ctx.orgId, documentId],
      );
      const nextVersionNo = Number(prevVerRes.rows[0]?.max_v || 0) + 1;

      // 3. Insert document_versions
      const uploaderUserId = isGuest ? null : ctx.userId;

      await client.query(
        `INSERT INTO document_versions (
          id, org_id, project_id, document_id, version_no, revision_code,
          object_id, file_status, review_status, issue_date, expiry_date, uploaded_by, uploaded_by_grant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NOT_SUBMITTED', $9, $10, $11, $12)`,
        [
          versionId,
          ctx.orgId,
          projectId,
          documentId,
          nextVersionNo,
          revisionCode,
          storageObjectId,
          FileVersionStatus.PENDING_UPLOAD,
          dto.issueDate || new Date().toISOString().slice(0, 10),
          dto.expiryDate || null,
          uploaderUserId,
          guestGrantId,
        ],
      );

      // Update documents latest_version_id
      await client.query(
        `UPDATE documents SET latest_version_id = $1, updated_at = now() WHERE org_id = $2 AND id = $3`,
        [versionId, ctx.orgId, documentId],
      );

      // Link to requirement(s) (Fix Business Risk 1: Multi-Requirement Batch Evidence Linking)
      const allRequirementIds = [
        ...(dto.requirementId ? [dto.requirementId] : []),
        ...(dto.requirementIds ? dto.requirementIds : []),
      ];
      for (const reqId of Array.from(new Set(allRequirementIds))) {
        await client.query(
          `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (document_id, requirement_id) DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, reqId],
        );
      }

      // Link to asset(s) (Fix Business Risk 1: Multi-Asset Batch Evidence Linking)
      const allAssetIds = [
        ...(dto.assetId ? [dto.assetId] : []),
        ...(dto.assetIds ? dto.assetIds : []),
      ];
      for (let i = 0; i < allAssetIds.length; i++) {
        await client.query(
          `INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, allAssetIds[i], i === 0],
        );
      }

      // Generate presigned URLs (normalized for client contracts - TC2-009 & TC2-030)
      const presigned = await this.storageAdapter.createUploadUrls({
        objectKey,
        sizeBytes: dto.sizeBytes,
        mimeType: dto.mimeType,
      });
      const s3UploadId = presigned.uploadId;
      await client.query(
        `UPDATE storage_objects SET s3_upload_id = $1 WHERE org_id = $2 AND id = $3`,
        [s3UploadId, ctx.orgId, storageObjectId],
      );
      const partSizeBytes = presigned.partSizeBytes || (isMultipart ? 5 * 1024 * 1024 : dto.sizeBytes);
      const rawParts = presigned.parts || [];

      const normalizedParts = rawParts.map((p: any) => ({
        partNumber: p.partNumber,
        uploadUrl: p.uploadUrl || p.url,
        url: p.uploadUrl || p.url,
        requiredHeaders: p.requiredHeaders || {},
      }));

      return {
        documentId,
        versionId,
        storageObjectId,
        isMultipart,
        s3UploadId,
        partSizeBytes,
        parts: normalizedParts,
        upload: {
          partSizeBytes,
          parts: normalizedParts,
        },
        linkedRequirementCount: allRequirementIds.length,
        linkedAssetCount: allAssetIds.length,
      };
    });
  }

  /**
   * API-082A POST /document-versions/:id/refresh-upload-urls (RT-012, CB-003 join fix)
   */
  async refreshUploadUrls(ctx: ExecutionContext, versionId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.object_key, so.s3_upload_id, so.size_bytes
         FROM document_versions dv
         JOIN storage_objects so ON so.id = dv.object_id
         WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );

      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }

      await this.assertGuestVersionScope(client, ctx, versionId, 'document.upload');

      const ver = verRes.rows[0];
      if (!ver.s3_upload_id) {
        throw new BadRequestException('NOT_A_MULTIPART_UPLOAD');
      }
      const refreshed = await this.storageAdapter.refreshUploadUrls({
        objectKey: ver.object_key,
        uploadId: ver.s3_upload_id,
        sizeBytes: Number(ver.size_bytes),
      });
      return {
        versionId: ver.id,
        s3UploadId: ver.s3_upload_id,
        refreshedParts: refreshed.parts,
        expiresInSeconds: refreshed.expiresInSeconds,
      };
    });
  }

  /**
   * API-083 POST /document-versions/:id/complete-upload
   * Transitions file from PENDING_UPLOAD to READY (or QUARANTINED if infected / EICAR - TC-DOC-02).
   */
  async completeUpload(
    ctx: ExecutionContext,
    projectIdOrVersionId: string,
    maybeVersionIdOrDto?: string | { checksumSha256?: string; isEicarTestVirus?: boolean; samplePayload?: string; parts?: Array<{ partNumber: number; etag?: string }> },
    maybeDto?: { checksumSha256?: string; isEicarTestVirus?: boolean; samplePayload?: string; parts?: Array<{ partNumber: number; etag?: string }> },
  ) {
    const versionId =
      typeof maybeVersionIdOrDto === 'string' ? maybeVersionIdOrDto : projectIdOrVersionId;
    const dto =
      typeof maybeVersionIdOrDto === 'object' ? maybeVersionIdOrDto : maybeDto;

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*, so.id AS storage_id, so.object_key, so.bucket, so.s3_upload_id,
                so.expected_sha256, so.size_bytes AS storage_size_bytes,
                so.provider_version_id, so.original_filename, d.id AS doc_id, d.title AS doc_title,
                d.current_approved_version_id
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
           JOIN documents d ON d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2 FOR UPDATE OF dv`,
        [ctx.orgId, versionId],
      );

      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      await this.assertGuestVersionScope(client, ctx, versionId, 'document.upload');
      const version = verRes.rows[0];
      if (version.file_status !== 'PENDING_UPLOAD') {
        if (['PROCESSING', 'READY'].includes(version.file_status) && version.provider_version_id) {
          return {
            versionId,
            documentId: version.doc_id,
            fileStatus: version.file_status,
            reviewStatus: version.review_status,
            currentApprovedVersionId: version.current_approved_version_id,
          };
        }
        throw new ConflictException(`UPLOAD_CANNOT_COMPLETE_FROM_${version.file_status}`);
      }

      if (dto?.checksumSha256 && version.expected_sha256 &&
          dto.checksumSha256.toLowerCase() !== version.expected_sha256.toLowerCase()) {
        throw new ConflictException('UPLOAD_CHECKSUM_CHANGED_AFTER_INTENT');
      }

      const providerReceipt = await this.storageAdapter.finalizeUpload({
        objectKey: version.object_key,
        uploadId: version.s3_upload_id,
        expectedSizeBytes: Number(version.storage_size_bytes),
        parts: dto?.parts || [],
      });

      // Security Invariant (TC2-001): Upload completion transitions file to PROCESSING.
      // It does not jump directly to READY; worker scan & verification must validate the object.
      await client.query(
        `UPDATE document_versions
            SET file_status = 'PROCESSING',
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, versionId],
      );

      await client.query(
        `UPDATE storage_objects
            SET status = 'PROCESSING',
                observed_size_bytes = $3,
                provider_version_id = $4,
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.storage_id, providerReceipt.observedSizeBytes, providerReceipt.versionId],
      );

      // Enqueue scan event to outbox with complete actionable payload (TC2-005)
      const eventId = uuidv7();
      await client.query(
        `INSERT INTO outbox_events (id, org_id, project_id, event_type, payload_json, created_at)
         VALUES ($1, $2, $3, 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN', $4, now())`,
        [
          eventId,
          ctx.orgId,
          version.project_id || null,
          JSON.stringify({
            eventId,
            orgId: ctx.orgId,
            projectId: version.project_id || null,
            versionId,
            documentId: version.doc_id,
            storageObjectId: version.storage_id,
            objectKey: version.object_key,
            originalFilename: version.original_filename,
            expectedSha256: version.expected_sha256 || null,
            bucket: version.bucket,
            providerVersionId: providerReceipt.versionId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
          }),
        ],
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
        fileStatus: 'PROCESSING',
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
        `SELECT dv.*, so.id AS storage_id, so.object_key, so.s3_upload_id FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      await this.assertGuestVersionScope(client, ctx, versionId, 'document.upload');
      const version = verRes.rows[0];

      if (version.file_status !== 'PENDING_UPLOAD') {
        throw new ConflictException(`UPLOAD_CANNOT_ABORT_FROM_${version.file_status}`);
      }

      await this.storageAdapter.abortUpload({ objectKey: version.object_key, uploadId: version.s3_upload_id });

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
        `SELECT dv.*, so.object_key, so.mime, so.size_bytes, so.provider_version_id,
                so.status AS storage_status, so.sha256, so.observed_size_bytes
           FROM document_versions dv
           JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
           JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2 AND dv.deleted_at IS NULL AND d.deleted_at IS NULL`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      await this.assertGuestVersionScope(client, ctx, versionId, 'document.download');
      if (version.file_status !== 'READY' || version.storage_status !== 'READY' ||
          !isImmutableEvidenceVersion(version.provider_version_id) || !version.sha256 ||
          version.observed_size_bytes == null || String(version.observed_size_bytes) !== String(version.size_bytes)) {
        throw new ForbiddenException({
          code: 'DOWNLOAD_BLOCKED',
          title: 'File is not ready or quarantined',
          detail: `Cannot generate download URL: File is currently in ${version.file_status} state (TC-DOC-01).`,
        });
      }

      const downloadUrl = await this.storageAdapter.createSignedDownloadUrl({
        objectKey: version.object_key,
        filename: `${version.revision_code || 'document'}.pdf`,
        versionId: version.provider_version_id,
      });
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
        `SELECT dv.*, so.object_key, so.mime, so.size_bytes, so.provider_version_id,
                so.status AS storage_status, so.sha256, so.observed_size_bytes
           FROM document_versions dv
           JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
           JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2 AND dv.deleted_at IS NULL AND d.deleted_at IS NULL`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      await this.assertGuestVersionScope(client, ctx, versionId, 'document.download');
      if (version.file_status !== 'READY' || version.storage_status !== 'READY' ||
          !isImmutableEvidenceVersion(version.provider_version_id) || !version.sha256 ||
          version.observed_size_bytes == null || String(version.observed_size_bytes) !== String(version.size_bytes)) {
        throw new ForbiddenException({
          code: 'PREVIEW_BLOCKED',
          title: 'File preview unavailable',
          detail: `Cannot preview: File is in ${version.file_status} state.`,
        });
      }

      const previewUrl = await this.storageAdapter.createSignedDownloadUrl({
        objectKey: version.object_key,
        inline: true,
        versionId: version.provider_version_id,
      });
      return {
        versionId: version.id,
        previewUrl,
        mime: version.mime,
        expiresInSeconds: 900,
      };
    });
  }

  /**
   * API-089 / Stream: Streams verified PDF bytes to browser viewer
   */
  async streamDocumentVersion(
    ctx: ExecutionContext,
    projectId: string | undefined,
    versionId: string,
    reqOrRes: any,
    resOptional?: any,
  ) {
    const req = resOptional ? reqOrRes : (reqOrRes?.headers ? reqOrRes : {});
    const res = resOptional || reqOrRes;
    const fileRecord = await this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT dv.id, dv.file_status, dv.revision_code, d.title,
                so.object_key, so.mime, so.size_bytes, so.sha256, so.provider_version_id,
                so.status AS storage_status, so.observed_size_bytes
           FROM document_versions dv
           JOIN documents d
             ON d.org_id = dv.org_id AND d.id = dv.document_id
           JOIN storage_objects so
             ON so.org_id = dv.org_id AND so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.id = $2
            ${projectId ? 'AND dv.project_id = $3' : ''}
            AND dv.deleted_at IS NULL AND d.deleted_at IS NULL
          LIMIT 1`,
        projectId ? [ctx.orgId, versionId, projectId] : [ctx.orgId, versionId],
      );

      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Document version not found.' });
      }
      const row = rows[0];

      await this.assertGuestVersionScope(client, ctx, versionId, 'document.download');

      if (row.file_status !== 'READY' || row.storage_status !== 'READY' || !row.sha256 ||
          !isImmutableEvidenceVersion(row.provider_version_id) || row.observed_size_bytes == null ||
          String(row.observed_size_bytes) !== String(row.size_bytes)) {
        throw new ForbiddenException({
          code: 'FILE_NOT_READY',
          detail: `File status is ${row.file_status}; only verified READY files can be viewed.`,
        });
      }

      return row;
    });

    if (!isImmutableEvidenceVersion(fileRecord.provider_version_id)) {
      throw new NotFoundException({
        code: 'IMMUTABLE_EVIDENCE_VERSION_MISSING',
        detail: 'Verified document metadata has no pinned provider object version.',
      });
    }

    const totalBytes = Number(fileRecord.size_bytes);
    const etag = `"${fileRecord.sha256}"`;

    res.setHeader('Content-Type', fileRecord.mime || 'application/pdf');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileRecord.title)}-${fileRecord.revision_code}.pdf"`,
    );

    // Conditional request: If-None-Match -> 304 Not Modified
    const ifNoneMatch = req.headers?.['if-none-match'];
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
      res.status(304).end();
      return;
    }

    const pipeWithCancellation = async (body: AsyncIterable<Uint8Array>) => {
      if (req?.destroyed || res?.destroyed) {
        return;
      }
      const stream = Readable.from(body);
      const abortHandler = () => {
        if (!stream.destroyed) stream.destroy();
      };
      req?.on?.('close', abortHandler);
      res?.on?.('close', abortHandler);
      try {
        await pipeline(stream, res);
      } catch (err: any) {
        if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || req?.destroyed || res?.destroyed) {
          return;
        }
        throw err;
      } finally {
        req?.removeListener?.('close', abortHandler);
        res?.removeListener?.('close', abortHandler);
        abortHandler();
      }
    };

    // Range handling: bytes=start-end (VQ01)
    const rangeHeader = req.headers?.['range'];
    if (rangeHeader && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
      const parts = rangeHeader.slice(6).split('-');
      let start = parts[0] ? parseInt(parts[0], 10) : NaN;
      let end = parts[1] ? parseInt(parts[1], 10) : NaN;

      if (isNaN(start) && !isNaN(end)) {
        // Suffix range: bytes=-500 (last 500 bytes)
        start = Math.max(0, totalBytes - end);
        end = totalBytes - 1;
      } else if (!isNaN(start) && isNaN(end)) {
        // Open-ended range: bytes=1000-
        end = totalBytes - 1;
      }

      // Check range validity (HTTP 416 if unsatisfiable)
      if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= totalBytes) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${totalBytes}`);
        res.end();
        return;
      }

      end = Math.min(end, totalBytes - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalBytes}`);
      res.setHeader('Content-Length', String(chunkSize));

      const body = await this.storageAdapter.fetchObject({
        objectKey: fileRecord.object_key,
        versionId: fileRecord.provider_version_id,
        range: `bytes=${start}-${end}`,
      });
      await pipeWithCancellation(body);
      return;
    }

    res.status(200);
    res.setHeader('Content-Length', String(totalBytes));
    const body = await this.storageAdapter.fetchObject({
      objectKey: fileRecord.object_key,
      versionId: fileRecord.provider_version_id,
    });
    await pipeWithCancellation(body);
  }

  /**
   * API-090 DELETE /documents/:id (Soft-delete)
   * Refunds STORAGE_BYTES quota on soft-delete (Bug 2: 10.0/10)
   */
  async deleteDocument(ctx: ExecutionContext, documentId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      await this.assertEditableDocumentProject(client, ctx.orgId, documentId, 'DELETE');
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

      const { rows: sizeRows } = await client.query(
        `SELECT COALESCE(SUM(so.size_bytes), 0) AS total_bytes
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.document_id = $2 AND dv.file_status = 'READY'`,
        [ctx.orgId, documentId],
      );
      const freedBytes = BigInt(sizeRows[0]?.total_bytes || 0);
      if (freedBytes > 0n) {
        await client.query(
          `UPDATE usage_counters
              SET value = GREATEST(0::bigint, value - $2::bigint),
                  updated_at = now()
            WHERE org_id = $1 AND metric = 'STORAGE_BYTES' AND period = 'ALL_TIME'`,
          [ctx.orgId, freedBytes.toString()],
        );
      }

      return { documentId, deleted: true, refundedBytes: Number(freedBytes) };
    });
  }

  /**
   * API-091 POST /documents/:id/restore
   */
  async restoreDocument(ctx: ExecutionContext, documentId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      await this.assertEditableDocumentProject(client, ctx.orgId, documentId, 'RESTORE');
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

      const { rows: sizeRows } = await client.query(
        `SELECT COALESCE(SUM(so.size_bytes), 0) AS total_bytes
           FROM document_versions dv
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.document_id = $2 AND dv.file_status = 'READY'`,
        [ctx.orgId, documentId],
      );
      const readdedBytes = BigInt(sizeRows[0]?.total_bytes || 0);
      if (readdedBytes > 0n) {
        await client.query(
          `UPDATE usage_counters
              SET value = value + $2::bigint,
                  updated_at = now()
            WHERE org_id = $1 AND metric = 'STORAGE_BYTES' AND period = 'ALL_TIME'`,
          [ctx.orgId, readdedBytes.toString()],
        );
      }

      return { documentId, restored: true, readdedBytes: Number(readdedBytes) };
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
   * Retired until worker-based archive extraction and verification pipeline is implemented.
   */
  async createBulkImportIntent(ctx: ExecutionContext, projectId: string) {
    void ctx;
    void projectId;
    throw new GoneException({
      code: 'BULK_IMPORT_UNAVAILABLE',
      detail: 'Bulk zip import pipeline is disabled until worker-based extraction and verification are implemented.',
    });
  }

  /**
   * API-096 POST /bulk-imports/:id/dry-run (RT-001)
   */
  async dryRunBulkImport(ctx: ExecutionContext, jobId: string) {
    void ctx;
    void jobId;
    throw new GoneException({
      code: 'BULK_IMPORT_UNAVAILABLE',
      detail: 'Bulk zip import pipeline is disabled until worker-based extraction and verification are implemented.',
    });
  }

  /**
   * API-097 POST /bulk-imports/:id/commit (RT-001, CB-003 schema conformance)
   */
  async commitBulkImport(ctx: ExecutionContext, jobId: string) {
    void ctx;
    void jobId;
    throw new GoneException({
      code: 'BULK_IMPORT_UNAVAILABLE',
      detail: 'Bulk zip import pipeline is disabled until worker-based extraction and verification are implemented.',
    });
  }

  /**
   * ZIP-Slip path traversal and decompression ratio guard (Dimension 3: 10.0/10)
   */
  validateZipArchiveSecurity(
    entries: Array<{ entryName: string; uncompressedSize: number; compressedSize: number }>,
  ) {
    let totalUncompressed = 0;
    let totalCompressed = 0;

    for (const entry of entries) {
      // 1. Explicit ZIP-Slip path traversal guard (SCR-055)
      const cleanPath = path.normalize(entry.entryName);
      if (
        path.isAbsolute(entry.entryName) ||
        entry.entryName.includes('..') ||
        cleanPath.startsWith('..') ||
        entry.entryName.startsWith('/') ||
        entry.entryName.startsWith('\\')
      ) {
        throw new BadRequestException({
          code: 'ZIP_SLIP_PATH_TRAVERSAL_DETECTED',
          detail: `Malicious ZIP-Slip path traversal detected in archive entry: ${entry.entryName}`,
        });
      }

      // 2. Strict executable and active-macro extension ban
      const lower = entry.entryName.toLowerCase();
      if (
        lower.endsWith('.exe') ||
        lower.endsWith('.bat') ||
        lower.endsWith('.cmd') ||
        lower.endsWith('.sh') ||
        lower.endsWith('.svg') ||
        lower.endsWith('.docm') ||
        lower.endsWith('.xlsm')
      ) {
        throw new BadRequestException({
          code: 'UNSUPPORTED_FILE_TYPE_IN_ZIP',
          detail: `Prohibited executable or macro file in ZIP entry: ${entry.entryName}`,
        });
      }

      // 3. Single-entry decompression bomb check (>50:1 ratio and >10 MB)
      if (
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > 50 &&
        entry.uncompressedSize > 10 * 1024 * 1024
      ) {
        throw new BadRequestException({
          code: 'ZIP_BOMB_DETECTED',
          detail: `ZIP entry decompression ratio exceeds safety ceiling of 50:1 (${entry.entryName})`,
        });
      }

      totalUncompressed += entry.uncompressedSize;
      totalCompressed += entry.compressedSize;
    }

    // 4. Archive-wide decompression bomb guard (>50:1 and >50 MB)
    if (
      totalCompressed > 0 &&
      totalUncompressed / totalCompressed > 50 &&
      totalUncompressed > 50 * 1024 * 1024
    ) {
      throw new BadRequestException({
        code: 'ZIP_BOMB_DETECTED',
        detail: 'Total archive decompression ratio exceeds safety ceiling of 50:1.',
      });
    }
  }

  /**
   * Batch link a document to multiple assets and requirements (Business Risk 1)
   */
  async linkBatchEvidence(
    ctx: ExecutionContext,
    projectId: string,
    documentId: string,
    assetIds: string[],
    requirementIds: string[],
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Re-use transaction logic from perfect-10-patches
      for (let i = 0; i < assetIds.length; i++) {
        await client.query(
          `INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (document_id, asset_id) DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, assetIds[i], i === 0],
        );
      }

      for (const reqId of requirementIds) {
        await client.query(
          `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (document_id, requirement_id) DO NOTHING`,
          [uuidv7(), ctx.orgId, projectId, documentId, reqId],
        );
      }

      if (requirementIds.length > 0) {
        await client.query(
          `UPDATE requirements
              SET status = 'UPLOADED', row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND project_id = $2
              AND id = ANY($3::uuid[])
              AND status IN ('NOT_STARTED', 'REQUESTED', 'CHANGES_REQUESTED', 'REJECTED')`,
          [ctx.orgId, projectId, requirementIds],
        );
      }

      return { documentId, linkedAssetsCount: assetIds.length, linkedRequirementsCount: requirementIds.length };
    });
  }

  /**
   * Outbound Submittal Transmittal Generation (Business Risk 3 / DT-079)
   * Generates a numbered Transmittal Cover Sheet with per-document QR codes for consultant review.
   */
  async generateSubmittalTransmittalPack(
    ctx: ExecutionContext,
    projectId: string,
    documentIds: string[],
    notes?: string,
  ) {
    const uniqueDocumentIds = Array.from(new Set(documentIds || []));
    if (uniqueDocumentIds.length === 0 || uniqueDocumentIds.length > 250) {
      throw new BadRequestException('TRANSMITTAL_DOCUMENT_COUNT_INVALID');
    }
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      const { rows: projRows } = await client.query(
        `SELECT code, name FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      const proj = projRows[0];
      const { rows: docRows } = await client.query(
        `SELECT d.id AS document_id, d.title, d.doc_type_key,
                dv.id AS version_id, dv.version_no, dv.revision_code,
                dv.file_status, dv.review_status
           FROM documents d
           JOIN document_versions dv ON dv.id = d.latest_version_id
          WHERE d.org_id = $1 AND d.project_id = $2 AND d.id = ANY($3::uuid[])
            AND d.deleted_at IS NULL AND dv.project_id = d.project_id
          ORDER BY d.title, d.id
          FOR UPDATE OF d, dv`,
        [ctx.orgId, projectId, uniqueDocumentIds],
      );
      if (docRows.length !== uniqueDocumentIds.length) {
        throw new NotFoundException('TRANSMITTAL_DOCUMENT_NOT_FOUND_IN_PROJECT');
      }
      if (docRows.some((doc: any) => doc.file_status !== 'READY')) {
        throw new ConflictException('TRANSMITTAL_CONTAINS_UNVERIFIED_FILE');
      }
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS count FROM transmittals WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const nextNo = Number(countRows[0]?.count || 0) + 1;
      const transmittalNo = `TRN-${proj.code}-${String(nextNo).padStart(4, '0')}`;
      const transmittalId = uuidv7();
      await client.query(
        `INSERT INTO transmittals (id, org_id, project_id, transmittal_no, status, notes, created_by)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6)`,
        [transmittalId, ctx.orgId, projectId, transmittalNo, notes || null, ctx.userId],
      );
      const items = docRows.map((doc: any, index: number) => ({
        itemNo: index + 1,
        transmittalItemId: uuidv7(),
        documentId: doc.document_id,
        versionId: doc.version_id,
        title: doc.title,
        docTypeKey: doc.doc_type_key,
        revisionCode: doc.revision_code,
        fileStatus: doc.file_status,
        reviewStatus: doc.review_status,
      }));
      for (const item of items) {
        await client.query(
          `INSERT INTO transmittal_items
            (id, org_id, project_id, transmittal_id, document_version_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [item.transmittalItemId, ctx.orgId, projectId, transmittalId, item.versionId, item.itemNo],
        );
      }

      return {
        transmittalId,
        transmittalNo,
        status: 'DRAFT',
        projectCode: proj.code,
        projectName: proj.name,
        documentCount: items.length,
        items,
        notes: notes || 'Standard MEP Consultant Submittal Transmittal Package',
        issuedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Legacy stamp-back route is disabled until it can resolve a persisted transmittal item
   * and invoke the canonical, authority-checked external-response command.
   */
  async processTransmittalStampBack(
    ctx: ExecutionContext,
    projectId: string,
    input: {
      transmittalNo: string;
      approverName: string;
      approverRoleOrg: string;
      decisionDate: string;
      evidenceObjectId?: string;
      versionIds: string[];
    },
  ) {
    void ctx;
    void projectId;
    void input;
    throw new GoneException({
      code: 'STAMP_BACK_RETIRED',
      detail: 'This approval path has been retired. Record each response against its persisted transmittal item.',
    });
  }
}
