// apps/api/src/modules/reviews/reviews.service.ts
// Atomic review queue, row-locked approvals, comments & external approvals (AUD-005, AUD-007, RT-009, RT-022, FR-REV-001..017)

import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';

export interface DecisionDto {
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  comment?: string;
  isOverride?: boolean;
}

export interface ExternalApprovalDto {
  decision: 'APPROVE';
  externalMethod: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL';
  externalApproverName: string;
  externalApproverRole?: string;
  externalReference?: string;
  decidedAt?: string;
  evidenceObjectId?: string;
  comment?: string;
  isOverride?: boolean;
}

export interface ReviewCommentDto {
  pageNo?: number;
  x?: number;
  y?: number;
  comment: string;
  visibility?: 'PUBLIC' | 'INTERNAL';
}

@Injectable()
export class ReviewsService {
  constructor(private readonly db: TenantDbService) {}

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
        `SELECT dv.*, d.id AS doc_id FROM document_versions dv
           JOIN documents d ON d.id = dv.document_id
          WHERE dv.org_id = $1 AND dv.id = $2`,
        [ctx.orgId, dto.documentVersionId],
      );
      if (!verRes.rows.length) {
        throw new NotFoundException('DOCUMENT_VERSION_NOT_FOUND');
      }
      const version = verRes.rows[0];

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
          'ROLE', $5, 'IN_APP', 'IN_REVIEW', now()
        ) RETURNING *`,
        [reviewId, ctx.orgId, req.project_id, version.id, uuidv7()],
      );

      // Transition version and requirement status
      await client.query(
        `UPDATE document_versions SET review_status = 'IN_REVIEW', updated_at = now() WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, version.id],
      );
      await client.query(
        `UPDATE requirements SET status = 'UNDER_REVIEW', updated_at = now() WHERE org_id = $1 AND id = $2`,
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

      // Fetch comments
      const commentsRes = await client.query(
        `SELECT rc.*, u.name AS author_name
           FROM review_comments rc
           LEFT JOIN users u ON u.id = rc.user_id
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
    if (!dto.comment || dto.comment.trim().length === 0) {
      throw new BadRequestException('Comment text cannot be empty');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const reviewRes = await client.query(
        `SELECT id FROM reviews WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, reviewId],
      );
      if (!reviewRes.rows.length) {
        throw new NotFoundException('REVIEW_NOT_FOUND');
      }

      const commentId = uuidv7();
      const visibility = dto.visibility || 'PUBLIC';

      const res = await client.query(
        `INSERT INTO review_comments (
          id, org_id, review_id, user_id, page_no, x, y, comment, visibility, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        RETURNING *`,
        [
          commentId,
          ctx.orgId,
          reviewId,
          ctx.userId,
          dto.pageNo || null,
          dto.x || null,
          dto.y || null,
          dto.comment,
          visibility,
        ],
      );

      return res.rows[0];
    });
  }

  /**
   * API-105 POST /reviews/:id/override
   * Admin or Owner override of a review decision with justification.
   */
  async overrideReview(
    ctx: ExecutionContext,
    reviewId: string,
    dto: { justification: string; decision: 'APPROVE' | 'REJECT' },
  ) {
    if (!dto.justification || dto.justification.trim().length < 10) {
      throw new BadRequestException('JUSTIFICATION_REQUIRED: Minimum 10 characters required for admin override');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const overrideId = uuidv7();
      await client.query(
        `INSERT INTO approval_overrides (id, org_id, review_id, overridden_by, justification, previous_status, new_status)
         VALUES ($1, $2, $3, $4, $5, 'IN_REVIEW', $6)`,
        [overrideId, ctx.orgId, reviewId, ctx.userId, dto.justification, dto.decision],
      );

      return this.decideReview(ctx, reviewId, {
        decision: dto.decision,
        comment: `[ADMIN OVERRIDE]: ${dto.justification}`,
        isOverride: true,
      });
    });
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

  /**
   * API-102 POST /reviews/:id/decisions (AUD-007, CB-005, CB-012, FR-REV-009, AUD-005)
   */
  async decideReview(ctx: ExecutionContext, reviewId: string, dto: DecisionDto) {
    if (
      (dto.decision === 'REQUEST_CHANGES' || dto.decision === 'REJECT') &&
      (!dto.comment || dto.comment.trim().length < 5)
    ) {
      throw new BadRequestException('COMMENT_REQUIRED: Minimum 5 characters required for rejection or change requests');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Fetch review record
      const reviewRes = await client.query(
        `SELECT * FROM reviews WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, reviewId],
      );
      if (!reviewRes.rows.length) {
        throw new NotFoundException('REVIEW_NOT_FOUND');
      }
      const review = reviewRes.rows[0];
      if (review.status !== 'IN_REVIEW' && review.status !== 'PENDING') {
        throw new ConflictException(`INVALID_STATE_TRANSITION: Review is already in status ${review.status}`);
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
      if (version.uploaded_by === ctx.userId && !dto.isOverride) {
        throw new ForbiddenException('SELF_APPROVAL_DENIED: Uploader cannot approve own submittal');
      }

      if (dto.decision === 'APPROVE') {
        // Check certificate expiry (RT-009)
        if (version.expiry_date && new Date(version.expiry_date) < new Date()) {
          throw new ConflictException('422 DOCUMENT_ALREADY_EXPIRED');
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

        // Mark this version APPROVED
        await client.query(
          `UPDATE document_versions
           SET review_status = 'APPROVED', file_status = 'READY', row_version = row_version + 1
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

        // Update review record
        await client.query(
          `UPDATE reviews
           SET status = 'APPROVED', decision = 'APPROVE', comment = $1,
               decided_at = now(), reviewer_user_id = $2
           WHERE org_id = $3 AND id = $4`,
          [dto.comment || null, ctx.userId, ctx.orgId, review.id],
        );

        // Satisfy linked requirements
        await client.query(
          `UPDATE requirements
           SET status = 'APPROVED', updated_at = now(), row_version = row_version + 1
           WHERE org_id = $1 AND id IN (
             SELECT requirement_id FROM document_requirements WHERE org_id = $1 AND document_id = $2
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
               decided_at = now(), reviewer_user_id = $4
           WHERE org_id = $5 AND id = $6`,
          [nextStatus, dto.decision, dto.comment, ctx.userId, ctx.orgId, review.id],
        );
        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE org_id = $2 AND id IN (
             SELECT requirement_id FROM document_requirements WHERE org_id = $2 AND document_id = $3
           )`,
          [nextStatus, ctx.orgId, doc.id],
        );
      }

      return { status: 'OK', decision: dto.decision, versionId: version.id };
    });
  }

  /**
   * API-106 POST /document-versions/:id/external-approval (WF-23, RT-022, CB-005)
   */
  async recordExternalApproval(ctx: ExecutionContext, versionId: string, dto: ExternalApprovalDto) {
    if (!dto.externalApproverName || dto.externalApproverName.trim().length === 0) {
      throw new BadRequestException('EXTERNAL_APPROVER_NAME_REQUIRED');
    }

    if (['STAMPED_PDF', 'EMAIL'].includes(dto.externalMethod) && !dto.evidenceObjectId) {
      throw new BadRequestException('EVIDENCE_OBJECT_REQUIRED: Stamped PDF and Email approvals require evidence upload');
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

      // 2. Lock parent document FOR UPDATE
      const docRes = await client.query(
        `SELECT * FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, version.document_id],
      );
      const doc = docRes.rows[0];

      // Check certificate expiry (RT-009)
      if (version.expiry_date && new Date(version.expiry_date) < new Date()) {
        throw new ConflictException('422 DOCUMENT_ALREADY_EXPIRED');
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

      // Mark version APPROVED
      await client.query(
        `UPDATE document_versions
         SET review_status = 'APPROVED', file_status = 'READY', row_version = row_version + 1
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

      // Insert reviews record strictly matching SQL schema (CB-005)
      const reviewId = uuidv7();
      await client.query(
        `INSERT INTO reviews (
          id, org_id, project_id, document_version_id, stage_key,
          reviewer_subject_type, reviewer_subject_id, method, external_method,
          external_approver_name, external_reference, evidence_object_id,
          status, decision, comment, decided_at, on_behalf_of_user_id, is_override
        ) VALUES (
          $1, $2, $3, $4, 'EXTERNAL_APPROVAL',
          'PARTY', $5, 'EXTERNAL', $6,
          $7, $8, $9,
          'APPROVED', 'APPROVE', $10, $11, $12, $13
        )`,
        [
          reviewId,
          ctx.orgId,
          version.project_id,
          version.id,
          uuidv7(), // reviewer_subject_id placeholder for external authority
          dto.externalMethod,
          dto.externalApproverName,
          dto.externalReference || null,
          dto.evidenceObjectId || null,
          dto.comment || null,
          dto.decidedAt || new Date().toISOString(),
          ctx.userId,
          dto.isOverride || false,
        ],
      );

      // Satisfy linked requirements
      await client.query(
        `UPDATE requirements
         SET status = 'APPROVED', updated_at = now(), row_version = row_version + 1
         WHERE org_id = $1 AND id IN (
           SELECT requirement_id FROM document_requirements WHERE org_id = $1 AND document_id = $2
         )`,
        [ctx.orgId, doc.id],
      );

      return {
        reviewId,
        versionId,
        status: 'APPROVED',
        decision: 'APPROVE',
        externalMethod: dto.externalMethod,
        externalApproverName: dto.externalApproverName,
      };
    });
  }
}
