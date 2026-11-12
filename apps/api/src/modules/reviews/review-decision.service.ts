import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PoolClient } from 'pg';

export interface SessionContext {
  userId: string;
  activeOrgId: string; // Sole authoritative tenant ID (AUD-014)
  orgRole: string;
  projectRoles: string[];
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface ReviewDecisionInput {
  projectId: string;
  documentVersionId: string;
  expectedRowVersion: number; // If-Match concurrency header
  method: 'IN_APP' | 'EXTERNAL';
  decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  comment?: string;
  external?: {
    approverName: string;
    approverRoleOrg: string;
    decisionDate: string; // YYYY-MM-DD <= today
    externalMethod: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL';
    reference: string;
    evidenceObjectId?: string;
  };
}

export async function executeReviewDecision(
  client: PoolClient,
  ctx: SessionContext,
  input: ReviewDecisionInput,
) {
  await client.query('BEGIN');
  try {
    // 1. Bind transaction-local RLS context (08 §5.2)
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [ctx.activeOrgId]);
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [ctx.activeOrgId]);
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [ctx.userId]);

    // 2. Load version + lock parent document row FOR UPDATE (AUD-007 race guard)
    const { rows: versionRows } = await client.query(
      `SELECT dv.id, dv.document_id, dv.version_no, dv.file_status, dv.review_status,
              dv.uploaded_by, dv.row_version, d.current_approved_version_id,
              r.id AS requirement_id, r.reviewer_role, r.status AS req_status
         FROM document_versions dv
         JOIN documents d
           ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
         JOIN document_requirements dr
           ON dr.org_id = d.org_id AND dr.project_id = d.project_id AND dr.document_id = d.id
         JOIN requirements r
           ON r.org_id = dr.org_id AND r.project_id = dr.project_id AND r.id = dr.requirement_id
        WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.id = $3
        FOR UPDATE OF d, dv, r`,
      [ctx.activeOrgId, input.projectId, input.documentVersionId],
    );

    if (versionRows.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Document version not found in scope.' });
    }
    const row = versionRows[0];

    // 3. Optimistic concurrency check (10 §1 If-Match)
    if (row.row_version !== input.expectedRowVersion) {
      throw new ConflictException({ code: 'PRECONDITION_FAILED', detail: 'Version changed concurrently.' });
    }

    // 4. File state & latest-submission race check (06 §3.7 & §3.8 AUD-007)
    if (row.file_status !== 'READY') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        detail: 'Cannot review a file that has not passed ClamAV and PDF verification.',
      });
    }
    // Legacy/internal execution helper must not offer an EXTERNAL escape
    // hatch around the version's shared one-terminal-outcome invariant.
    if (row.review_status !== 'IN_REVIEW') {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        detail: `Version is ${row.review_status}, expected IN_REVIEW.`,
      });
    }

    const { rows: newerRows } = await client.query(
      `SELECT id FROM document_versions
        WHERE org_id = $1 AND project_id = $2 AND document_id = $3
          AND version_no > $4 AND deleted_at IS NULL`,
      [ctx.activeOrgId, input.projectId, row.document_id, row.version_no],
    );
    if (newerRows.length > 0) {
      throw new ConflictException({
        code: 'INVALID_STATE_TRANSITION',
        detail: 'Version has been superseded by a newer submission (AUD-007).',
      });
    }

    if (row.current_approved_version_id === input.documentVersionId) {
      throw new ConflictException({
        code: 'DOCUMENT_VERSION_ALREADY_APPROVED_POINTER',
        detail: 'A version referenced by the approval pointer cannot be re-decided.',
      });
    }

    // 5. Reviewer role match (FR-REV-002 / AUD-005) & Self-Approval Guard (FR-REV-009)
    const userRoles = new Set([ctx.orgRole, ...ctx.projectRoles]);
    const isOwnerOrAdmin = userRoles.has('R-OWNER') || userRoles.has('R-ADMIN');
    for (const vRow of versionRows) {
      if (vRow.reviewer_role && !userRoles.has(vRow.reviewer_role) && !isOwnerOrAdmin) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          detail: `Requirement requires reviewer role ${vRow.reviewer_role}.`,
        });
      }
    }
    if (row.uploaded_by === ctx.userId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL_DENIED',
        message: 'SELF_APPROVAL_DENIED: Uploaders cannot approve their own uploaded document version (FR-REV-009).',
        detail: 'Uploaders cannot approve their own uploaded document version (FR-REV-009).',
      });
    }

    // 6. Validate comments & external approval evidence (11 §4.9 & WF-23)
    if (input.decision !== 'APPROVE' && (!input.comment || input.comment.trim().length < 10)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'Comment of at least 10 characters is required when requesting changes or rejecting.',
      });
    }
    if (input.method === 'EXTERNAL') {
      const ext = input.external;
      if (!ext || !ext.approverName || !ext.decisionDate || !ext.externalMethod) {
        throw new UnprocessableEntityException({
          code: 'METADATA_INCOMPLETE',
          detail: 'External approval requires approverName, decisionDate, and externalMethod.',
        });
      }
      if (
        (ext.externalMethod === 'STAMPED_PDF' || ext.externalMethod === 'EMAIL') &&
        !ext.evidenceObjectId
      ) {
        throw new UnprocessableEntityException({
          code: 'METADATA_INCOMPLETE',
          detail: 'Evidence file upload is mandatory for Stamped PDF and Email external approvals.',
        });
      }
    }

    // 7. Apply state transitions atomically
    const nextVersionStatus =
      input.decision === 'APPROVE'
        ? 'APPROVED'
        : input.decision === 'REQUEST_CHANGES'
        ? 'CHANGES_REQUESTED'
        : 'REJECTED';

    if (nextVersionStatus === 'APPROVED' && row.current_approved_version_id) {
      await client.query(
        `UPDATE document_versions
            SET review_status = 'SUPERSEDED', superseded_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.activeOrgId, input.projectId, row.current_approved_version_id],
      );
    }

    await client.query(
      `UPDATE document_versions
          SET review_status = $4, row_version = row_version + 1, updated_at = now()
        WHERE org_id = $1 AND project_id = $2 AND id = $3`,
      [ctx.activeOrgId, input.projectId, input.documentVersionId, nextVersionStatus],
    );

    if (nextVersionStatus === 'APPROVED') {
      await client.query(
        `UPDATE documents
            SET current_approved_version_id = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.activeOrgId, input.projectId, row.document_id, input.documentVersionId],
      );
    }

    await client.query('COMMIT');
    return {
      documentVersionId: input.documentVersionId,
      documentVersionStatus: nextVersionStatus,
      method: input.method,
      rowVersion: row.row_version + 1,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
