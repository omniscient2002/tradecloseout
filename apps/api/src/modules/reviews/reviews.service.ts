// apps/api/src/modules/reviews/reviews.service.ts
// Atomic review approval and external approval recording (AUD-007, RT-009, RT-022)

import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
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
  decidedAt: string;
  evidenceObjectId?: string;
  comment?: string;
  isOverride?: boolean;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-102 POST /reviews/:id/decisions (AUD-007)
   */
  async decideReview(ctx: ExecutionContext, reviewId: string, dto: DecisionDto) {
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
      if (review.status !== 'IN_REVIEW') {
        throw new ConflictException('INVALID_STATE_TRANSITION: Review is not in review');
      }

      // 2. Lock parent document FOR UPDATE to prevent approval race (AUD-007)
      const docRes = await client.query(
        `SELECT * FROM documents WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, review.document_id],
      );
      const doc = docRes.rows[0];

      // 3. Lock document_version FOR UPDATE
      const verRes = await client.query(
        `SELECT * FROM document_versions WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, review.document_version_id],
      );
      const version = verRes.rows[0];

      // 4. Verify version is latest submitted
      if (doc.latest_version_id !== version.id || version.review_status !== 'IN_REVIEW') {
        throw new ConflictException('INVALID_STATE_TRANSITION: Superseded by a newer submission');
      }

      // 5. Self-approval prohibition (FR-REV-009)
      if (version.uploaded_by === ctx.userId && !dto.isOverride) {
        throw new ForbiddenException('SELF_APPROVAL_DENIED');
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
             WHERE id = $1`,
            [doc.current_approved_version_id],
          );
        }

        // Mark this version APPROVED
        await client.query(
          `UPDATE document_versions
           SET review_status = 'APPROVED', row_version = row_version + 1
           WHERE id = $1`,
          [version.id],
        );

        // Update documents.current_approved_version_id
        await client.query(
          `UPDATE documents
           SET current_approved_version_id = $1, row_version = row_version + 1, updated_at = now()
           WHERE id = $2`,
          [version.id, doc.id],
        );

        // Update review record
        await client.query(
          `UPDATE reviews
           SET status = 'APPROVED', decision = 'APPROVE', comment = $1, decided_at = now()
           WHERE id = $2`,
          [dto.comment, review.id],
        );

        // Satisfy linked requirements
        await client.query(
          `UPDATE requirements
           SET status = 'APPROVED', updated_at = now(), row_version = row_version + 1
           WHERE id IN (SELECT requirement_id FROM document_requirements WHERE document_id = $1)`,
          [doc.id],
        );
      } else {
        const nextStatus = dto.decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
        await client.query(
          `UPDATE document_versions SET review_status = $1 WHERE id = $2`,
          [nextStatus, version.id],
        );
        await client.query(
          `UPDATE reviews SET status = $1, decision = $2, comment = $3, decided_at = now() WHERE id = $4`,
          [nextStatus, dto.decision, dto.comment, review.id],
        );
        await client.query(
          `UPDATE requirements
           SET status = $1, updated_at = now(), row_version = row_version + 1
           WHERE id IN (SELECT requirement_id FROM document_requirements WHERE document_id = $2)`,
          [nextStatus, doc.id],
        );
      }

      return { status: 'OK', decision: dto.decision };
    });
  }

  /**
   * API-106 POST /document-versions/:id/external-approval (WF-23, RT-022)
   */
  async recordExternalApproval(ctx: ExecutionContext, versionId: string, dto: ExternalApprovalDto) {
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

      // Lock parent document FOR UPDATE
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
           WHERE id = $1`,
          [doc.current_approved_version_id],
        );
      }

      // Mark version APPROVED
      await client.query(
        `UPDATE document_versions
         SET review_status = 'APPROVED', row_version = row_version + 1
         WHERE id = $1`,
        [version.id],
      );

      // Update documents.current_approved_version_id
      await client.query(
        `UPDATE documents
         SET current_approved_version_id = $1, row_version = row_version + 1, updated_at = now()
         WHERE id = $2`,
        [version.id, doc.id],
      );

      // Insert reviews record with method = 'EXTERNAL'
      const reviewId = uuidv7();
      await client.query(
        `INSERT INTO reviews (
          id, org_id, project_id, document_id, document_version_id, stage_key,
          reviewer_subject_type, reviewer_subject_id, method, external_method,
          external_reference, evidence_object_id, status, decision, comment,
          decided_at, on_behalf_of_user_id, is_override
        ) VALUES (
          $1, $2, $3, $4, $5, 'EXTERNAL_APPROVAL',
          'PARTY', $6, 'EXTERNAL', $7,
          $8, $9, 'APPROVED', 'APPROVE', $10,
          $11, $12, $13
        )`,
        [
          reviewId, ctx.orgId, version.project_id, doc.id, version.id,
          uuidv7(), dto.externalMethod,
          dto.externalReference || null, dto.evidenceObjectId || null, dto.comment || null,
          dto.decidedAt || new Date().toISOString(), ctx.userId, dto.isOverride || false,
        ],
      );

      // Satisfy linked requirements
      await client.query(
        `UPDATE requirements
         SET status = 'APPROVED', updated_at = now(), row_version = row_version + 1
         WHERE id IN (SELECT requirement_id FROM document_requirements WHERE document_id = $1)`,
        [doc.id],
      );

      return { status: 'OK', reviewId, approvedVersionId: version.id };
    });
  }
}
