// apps/api/src/modules/reviews/reviews.service.ts
// Atomic review approval and external approval recording (AUD-007, RT-009, RT-022, CB-005, CB-012)

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

@Injectable()
export class ReviewsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-102 POST /reviews/:id/decisions (AUD-007, CB-005, CB-012)
   */
  async decideReview(ctx: ExecutionContext, reviewId: string, dto: DecisionDto) {
    if ((dto.decision === 'REQUEST_CHANGES' || dto.decision === 'REJECT') && (!dto.comment || dto.comment.trim().length < 5)) {
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

      // 2. Lock document_version FOR UPDATE via document_version_id (CB-005)
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
          `UPDATE reviews SET status = $1, decision = $2, comment = $3, decided_at = now(), reviewer_user_id = $4 WHERE org_id = $5 AND id = $6`,
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

      return { status: 'OK', reviewId, approvedVersionId: version.id };
    });
  }
}
