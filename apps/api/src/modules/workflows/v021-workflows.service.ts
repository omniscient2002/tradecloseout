import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';

@Injectable()
export class V021WorkflowsService {
  constructor(private readonly pool: Pool) {}

  /**
   * RT-009 & API-062: POST /api/v1/requirements/:id/submit-review
   * Blocks submission with 422 DOCUMENT_ALREADY_EXPIRED if expiry_date < CURRENT_DATE in IST.
   */
  async submitRequirementForReview(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    documentVersionId: string,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: verRows } = await client.query(
        `SELECT dv.id, dv.file_status, dv.review_status, dv.revision_code,
                dv.issue_date, dv.expiry_date,
                (dv.expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS is_already_expired
           FROM document_versions dv
          WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, documentVersionId],
      );

      if (verRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Document version not found.' });
      }
      const ver = verRows[0];

      if (ver.file_status !== 'READY') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: 'Document version must pass ClamAV and qpdf checks (READY) before review submission.',
        });
      }
      if (!ver.revision_code || !ver.issue_date) {
        throw new UnprocessableEntityException({
          code: 'METADATA_INCOMPLETE',
          detail: 'Add revision code and issue date before submitting (11 §4.6).',
        });
      }

      // RT-009: Reject already-expired document at submission time
      if (ver.is_already_expired) {
        throw new UnprocessableEntityException({
          code: 'DOCUMENT_ALREADY_EXPIRED',
          message: 'Document has already expired (RT-009).',
          title: 'Document has already expired',
          detail: 'The uploaded document expiry date is in the past. Upload a valid certificate (RT-009).',
        });
      }

      await client.query(
        `UPDATE document_versions
            SET review_status = 'IN_REVIEW', submitted_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, documentVersionId],
      );

      await client.query(
        `UPDATE requirements
            SET status = 'IN_REVIEW', row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId],
      );

      emit({
        eventType: 'DOCUMENT_SUBMITTED_FOR_REVIEW',
        projectId,
        entityType: 'REQUIREMENT',
        entityId: requirementId,
        afterJson: { documentVersionId, status: 'IN_REVIEW' },
      });

      return { requirementId, documentVersionId, status: 'IN_REVIEW' };
    });
  }

  /**
   * RT-023 Step 1 (API-061): POST /api/v1/requirements/:id/waivers
   * Optional requirements transition directly to WAIVED.
   * Mandatory requirements transition to PENDING_WAIVER until a 2nd approver countersigns.
   */
  async initiateWaiver(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    input: { type: 'WAIVE' | 'NOT_APPLICABLE'; reason: string; evidenceObjectId?: string },
  ) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'Waiver reason is required.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows } = await client.query(
        `SELECT id, mandatory, status FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, requirementId],
      );
      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Requirement not found.' });
      }
      const req = rows[0];

      if (!['NOT_STARTED', 'REQUESTED', 'CHANGES_REQUESTED'].includes(req.status)) {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: `Requirement in state ${req.status} cannot initiate a waiver (06 §3.6).`,
        });
      }

      const waiverId = uuidv7();
      const isMandatory = Boolean(req.mandatory);
      const waiverStatus = isMandatory ? 'PENDING_SECOND_APPROVAL' : 'ACTIVE';
      const nextReqStatus = isMandatory
        ? 'PENDING_WAIVER'
        : input.type === 'WAIVE'
        ? 'WAIVED'
        : 'NOT_APPLICABLE';

      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason, evidence_object_id, requested_by, approved_by, is_mandatory_item, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          waiverId,
          ctx.orgId,
          projectId,
          requirementId,
          input.type,
          input.reason.trim(),
          input.evidenceObjectId ?? null,
          ctx.userId,
          ctx.userId,
          isMandatory,
          waiverStatus,
        ],
      );

      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId, nextReqStatus],
      );

      emit({
        eventType: isMandatory ? 'WAIVER_INITIATED_PENDING_COUNTERSIGN' : 'WAIVER_APPROVED',
        projectId,
        entityType: 'REQUIREMENT',
        entityId: requirementId,
        beforeJson: { status: req.status },
        afterJson: { waiverId, status: nextReqStatus },
      });

      return { waiverId, requirementId, status: nextReqStatus };
    });
  }

  /**
   * RT-023 Step 2 (API-061A): POST /api/v1/waivers/:waiverId/countersign
   * Second approver (Owner/Admin != initiator) countersigns or rejects a PENDING_WAIVER.
   */
  async countersignMandatoryWaiver(
    ctx: TenantActorContext,
    projectId: string,
    waiverId: string,
    decision: 'APPROVE' | 'REJECT',
    comment?: string,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: memberRows } = await client.query(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
        [ctx.orgId, ctx.userId],
      );
      if (!memberRows[0] || !['R-OWNER', 'R-ADMIN'].includes(memberRows[0].role)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'FORBIDDEN: Only an active Owner or Admin can countersign a mandatory requirement waiver.',
          detail: 'Only an active Owner or Admin can countersign a mandatory requirement waiver.',
        });
      }

      const { rows: wRows } = await client.query(
        `SELECT id, requirement_id, type, approved_by, status
           FROM waivers
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, waiverId],
      );
      if (wRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Waiver not found.' });
      }
      const waiver = wRows[0];

      if (waiver.status !== 'PENDING_SECOND_APPROVAL') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: 'Waiver is not awaiting a second approval.',
        });
      }
      if (waiver.approved_by === ctx.userId) {
        throw new ForbiddenException({
          code: 'SELF_COUNTERSIGN_DENIED',
          message: 'SELF_COUNTERSIGN_DENIED: The second approver must be a different person from the waiver initiator (RT-023).',
          detail: 'The second approver must be a different person from the waiver initiator (RT-023).',
        });
      }

      const nextWaiverStatus = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
      const nextReqStatus =
        decision === 'APPROVE'
          ? waiver.type === 'WAIVE'
            ? 'WAIVED'
            : 'NOT_APPLICABLE'
          : 'NOT_STARTED'; // RT-023: Rejection returns PENDING_WAIVER -> NOT_STARTED

      await client.query(
        `UPDATE waivers
            SET status = $4, second_approved_by = $5, second_approved_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, waiverId, nextWaiverStatus, ctx.userId],
      );

      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, waiver.requirement_id, nextReqStatus],
      );

      emit({
        eventType: `MANDATORY_WAIVER_${decision}D`,
        projectId,
        entityType: 'REQUIREMENT',
        entityId: waiver.requirement_id,
        beforeJson: { status: 'PENDING_WAIVER' },
        afterJson: { status: nextReqStatus, secondApprovedBy: ctx.userId, comment },
      });

      return { waiverId, requirementId: waiver.requirement_id, status: nextReqStatus };
    });
  }

  /**
   * RT-022 & WF-23 (API-106): POST /api/v1/document-versions/:versionId/external-approval
   * Records an external approval directly against a READY document_version without needing a pre-existing review row.
   */
  async recordExternalApprovalOnVersion(
    ctx: TenantActorContext,
    projectId: string,
    versionId: string,
    input: {
      approverName: string;
      approverRoleOrg: string;
      decisionDate: string;
      externalMethod: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL';
      reference: string;
      evidenceObjectId?: string;
    },
  ) {
    if (
      (input.externalMethod === 'STAMPED_PDF' || input.externalMethod === 'EMAIL') &&
      !input.evidenceObjectId
    ) {
      throw new UnprocessableEntityException({
        code: 'EVIDENCE_REQUIRED',
        detail: 'Evidence file upload is required for Stamped PDF and Email external approvals (WF-23).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows } = await client.query(
        `SELECT dv.id, dv.document_id, dv.file_status, dv.uploaded_by, dv.object_id,
                d.current_approved_version_id,
                r.id AS requirement_id
           FROM document_versions dv
           JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
           JOIN document_requirements dr ON dr.org_id = d.org_id AND dr.project_id = d.project_id AND dr.document_id = d.id
           JOIN requirements r ON r.org_id = dr.org_id AND r.project_id = dr.project_id AND r.id = dr.requirement_id
          WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.id = $3
          FOR UPDATE OF d, dv, r`,
        [ctx.orgId, projectId, versionId],
      );
      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Document version not found.' });
      }
      const ver = rows[0];

      if (ver.uploaded_by === ctx.userId) {
        throw new ForbiddenException({
          code: 'SELF_APPROVAL_DENIED',
          message: 'SELF_APPROVAL_DENIED: Uploaders cannot record approvals for their own uploaded document version (FR-REV-009).',
          detail: 'Uploaders cannot record approvals for their own uploaded document version (FR-REV-009).',
        });
      }

      if (ver.file_status !== 'READY') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: 'Document version must be READY before recording an external approval.',
        });
      }

      const { rows: storageRows } = await client.query(
        `SELECT 1 FROM storage_objects
          WHERE org_id = $1 AND id = $2 AND status = 'READY'
            AND sha256 IS NOT NULL AND provider_version_id IS NOT NULL
            AND observed_size_bytes = size_bytes
          LIMIT 1`,
        [ctx.orgId, ver.object_id],
      );
      if (!storageRows.length) {
        throw new ConflictException({
          code: 'EVIDENCE_OBJECT_NOT_VERIFIED',
          detail: 'The evidence version has no verified immutable storage object.',
        });
      }

      if (ver.current_approved_version_id) {
        await client.query(
          `UPDATE document_versions
              SET review_status = 'SUPERSEDED', superseded_at = now(), row_version = row_version + 1
            WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, ver.current_approved_version_id],
        );
      }

      const reviewId = uuidv7();
      await client.query(
        `INSERT INTO reviews
          (id, org_id, project_id, document_version_id, stage_key,
           reviewer_subject_type, reviewer_subject_id, reviewer_user_id,
           method, external_method, external_approver_name, external_reference,
           evidence_object_id, status, decision, decided_at)
         VALUES ($1, $2, $3, $4, 'DEFAULT', 'USER', $5, $5,
                 'EXTERNAL', $6, $7, $8, $9, 'APPROVED', 'APPROVE', $10::timestamptz)`,
        [
          reviewId,
          ctx.orgId,
          projectId,
          versionId,
          ctx.userId,
          input.externalMethod,
          `${input.approverName} (${input.approverRoleOrg})`,
          input.reference,
          input.evidenceObjectId ?? null,
          input.decisionDate,
        ],
      );

      await client.query(
        `UPDATE document_versions
            SET review_status = 'APPROVED', row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, versionId],
      );

      await client.query(
        `UPDATE documents
            SET current_approved_version_id = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, ver.document_id, versionId],
      );

      emit({
        eventType: 'EXTERNAL_APPROVAL_RECORDED',
        projectId,
        entityType: 'DOCUMENT_VERSION',
        entityId: versionId,
        afterJson: {
          reviewId,
          requirementId: ver.requirement_id,
          externalMethod: input.externalMethod,
          reference: input.reference,
        },
      });

      return { reviewId, versionId, requirementId: ver.requirement_id, status: 'APPROVED' };
    });
  }

  /**
   * RT-007 & RT-024 (API-117): Deterministic Multi-Recipient Decision Aggregation
   * Aggregates recipient decisions into ACCEPTED | PARTIALLY_ACCEPTED | REJECTED,
   * and reverts HANDED_OVER requirements back to APPROVED/WAIVED if rejected or withdrawn (RT-024).
   */
  async recordRecipientDecisionAndAggregate(
    ctx: TenantActorContext,
    projectId: string,
    submissionId: string,
    recipientId: string,
    input: {
      decision: 'ACCEPTED' | 'REJECTED';
      remarks?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: subRows } = await client.query(
        `SELECT id, package_id, status FROM submissions
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, submissionId],
      );
      if (subRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Submission not found.' });
      }
      const submission = subRows[0];

      await client.query(
        `UPDATE submission_recipients
            SET status = $5, decision = $5, remarks = $6, decided_at = now()
          WHERE org_id = $1 AND project_id = $2 AND submission_id = $3 AND id = $4`,
        [ctx.orgId, projectId, submissionId, recipientId, input.decision, input.remarks ?? null],
      );

      // Load all recipients for this submission to evaluate RT-007 aggregation rules
      const { rows: allRecipients } = await client.query(
        `SELECT id, is_required_approver, decision
           FROM submission_recipients
          WHERE org_id = $1 AND project_id = $2 AND submission_id = $3`,
        [ctx.orgId, projectId, submissionId],
      );

      const requiredApprovers = allRecipients.filter((r) => r.is_required_approver);
      const anyRequiredRejected = requiredApprovers.some((r) => r.decision === 'REJECTED');
      const allRequiredAccepted =
        requiredApprovers.length > 0 &&
        requiredApprovers.every((r) => r.decision === 'ACCEPTED');
      const anyAccepted = allRecipients.some((r) => r.decision === 'ACCEPTED');

      let aggregateStatus: 'REJECTED' | 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'SENT' = 'SENT';
      if (anyRequiredRejected) {
        aggregateStatus = 'REJECTED';
      } else if (allRequiredAccepted) {
        aggregateStatus = 'ACCEPTED';
      } else if (anyAccepted) {
        aggregateStatus = 'PARTIALLY_ACCEPTED';
      }

      await client.query(
        `UPDATE submissions
            SET status = $4,
                decided_at = CASE WHEN $4 IN ('ACCEPTED','REJECTED') THEN now() ELSE decided_at END,
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, submissionId, aggregateStatus],
      );

      if (submission.package_id) {
        await client.query(
          `UPDATE handover_packages
              SET status = $4, row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND project_id = $2 AND id = $3`,
          [ctx.orgId, projectId, submission.package_id, aggregateStatus],
        );

      }

      emit({
        eventType: `SUBMISSION_AGGREGATED_${aggregateStatus}`,
        projectId,
        entityType: 'SUBMISSION',
        entityId: submissionId,
        afterJson: { recipientId, recipientDecision: input.decision, aggregateStatus },
      });

      return { submissionId, aggregateStatus };
    });
  }
}
