// apps/api/src/modules/reviews/reviews.service.ts
// Atomic review queue, row-locked approvals, comments & external approvals (AUD-005, AUD-007, RT-009, RT-022, FR-REV-001..017)

import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  GoneException,
  HttpException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { STANDARD_COMPANION_RULES } from '@tradecloseout/db';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { ExternalApprovalDto } from './dto/external-approval.dto';

export function isExpiredOnIndiaDate(expiryDate: string | Date, now = new Date()): boolean {
  const expiry = expiryDate instanceof Date ? expiryDate.toISOString().slice(0, 10) : String(expiryDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new UnprocessableEntityException('INVALID_EXPIRY_DATE');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return expiry < `${parts.year}-${parts.month}-${parts.day}`;
}

export interface DecisionDto {
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  comment?: string;
  expectedRowVersion?: number;
  occurredAt?: string;
  occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';
  backdatingReason?: string;
}

export interface ReviewCommentDto {
  pageNo?: number;
  x?: number;
  y?: number;
  body?: string;
  comment?: string;
  visibility?: 'PUBLIC' | 'INTERNAL' | 'EXTERNAL';
}

@Injectable()
export class ReviewsService {
  constructor(private readonly db: TenantDbService) {}

  private async assertVerifiedReviewEvidence(client: PoolClient, orgId: string, version: any): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM storage_objects
        WHERE org_id = $1 AND id = $2 AND status = 'READY'
          AND sha256 IS NOT NULL AND provider_version_id IS NOT NULL
          AND observed_size_bytes IS NOT NULL AND observed_size_bytes = size_bytes
        LIMIT 1`,
      [orgId, version.object_id],
    );
    if (!rows.length) {
      throw new ConflictException({
        code: 'EVIDENCE_OBJECT_NOT_VERIFIED',
        detail: 'The evidence version has no verified immutable storage object.',
      });
    }
  }

  /**
   * API-062 POST /requirements/:id/submit-review
   * Submits a document version against a checklist requirement for review.
   */
  async submitReview(
    ctx: ExecutionContext,
    requirementId: string,
    dto: { documentVersionId: string; remarks?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Fetch requirement
      const reqRes = await client.query(
        `SELECT * FROM requirements WHERE org_id = $1 AND id = $2 AND superseded_at IS NULL`,
        [ctx.orgId, requirementId],
      );
      if (!reqRes.rows.length) {
        throw new NotFoundException('REQUIREMENT_NOT_FOUND');
      }
      const req = reqRes.rows[0];

      // 2. Fetch document version
      const verRes = await client.query(
        `SELECT dv.*, d.id AS doc_id, d.project_id AS document_project_id,
                d.latest_version_id AS document_latest_version_id
           FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, dto.documentVersionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('DOCUMENT_VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];
      if (version.project_id !== req.project_id || version.document_project_id !== req.project_id) {
        throw new NotFoundException('VERSION_NOT_IN_REQUIREMENT_PROJECT');
      }
      if (version.file_status !== 'READY') {
        throw new ConflictException('FILE_NOT_READY_FOR_REVIEW');
      }
      if (version.document_latest_version_id && version.document_latest_version_id !== version.id) {
        throw new ConflictException('VERSION_SUPERSEDED');
      }

      // Link document to requirement if not linked
      await client.query(
        `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (document_id, requirement_id) DO NOTHING`,
        [uuidv7(), ctx.orgId, req.project_id, version.doc_id, requirementId],
      );

      // Create review record
      const reviewId = uuidv7();
      const reviewRes = await client.query(
        `INSERT INTO reviews (
          id, org_id, project_id, document_version_id, stage_key,
          reviewer_subject_type, reviewer_subject_id, method, status, created_at
        ) VALUES (
          $1, $2, $3, $4, 'SUBMISSION_REVIEW',
          'USER', $5, 'IN_APP', 'IN_REVIEW', now()
        ) RETURNING *`,
        [reviewId, ctx.orgId, req.project_id, version.id, ctx.userId],
      );

      // Transition version and requirement status
      await client.query(
        `UPDATE document_versions SET review_status = 'IN_REVIEW', updated_at = now() WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.id],
      );
      await client.query(
        `UPDATE requirements SET status = 'IN_REVIEW', updated_at = now() WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, requirementId],
      );

      return {
        reviewId,
        requirementId,
        versionId: version.id,
        status: 'IN_REVIEW',
      };
    });
  }

  /**
   * API-100 GET /projects/:projectId/reviews
   * Review queue listing pending reviews for a project.
   */
  async listReviews(ctx: ExecutionContext, projectId: string, filter?: { status?: string }) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      let query = `
        SELECT r.*,
               dv.version_no, dv.revision_code, dv.issue_date,
               d.title AS document_title, d.category_key,
               req.id AS requirement_id, req.title AS requirement_title, req.reviewer_role
          FROM reviews r
          JOIN document_versions dv ON dv.id = r.document_version_id
          JOIN documents d ON d.id = dv.document_id
          LEFT JOIN document_requirements dr ON dr.document_id = d.id
          LEFT JOIN requirements req ON req.id = dr.requirement_id
         WHERE r.org_id = $1 AND r.project_id = $2
      `;
      const params: any[] = [ctx.orgId, projectId];

      if (filter?.status) {
        params.push(filter.status);
        query += ` AND r.status = $${params.length}`;
      } else {
        query += ` AND r.status IN ('PENDING', 'IN_REVIEW')`;
      }

      query += ` ORDER BY r.created_at DESC`;
      const res = await client.query(query, params);
      return res.rows;
    });
  }

  /**
   * API-101 GET /reviews/:id
   * Detailed view of a review submittal with page comments and version metadata.
   */
  async getReview(ctx: ExecutionContext, reviewId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const reviewRes = await client.query(
        `SELECT r.*,
                dv.version_no, dv.revision_code, dv.file_status, dv.issue_date,
                d.title AS document_title, d.category_key,
                so.object_key, so.size_bytes, so.mime
           FROM reviews r
           JOIN document_versions dv ON dv.id = r.document_version_id
           JOIN documents d ON d.id = dv.document_id
           JOIN storage_objects so ON so.id = dv.object_id
          WHERE r.org_id = $1 AND r.id = $2`,
        [ctx.orgId, reviewId],
      );
      if (!reviewRes.rows.length) {
        throw new NotFoundException('REVIEW_NOT_FOUND');
      }
      const review = reviewRes.rows[0];

      // Fetch comments (TC2-014: join on rc.created_by matching schema)
      const commentsRes = await client.query(
        `SELECT rc.*, u.name AS author_name
           FROM review_comments rc
           LEFT JOIN users u ON u.id = rc.created_by
          WHERE rc.org_id = $1 AND rc.review_id = $2
          ORDER BY rc.created_at ASC`,
        [ctx.orgId, reviewId],
      );

      return {
        ...review,
        comments: commentsRes.rows,
      };
    });
  }

  /**
   * API-103 POST /reviews/:id/comments
   * Adds page-level annotation comment with public/internal visibility (05 §6.4).
   */
  async addComment(ctx: ExecutionContext, reviewId: string, dto: ReviewCommentDto) {
    const text = dto.body || dto.comment;
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Comment text cannot be empty');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const reviewRes = await client.query(
        `SELECT id, project_id FROM reviews WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, reviewId],
      );
      if (!reviewRes.rows.length) {
        throw new NotFoundException('REVIEW_NOT_FOUND');
      }
      const review = reviewRes.rows[0];

      const commentId = uuidv7();
      const visibility = dto.visibility || 'EXTERNAL';

      const res = await client.query(
        `INSERT INTO review_comments (
          id, org_id, project_id, review_id, page_no, body, visibility, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        RETURNING *`,
        [
          commentId,
          ctx.orgId,
          review.project_id,
          reviewId,
          dto.pageNo || null,
          text.trim(),
          visibility,
          ctx.userId,
        ],
      );

      return res.rows[0];
    });
  }

  async getVersionReviewDetail(ctx: ExecutionContext, projectId: string, versionId: string) {
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new NotFoundException('DOCUMENT_VERSION_NOT_FOUND');
    }
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const verRes = await client.query(
        `SELECT dv.*,
                d.title as doc_title, d.category_key, d.doc_type_key,
                so.sha256 as object_sha256, so.size_bytes, so.mime,
                u.name as uploader_name
         FROM document_versions dv
         JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
         LEFT JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
         LEFT JOIN users u ON u.id = dv.uploaded_by
         WHERE dv.org_id = $1 AND dv.id = $2 AND dv.project_id = $3
           AND dv.deleted_at IS NULL AND d.deleted_at IS NULL`,
        [ctx.orgId, versionId, projectId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('DOCUMENT_VERSION_NOT_FOUND');
      }
      const v = verRes.rows[0];

      // Find linked requirement if any
      const reqRes = await client.query(
        `SELECT r.* FROM requirements r
         JOIN document_requirements dr ON dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
         WHERE dr.org_id = $1 AND dr.document_id = $2 AND dr.project_id = $3 AND r.superseded_at IS NULL
         LIMIT 1`,
        [ctx.orgId, v.document_id, projectId],
      );
      const req = reqRes.rows[0];

      // Reading a document must never create or assign a review.
      const revRes = await client.query(
        `SELECT id, status FROM reviews
          WHERE org_id = $1 AND project_id = $2 AND document_version_id = $3
            AND reviewer_subject_type = 'USER' AND reviewer_subject_id = $4
          ORDER BY created_at DESC LIMIT 1`,
        [ctx.orgId, projectId, versionId, ctx.userId],
      );
      const reviewId = revRes.rows[0]?.id || null;

      const commRes = reviewId ? await client.query(
        `SELECT rc.id, rc.page_no, rc.body, rc.visibility, rc.created_at,
                COALESCE(u.name, 'Reviewer') as author_name
         FROM review_comments rc
         LEFT JOIN users u ON u.id = rc.created_by
         WHERE rc.org_id = $1 AND rc.review_id = $2
         ORDER BY rc.created_at ASC`,
        [ctx.orgId, reviewId],
      ) : { rows: [] };
      const comments = commRes.rows.map((c) => ({
        id: c.id,
        pageNo: c.page_no,
        body: c.body,
        visibility: c.visibility,
        authorName: c.author_name,
        createdAt: c.created_at,
      }));

      const docTypeKey = req?.doc_type_key || v.doc_type_key || v.category_key;
      const companionEval = await this.evaluateCompanionEvidence(
        client,
        ctx.orgId,
        projectId,
        docTypeKey,
        v.document_id,
      );

      return {
        versionId: v.id,
        documentId: v.document_id,
        requirementId: req?.id ?? null,
        requirementKey: req?.requirement_key ?? null,
        requirementTitle: req?.title || v.doc_title,
        docTypeKey,
        assetTag: req?.scope_key?.startsWith('asset:') ? req.scope_key.slice(6, 14).toUpperCase() : null,
        revisionCode: v.revision_code,
        issueDate: v.issue_date ?? null,
        expiryDate: v.expiry_date || null,
        fileStatus: v.file_status,
        reviewStatus: v.review_status,
        pageCount: null,
        sha256: v.object_sha256 ?? null,
        uploadedByName: v.uploader_name ?? null,
        reviewerRole: req?.reviewer_role ?? null,
        rowVersion: v.row_version,
        reviewId,
        comments,
        companions: companionEval.companions,
        hasMissingCompanions: companionEval.hasMissingCompanions,
        hasMissingMandatoryCompanions: companionEval.hasMissingMandatory,
      };
    });
  }

  /**
   * Evaluates missing companion evidence rules (Top 25 Item 6).
   * E.g. DT-018 (Pressure test) requires DT-041 (Calibration certificate).
   */
  async evaluateCompanionEvidence(
    client: PoolClient,
    orgId: string,
    projectId: string,
    docTypeKey: string,
    primaryDocumentId?: string | null,
  ) {
    const { rows: dbRules } = await client.query(
      `SELECT rule_code, rule_name, primary_doc_type, companion_doc_type, description, is_mandatory
       FROM evidence_companion_rules
       WHERE org_id = $1 AND primary_doc_type = $2`,
      [orgId, docTypeKey],
    );

    const standardRules = STANDARD_COMPANION_RULES.filter(
      (r) => r.primaryDocType === docTypeKey && !dbRules.some((dr) => dr.rule_code === r.ruleCode),
    );

    const allRules = [
      ...dbRules.map((r) => ({
        ruleCode: r.rule_code,
        ruleName: r.rule_name,
        primaryDocType: r.primary_doc_type,
        companionDocType: r.companion_doc_type,
        description: r.description,
        isMandatory: r.is_mandatory,
      })),
      ...standardRules,
    ];

    if (!allRules.length) {
      return { hasMissingCompanions: false, hasMissingMandatory: false, companions: [] };
    }

    const companions: any[] = [];
    let hasMissingMandatory = false;

    for (const rule of allRules) {
      const compRes = await client.query(
        `SELECT dv.id, dv.revision_code, d.title
         FROM document_versions dv
         JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
         JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
         WHERE dv.org_id = $1 AND dv.project_id = $2
           AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
           AND dv.id = d.current_approved_version_id AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
           AND dv.review_status = 'APPROVED' AND dv.file_status = 'READY'
           AND (dv.expiry_date IS NULL OR dv.expiry_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
           AND so.status = 'READY' AND so.sha256 IS NOT NULL AND so.provider_version_id IS NOT NULL
           AND so.observed_size_bytes IS NOT NULL AND so.observed_size_bytes = so.size_bytes
           AND (d.doc_type_key = $3 OR d.category_key = $3 OR d.metadata_json->>'doc_type_key' = $3)
           AND $4::uuid IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM document_requirements pdr
             JOIN requirements pr ON pr.org_id = pdr.org_id AND pr.project_id = pdr.project_id AND pr.id = pdr.requirement_id
             WHERE pdr.org_id = $1 AND pdr.project_id = $2 AND pdr.document_id = $4 AND pr.superseded_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM document_requirements pdr
             JOIN requirements pr ON pr.org_id = pdr.org_id AND pr.project_id = pdr.project_id AND pr.id = pdr.requirement_id
             WHERE pdr.org_id = $1 AND pdr.project_id = $2 AND pdr.document_id = $4 AND pr.superseded_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM document_requirements cdr
                 JOIN requirements cr ON cr.org_id = cdr.org_id AND cr.project_id = cdr.project_id AND cr.id = cdr.requirement_id
                 WHERE cdr.org_id = $1 AND cdr.project_id = $2 AND cdr.document_id = d.id
                   AND cr.scope_key = pr.scope_key AND cr.superseded_at IS NULL
               )
           )
         ORDER BY dv.version_no DESC, dv.id
         LIMIT 1`,
        [orgId, projectId, rule.companionDocType, primaryDocumentId ?? null],
      );

      if (compRes.rows.length) {
        companions.push({
          ruleCode: rule.ruleCode,
          ruleName: rule.ruleName,
          companionDocType: rule.companionDocType,
          status: 'SATISFIED',
          companionVersionId: compRes.rows[0].id,
          companionRevision: compRes.rows[0].revision_code,
          isMandatory: rule.isMandatory,
          message: `${rule.ruleName} is satisfied by approved version ${compRes.rows[0].revision_code}`,
        });
      } else {
        companions.push({
          ruleCode: rule.ruleCode,
          ruleName: rule.ruleName,
          companionDocType: rule.companionDocType,
          status: 'MISSING',
          isMandatory: rule.isMandatory,
          message: rule.description,
        });
        if (rule.isMandatory) {
          hasMissingMandatory = true;
        }
      }
    }

    return {
      hasMissingCompanions: companions.some((c) => c.status === 'MISSING'),
      hasMissingMandatory,
      companions,
    };
  }

  /** General review overrides are unavailable until scoped exceptions have their own authority workflow. */
  async overrideReview(
    ctx: ExecutionContext,
    reviewId: string,
    dto: { justification: string; decision: 'APPROVE' | 'REJECT' },
  ) {
    void ctx;
    void reviewId;
    void dto;
    throw new GoneException('SCOPED_REVIEW_EXCEPTION_WORKFLOW_UNAVAILABLE');
  }

  /**
   * API-107 POST /reviews/bulk-decisions
   * Bulk decisions across multiple review queue items.
   */
  async bulkDecisions(
    ctx: ExecutionContext,
    dto: { reviewIds: string[]; decision: 'APPROVE' | 'REJECT'; comment?: string },
  ) {
    const results: any[] = [];
    for (const reviewId of dto.reviewIds) {
      try {
        const res = await this.decideReview(ctx, reviewId, {
          decision: dto.decision,
          comment: dto.comment || 'Bulk review decision',
        });
        results.push({ reviewId, success: true, ...res });
      } catch (err: any) {
        results.push({ reviewId, success: false, error: err.message });
      }
    }
    return { count: results.length, results };
  }

  async recordVersionReview(
    ctx: ExecutionContext,
    projectId: string,
    dto: {
      documentVersionId: string;
      decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
      comment?: string;
      expectedRowVersion?: number;
      method?: string;
      occurredAt?: string;
      occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';
      backdatingReason?: string;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Decisions require an existing assignment; a caller cannot create one by deciding.
      const { rows: revRows } = await client.query(
        `SELECT id FROM reviews WHERE org_id = $1 AND project_id = $2 AND document_version_id = $3
           AND reviewer_subject_type = 'USER' AND reviewer_subject_id = $4
           AND status IN ('PENDING', 'IN_REVIEW') LIMIT 1`,
        [ctx.orgId, projectId, dto.documentVersionId, ctx.userId],
      );
      const reviewId = revRows[0]?.id;
      if (!reviewId) throw new ForbiddenException('REVIEW_ASSIGNMENT_REQUIRED');

      return this.decideReview(
        ctx,
        reviewId,
        {
          decision: dto.decision,
          comment: dto.comment,
          expectedRowVersion: dto.expectedRowVersion,
          occurredAt: dto.occurredAt,
          occurredAtPrecision: dto.occurredAtPrecision,
          backdatingReason: dto.backdatingReason,
        },
        client,
      );
    });
  }

  /**
   * API-102 POST /reviews/:id/decisions (AUD-007, CB-005, CB-012, FR-REV-009, AUD-005)
   */
  async decideReview(
    ctx: ExecutionContext,
    reviewId: string,
    dto: DecisionDto,
    existingClient?: PoolClient,
  ) {
    if (
      (dto.decision === 'REQUEST_CHANGES' || dto.decision === 'REJECT') &&
      (!dto.comment || dto.comment.trim().length < 5)
    ) {
      throw new BadRequestException('COMMENT_REQUIRED: Minimum 5 characters required for rejection or change requests');
    }

    const run = async (client: PoolClient) => {
      // 1. Fetch review record
      const reviewRes = await client.query(
        `SELECT * FROM reviews WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, reviewId],
      );
      if (!reviewRes.rows.length) {
        throw new NotFoundException('REVIEW_NOT_FOUND');
      }
      const review = reviewRes.rows[0];
      if (review.status !== 'IN_REVIEW' && review.status !== 'PENDING') {
        throw new ConflictException(`INVALID_STATE_TRANSITION: Review is already in status ${review.status}`);
      }
      if (ctx.actorType === 'GUEST' || review.reviewer_subject_type !== 'USER' ||
          review.reviewer_subject_id !== ctx.userId ||
          (review.reviewer_user_id && review.reviewer_user_id !== ctx.userId)) {
        throw new ForbiddenException('REVIEW_ASSIGNMENT_REQUIRED');
      }

      // 2. Lock document_version FOR UPDATE via document_version_id (CB-005, AUD-007)
      const verRes = await client.query(
        `SELECT * FROM document_versions WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, review.document_version_id],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('DOCUMENT_VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

      // Optimistic concurrency check (10 §1 If-Match, NP10)
      if (dto.expectedRowVersion !== undefined && version.row_version !== dto.expectedRowVersion) {
        throw new HttpException(
          {
            code: 'PRECONDITION_FAILED',
            detail: `Version changed concurrently: expected row_version ${dto.expectedRowVersion}, current is ${version.row_version}.`,
          },
          412,
        );
      }

      // Security Invariant (TC2-003): Approval requires verified READY file_status
      if (dto.decision === 'APPROVE' && version.file_status !== 'READY') {
        throw new ConflictException({
          code: 'FILE_NOT_READY',
          detail: `Cannot approve document version: file_status is ${version.file_status}. Only scanned and verified READY files can be approved.`,
        });
      }
      if (dto.decision === 'APPROVE') await this.assertVerifiedReviewEvidence(client, ctx.orgId, version);

      // 3. Lock parent document FOR UPDATE (AUD-007)
      const docRes = await client.query(
        `SELECT * FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, version.document_id],
      );
      const doc = docRes.rows[0];

      // 4. Verify version is latest
      if (doc.latest_version_id && doc.latest_version_id !== version.id) {
        throw new ConflictException('INVALID_STATE_TRANSITION: Superseded by a newer version');
      }

      // 5. Self-approval prohibition (FR-REV-009)
      if (version.uploaded_by === ctx.userId) {
        throw new ForbiddenException('SELF_APPROVAL_DENIED: Uploader cannot approve own submittal');
      }

      const linkedRequirements = await client.query(
        `SELECT DISTINCT r.reviewer_role
           FROM document_requirements dr
           JOIN requirements r ON r.org_id = dr.org_id AND r.project_id = dr.project_id AND r.id = dr.requirement_id
          WHERE dr.org_id = $1 AND dr.project_id = $2 AND dr.document_id = $3
            AND r.reviewer_role IS NOT NULL AND r.superseded_at IS NULL`,
        [ctx.orgId, version.project_id, doc.id],
      );
      const authorityRoles = new Set([
        (ctx as any).orgRole as string | undefined,
        (ctx as any).projectRole as string | undefined,
      ].filter(Boolean));
      if (linkedRequirements.rows.some((row: any) => !authorityRoles.has(row.reviewer_role))) {
        throw new ForbiddenException('REVIEWER_ROLE_REQUIRED');
      }

      if (dto.decision === 'APPROVE') {
        // Check certificate expiry (RT-009)
        if (version.expiry_date && isExpiredOnIndiaDate(version.expiry_date)) {
          throw new ConflictException('422 DOCUMENT_ALREADY_EXPIRED');
        }

        // Check companion evidence rules (Top 25 Item 6)
        {
          const companionEval = await this.evaluateCompanionEvidence(
            client,
            ctx.orgId,
            review.project_id,
            doc.doc_type_key || doc.category_key || 'DT-001',
            doc.id,
          );
          if (companionEval.hasMissingMandatory) {
            throw new UnprocessableEntityException({
              code: 'MISSING_COMPANION_EVIDENCE',
              title: 'Mandatory companion evidence missing',
              detail:
                'Cannot approve document version: required companion evidence is missing. Attach companion evidence or obtain an authorized override.',
              companions: companionEval.companions.filter((c: any) => c.status === 'MISSING' && c.isMandatory),
            });
          }
        }

        // Supersede previous approved version if exists
        if (doc.current_approved_version_id && doc.current_approved_version_id !== version.id) {
          await client.query(
            `UPDATE document_versions
             SET review_status = 'SUPERSEDED', superseded_at = now()
             WHERE org_id = $1 AND id = $2`,
            [ctx.orgId, doc.current_approved_version_id],
          );
        }

        // Mark this version APPROVED (do not alter file_status; review is independent business state)
        await client.query(
          `UPDATE document_versions
           SET review_status = 'APPROVED', row_version = row_version + 1
           WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, version.id],
        );

        // Update documents.current_approved_version_id
        await client.query(
          `UPDATE documents
           SET current_approved_version_id = $1, latest_version_id = $1,
               row_version = row_version + 1, updated_at = now()
           WHERE org_id = $2 AND id = $3`,
          [version.id, ctx.orgId, doc.id],
        );

        // Update review record with dual event timestamps (Top 25 Item 4)
        await client.query(
          `UPDATE reviews
           SET status = 'APPROVED', decision = 'APPROVE', comment = $1,
               decided_at = now(), reviewer_user_id = $2,
               occurred_at = COALESCE($5, now()),
               occurred_at_precision = $6,
               recorded_at = now(),
               backdating_reason = $7,
               is_override = $8
           WHERE org_id = $3 AND id = $4`,
          [
            dto.comment || null,
            ctx.userId,
            ctx.orgId,
            review.id,
            dto.occurredAt ? new Date(dto.occurredAt) : null,
            dto.occurredAtPrecision || 'INSTANT',
            dto.backdatingReason || null,
            false,
          ],
        );

        // Transition associated requirements to APPROVED
        await client.query(
          `UPDATE requirements
              SET status = 'APPROVED', row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND id IN (
              SELECT requirement_id FROM document_requirements WHERE document_id = $2
            )`,
          [ctx.orgId, doc.id],
        );

      } else {
        const nextStatus = dto.decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
        await client.query(
          `UPDATE document_versions SET review_status = $1, row_version = row_version + 1 WHERE org_id = $2 AND id = $3`,
          [nextStatus, ctx.orgId, version.id],
        );
        await client.query(
          `UPDATE reviews
           SET status = $1, decision = $2, comment = $3,
               decided_at = now(), reviewer_user_id = $4,
               occurred_at = COALESCE($7, now()),
               occurred_at_precision = $8,
               recorded_at = now(),
               backdating_reason = $9,
               is_override = $10
           WHERE org_id = $5 AND id = $6`,
          [
            nextStatus,
            dto.decision,
            dto.comment,
            ctx.userId,
            ctx.orgId,
            review.id,
            dto.occurredAt ? new Date(dto.occurredAt) : null,
            dto.occurredAtPrecision || 'INSTANT',
            dto.backdatingReason || null,
            false,
          ],
        );
      }

      // Record cryptographic audit event for review decision
      const auditEventId = uuidv7();
      const actionName = dto.decision === 'APPROVE' ? 'REVIEW_APPROVED' : (dto.decision === 'REQUEST_CHANGES' ? 'REVIEW_CHANGES_REQUESTED' : 'REVIEW_REJECTED');
      await client.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, ip, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
        [
          auditEventId,
          ctx.orgId,
          version.project_id || null,
          ctx.actorType,
          ctx.userId,
          actionName,
          'DOCUMENT_VERSION',
          version.id,
          JSON.stringify({ reviewStatus: version.review_status }),
          JSON.stringify({
            reviewStatus: dto.decision === 'APPROVE' ? 'APPROVED' : (dto.decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED'),
            comment: dto.comment,
          }),
          null,
          null,
          ctx.requestId || null,
        ],
      );

      return { status: 'OK', decision: dto.decision, versionId: version.id };
    };

    if (existingClient) {
      return run(existingClient);
    }
    return this.db.withTenantContext(ctx, run);
  }

  /**
   * API-106 POST /document-versions/:id/external-approval (WF-23, RT-022, CB-005)
   */
  async getExternalReviewOptions(ctx: ExecutionContext, projectId: string) {
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) throw new NotFoundException('PROJECT_NOT_FOUND');
    return this.db.withTenantContext(ctx, async (client) => {
      const { rows: projects } = await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projects.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      const { rows: authorities } = await client.query(
        `SELECT party.id, party.name, party.types
           FROM projects p JOIN parties party ON party.org_id = p.org_id
            AND party.id IN (p.client_party_id, p.mc_party_id, p.consultant_party_id)
          WHERE p.org_id = $1 AND p.id = $2 AND party.status = 'ACTIVE' AND party.deleted_at IS NULL
          ORDER BY party.name, party.id`,
        [ctx.orgId, projectId],
      );
      const { rows: proofVersions } = await client.query(
        `SELECT dv.id, dv.revision_code, dv.version_no, d.title
           FROM document_versions dv
           JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
           JOIN storage_objects so ON so.org_id = dv.org_id AND so.id = dv.object_id
          WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.file_status = 'READY'
            AND dv.deleted_at IS NULL AND d.deleted_at IS NULL
            AND so.status = 'READY' AND so.sha256 IS NOT NULL AND so.provider_version_id IS NOT NULL
            AND so.observed_size_bytes IS NOT NULL AND so.observed_size_bytes = so.size_bytes
          ORDER BY d.title, dv.version_no DESC, dv.id LIMIT 100`,
        [ctx.orgId, projectId],
      );
      return { authorities, proofVersions };
    });
  }

  async recordExternalApproval(ctx: ExecutionContext, versionId: string, dto: ExternalApprovalDto, expectedRowVersion: number) {
    if (!Number.isSafeInteger(expectedRowVersion) || expectedRowVersion < 1) {
      throw new HttpException({ code: 'IF_MATCH_REQUIRED', detail: 'Supply the current document version in If-Match.' }, 428);
    }
    if (!dto.externalApproverName?.trim() || !dto.externalApproverRole?.trim()) {
      throw new BadRequestException('EXTERNAL_AUTHORITY_REQUIRED');
    }
    if (!dto.externalPartyId) throw new BadRequestException('EXTERNAL_PARTY_REQUIRED');
    if (!dto.externalReference?.trim() || (!dto.proofVersionId && !dto.evidenceObjectId) || (dto.proofVersionId && dto.evidenceObjectId)) {
      throw new BadRequestException('EXTERNAL_REFERENCE_AND_PROOF_REQUIRED');
    }
    if (!dto.decidedAt || Number.isNaN(Date.parse(dto.decidedAt))) {
      throw new BadRequestException('VALID_EXTERNAL_RESPONSE_DATE_REQUIRED');
    }
    const externalDecisionDate = new Date(dto.decidedAt);
    if (externalDecisionDate.getTime() > Date.now()) {
      throw new BadRequestException('EXTERNAL_RESPONSE_DATE_IN_FUTURE');
    }
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : externalDecisionDate;
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) {
      throw new BadRequestException('INVALID_EXTERNAL_OCCURRED_AT');
    }
    if (occurredAt.getTime() < externalDecisionDate.getTime() &&
        (!dto.backdatingReason || dto.backdatingReason.trim().length < 10)) {
      throw new BadRequestException('BACKDATING_REASON_REQUIRED');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Lock document version FOR UPDATE
      const verRes = await client.query(
        `SELECT * FROM document_versions WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, versionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];
      if (version.row_version !== expectedRowVersion) {
        throw new HttpException({ code: 'VERSION_CHANGED', detail: 'Refresh the document version before recording a response.' }, 412);
      }

      const authorityRes = await client.query(
        `SELECT party.id
           FROM projects p
           JOIN parties party ON party.org_id = p.org_id AND party.id = $3
          WHERE p.org_id = $1 AND p.id = $2 AND party.status = 'ACTIVE'
            AND party.deleted_at IS NULL
            AND party.id IN (p.client_party_id, p.mc_party_id, p.consultant_party_id)
          LIMIT 1`,
        [ctx.orgId, version.project_id, dto.externalPartyId],
      );
      if (!authorityRes.rows.length) throw new ForbiddenException('EXTERNAL_PARTY_NOT_ASSIGNED_TO_PROJECT');

      const documentRes = await client.query(
        `SELECT id, latest_version_id, current_approved_version_id, doc_type_key, category_key
           FROM documents WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
        [ctx.orgId, version.project_id, version.document_id],
      );
      if (!documentRes.rows.length) throw new NotFoundException('DOCUMENT_NOT_FOUND');
      const doc = documentRes.rows[0];
      if (doc.latest_version_id && doc.latest_version_id !== version.id) {
        throw new ConflictException('EXTERNAL_APPROVAL_VERSION_NOT_LATEST');
      }
      if (version.uploaded_by === ctx.userId) {
        throw new ForbiddenException('SELF_APPROVAL_DENIED: uploader cannot record an external acceptance for own submittal');
      }

      const proofRes = await client.query(
        `SELECT so.id, proof.id AS proof_version_id
           FROM storage_objects so
           JOIN document_versions proof ON proof.org_id = so.org_id AND proof.object_id = so.id
           JOIN documents proof_document ON proof_document.org_id = proof.org_id
            AND proof_document.project_id = proof.project_id AND proof_document.id = proof.document_id
          WHERE so.org_id = $1 AND proof.project_id = $2
            AND (($3::uuid IS NOT NULL AND proof.id = $3) OR ($4::uuid IS NOT NULL AND so.id = $4))
            AND so.status = 'READY' AND proof.file_status = 'READY' AND proof.deleted_at IS NULL
            AND proof_document.deleted_at IS NULL
            AND so.sha256 IS NOT NULL AND so.provider_version_id IS NOT NULL
            AND so.observed_size_bytes IS NOT NULL AND so.observed_size_bytes = so.size_bytes
          LIMIT 2`,
        [ctx.orgId, version.project_id, dto.proofVersionId || null, dto.evidenceObjectId || null],
      );
      if (!proofRes.rows.length) {
        throw new UnprocessableEntityException('EXTERNAL_PROOF_NOT_VERIFIED_IN_PROJECT');
      }
      if (proofRes.rows.length > 1) throw new UnprocessableEntityException('EXTERNAL_PROOF_VERSION_AMBIGUOUS');

      // Security Invariant (TC2-003): External approval requires verified READY file_status
      if (version.file_status !== 'READY') {
        throw new ConflictException({
          code: 'FILE_NOT_READY',
          detail: `Cannot record external approval: file_status is ${version.file_status}. Only scanned and verified READY files can be approved.`,
        });
      }
      await this.assertVerifiedReviewEvidence(client, ctx.orgId, version);

      // 2. Lock parent document FOR UPDATE
      // Check certificate expiry (RT-009)
      if (version.expiry_date && isExpiredOnIndiaDate(version.expiry_date)) {
        throw new ConflictException('422 DOCUMENT_ALREADY_EXPIRED');
      }

      // Check companion evidence rules (Top 25 Item 6)
      {
        const companionEval = await this.evaluateCompanionEvidence(
          client,
          ctx.orgId,
          version.project_id,
          doc.doc_type_key || doc.category_key || 'DT-001',
          doc.id,
        );
        if (companionEval.hasMissingMandatory) {
          throw new UnprocessableEntityException({
            code: 'MISSING_COMPANION_EVIDENCE',
            title: 'Mandatory companion evidence missing',
            detail:
              'Cannot record external approval: required companion evidence is missing. Attach companion evidence or obtain an authorized override.',
            companions: companionEval.companions.filter((c: any) => c.status === 'MISSING' && c.isMandatory),
          });
        }
      }

      // Supersede prior approved version
      if (doc.current_approved_version_id && doc.current_approved_version_id !== version.id) {
        await client.query(
          `UPDATE document_versions
           SET review_status = 'SUPERSEDED', superseded_at = now()
           WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, doc.current_approved_version_id],
        );
      }

      // Mark version APPROVED (do not alter file_status; review is independent business state)
      await client.query(
        `UPDATE document_versions
         SET review_status = 'APPROVED', row_version = row_version + 1
         WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.id],
      );

      // Update documents.current_approved_version_id
      await client.query(
        `UPDATE documents
         SET current_approved_version_id = $1, latest_version_id = $1,
             row_version = row_version + 1, updated_at = now()
         WHERE org_id = $2 AND id = $3`,
        [version.id, ctx.orgId, doc.id],
      );

      // Insert reviews record strictly matching SQL schema (CB-005) with dual event time (Top 25 Item 4)
      const reviewId = uuidv7();
      await client.query(
        `INSERT INTO reviews (
          id, org_id, project_id, document_version_id, stage_key,
          reviewer_subject_type, reviewer_subject_id, reviewer_party_id, method, external_method,
          external_approver_name, external_approver_role, external_reference, evidence_object_id, external_proof_version_id,
          status, decision, comment, decided_at, on_behalf_of_user_id, is_override,
          occurred_at, occurred_at_precision, recorded_at, backdating_reason
        ) VALUES (
          $1, $2, $3, $4, 'EXTERNAL_APPROVAL',
          'PARTY', $5, $5, 'EXTERNAL', $6,
          $7, $8, $9, $10, $17,
          'APPROVED', 'APPROVE', $11, $12, $13, false,
          $14, $15, now(), $16
        )`,
        [
          reviewId,
          ctx.orgId,
          version.project_id,
          version.id,
          dto.externalPartyId,
          dto.externalMethod,
          dto.externalApproverName,
          dto.externalApproverRole,
          dto.externalReference,
          proofRes.rows[0].id,
          dto.comment || null,
          dto.decidedAt || new Date().toISOString(),
          ctx.userId,
          occurredAt,
          dto.occurredAtPrecision || 'INSTANT',
          dto.backdatingReason || null,
          proofRes.rows[0].proof_version_id,
        ],
      );

      return {
        reviewId,
        versionId,
        status: 'APPROVED',
        decision: 'APPROVE',
        proofVersionId: proofRes.rows[0].proof_version_id,
        externalMethod: dto.externalMethod,
        externalApproverName: dto.externalApproverName,
      };
    });
  }
}
