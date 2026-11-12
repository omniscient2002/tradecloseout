import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
  GoneException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { createHash } from 'crypto';
import { withTenantTransaction, consumePlanQuota, TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { S3StorageService } from '../documents/s3-storage.service';
import { canonicalJson, isImmutableStorageVersion } from '@tradecloseout/shared';
import { evaluateReadinessInTransaction } from './closeout-readiness';

@Injectable()
export class HandoverService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: S3StorageService,
  ) {}

  /**
   * API-118: GET /api/v1/projects/:id/readiness
   * Evaluates mandatory requirements, separating MISSING and EXPIRED blockers from EXPIRING warnings (FR-HND-008).
   */
  async evaluateProjectReadiness(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, (client) =>
      evaluateReadinessInTransaction(client, ctx.orgId, projectId));
  }

  /**
   * API-110: POST /api/v1/projects/:id/packages
   * Snapshots package_items and package_requirements with snapshot_checksum (AUD-008, FR-HND-021)
   * and enqueues the Pure-Node PDF compiler worker job (WF-16).
   */
  async requestHandoverPackageGeneration(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      excludedRequirementIds?: Array<{ requirementId: string; reason: string }>;
    },
  ) {
    // Exclusions are not applied to the immutable manifest in this release.
    // Silently ignoring them can disclose evidence the requester intended to omit.
    if (input?.excludedRequirementIds?.length) {
      throw new UnprocessableEntityException({
        code: 'PACKAGE_EXCLUSIONS_NOT_SUPPORTED',
        detail: 'Partial-package exclusions are not supported. No evidence has been excluded or exported.',
      });
    }
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Project closure and handover generation share this row lock.
      // Canonical readiness and source selection use one REPEATABLE READ snapshot.
      const { rows: projects } = await client.query(
        `SELECT id, status FROM projects
           WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projects.length) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
      }
      if (!['ACTIVE', 'HANDOVER'].includes(projects[0].status)) {
        throw new ConflictException({
          code: 'PACKAGE_PROJECT_LIFECYCLE_BLOCKED',
          detail: 'Final handover generation requires an active or handover project.',
        });
      }
      const readiness = await evaluateReadinessInTransaction(client, ctx.orgId, projectId);
      if (!readiness.readyWithoutOverride) {
        throw new UnprocessableEntityException({
          code: 'READINESS_BLOCKERS_PRESENT',
          title: 'Mandatory requirements are missing or expired',
          detail: 'Resolve blockers or record an authorised waiver/not-applicable decision before requesting a final handover package.',
          configurationBlocker: readiness.configurationBlocker,
          missingMandatoryCount: readiness.blockers.missingMandatoryCount,
          expiredMandatoryCount: readiness.blockers.expiredMandatoryCount,
        });
      }

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      await consumePlanQuota(client, ctx.orgId, 'PACKAGE_GENERATIONS', currentMonth, 1n, 50n);

      const { rows: snapRows } = await client.query(
        `SELECT id, checksum FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
          ORDER BY created_at DESC, id DESC
          LIMIT 2`,
        [ctx.orgId, projectId],
      );
      if (snapRows.length !== 1) {
        throw new UnprocessableEntityException({
          code: snapRows.length ? 'MULTIPLE_ACTIVE_SNAPSHOTS' : 'NO_ACTIVE_SNAPSHOT',
          detail: 'Exactly one active checklist snapshot is required for final handover.',
        });
      }
      const activeSnapshot = snapRows[0];

      const { rows: verMax } = await client.query(
        `SELECT COALESCE(MAX(version_no), 0)::int AS max_ver
           FROM handover_packages
          WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const nextVersionNo = verMax[0].max_ver + 1;
      const packageId = uuidv7();

      await client.query(
        `INSERT INTO handover_packages
          (id, org_id, project_id, version_no, status, snapshot_id, snapshot_checksum,
           override_reason, requested_by, package_purpose)
         VALUES ($1, $2, $3, $4, 'QUEUED', $5, $6, $7, $8, 'FULL_HANDOVER')`,
        [
          packageId,
          ctx.orgId,
          projectId,
          nextVersionNo,
          activeSnapshot.id,
          activeSnapshot.checksum,
          null,
          ctx.userId,
        ],
      );

      // Snapshot each requirement exactly once and only attach evidence versions that
      // satisfy the same integrity predicates used by the readiness calculation.
      const { rows: reqRows } = await client.query(
        `SELECT r.id, r.requirement_key, r.scope_key, r.title, r.doc_type_key,
                r.mandatory, r.status, r.due_at,
                evidence.version_ids,
                evidence.has_valid_evidence,
                evidence.has_expired_evidence, evidence.revision_code,
                waiver.type AS valid_waiver_type,
                waiver.id AS valid_waiver_id,
                waiver.reason AS valid_waiver_reason,
                waiver.approved_by AS valid_waiver_approved_by,
                waiver.approved_at AS valid_waiver_approved_at,
                waiver.second_approved_by AS valid_waiver_second_approved_by,
                a.tag AS asset_tag
           FROM requirements r
           LEFT JOIN LATERAL (
             SELECT
               COALESCE(array_agg(DISTINCT dv.id ORDER BY dv.id)
                 FILTER (WHERE dv.id IS NOT NULL AND
                   (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)), ARRAY[]::uuid[]) AS version_ids,
               COALESCE(bool_or(dv.id IS NOT NULL AND
                   (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)), false) AS has_valid_evidence,
               COALESCE(bool_or(dv.id IS NOT NULL AND dv.expiry_date < CURRENT_DATE), false) AS has_expired_evidence,
               (array_agg(COALESCE(dv.revision_code, 'v' || dv.version_no::text)
                  ORDER BY dv.version_no DESC)
                FILTER (WHERE dv.id IS NOT NULL AND
                  (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)))[1] AS revision_code
             FROM document_requirements dr
             JOIN documents d
               ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
              AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
              AND d.doc_type_key = r.doc_type_key
             JOIN document_versions dv
               ON dv.org_id = d.org_id AND dv.project_id = d.project_id
              AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
              AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
              AND dv.review_status = 'APPROVED' AND dv.file_status = 'READY'
             JOIN storage_objects so
               ON so.org_id = dv.org_id AND so.id = dv.object_id
              AND so.status = 'READY'
              AND so.sha256 ~ '^[a-fA-F0-9]{64}$'
              AND so.size_bytes > 0 AND so.observed_size_bytes = so.size_bytes
              AND so.provider_version_id IS NOT NULL
              AND btrim(lower(so.provider_version_id)) NOT IN ('', 'null', 'undefined', 'none', 'unversioned')
             WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id
               AND dr.requirement_id = r.id
               AND NOT EXISTS (
                 SELECT 1 FROM evidence_revalidations er
                  WHERE er.org_id = dv.org_id AND er.project_id = dv.project_id
                    AND er.document_version_id = dv.id
                    AND (r.scope_key IS NULL OR r.scope_key NOT LIKE 'asset:%' OR er.asset_id::text = substring(r.scope_key from 7))
                    AND er.status IN ('PENDING', 'MISMATCH')
               )
           ) evidence ON true
           LEFT JOIN LATERAL (
             SELECT w.id, w.type, w.reason, w.approved_by,
                    w.approved_at, w.second_approved_by
               FROM waivers w
              WHERE w.org_id = r.org_id AND w.project_id = r.project_id
                AND w.requirement_id = r.id AND w.status = 'ACTIVE'
                AND w.type IN ('WAIVE', 'NOT_APPLICABLE')
                AND (NOT r.mandatory OR
                  (w.second_approved_by IS NOT NULL AND w.second_approved_by <> w.approved_by))
              ORDER BY w.approved_at DESC, w.id DESC LIMIT 1
           ) waiver ON true
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
          ORDER BY r.group_key, r.requirement_key`,
        [ctx.orgId, projectId],
      );

      // Canonical readiness and manifest selection MUST agree under
      // the same repeatable-read snapshot. Missing evidence cannot silently
      // yield a complete dossier even if its cached status says APPROVED.
      if (!reqRows.length || reqRows.some((r: any) =>
        r.mandatory && !r.valid_waiver_type && r.has_valid_evidence !== true)) {
        throw new UnprocessableEntityException({
          code: 'PACKAGE_MANIFEST_READINESS_MISMATCH',
          detail: 'Mandatory evidence or a valid decision is missing from the frozen manifest.',
        });
      }

      const exclusionMap = new Map(
        (input.excludedRequirementIds ?? []).map((e) => [e.requirementId, e.reason]),
      );
      const requirementIds = new Set<string>(reqRows.map((req: any) => req.id));
      for (const excludedId of exclusionMap.keys()) {
        if (!requirementIds.has(excludedId)) {
          throw new UnprocessableEntityException({
            code: 'UNKNOWN_EXCLUDED_REQUIREMENT',
            detail: `Requirement ${excludedId} is not part of the active project checklist.`,
          });
        }
        const requirement = reqRows.find((req: any) => req.id === excludedId);
        if (requirement?.mandatory) {
          throw new UnprocessableEntityException({
            code: 'MANDATORY_REQUIREMENT_EXCLUSION',
            detail: `Mandatory requirement ${requirement.requirement_key} cannot be excluded from a final handover package.`,
          });
        }
      }

      const packageEvidence = new Map<string, { sectionKey: string; reasons: Set<string>; included: boolean }>();
      for (const req of reqRows) {
        const evidenceVersionIds: string[] = Array.isArray(req.version_ids) ? req.version_ids : [];
        const effectiveStatus = req.valid_waiver_type
          ? (req.valid_waiver_type === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'WAIVED')
          : req.has_valid_evidence
            ? 'APPROVED'
            : req.has_expired_evidence
              ? 'EXPIRED'
              : (req.status === 'WAIVED' || req.status === 'NOT_APPLICABLE' ? 'NOT_STARTED' : req.status);
        await client.query(
          `INSERT INTO package_requirements
            (id, org_id, project_id, package_id, requirement_id, requirement_key,
             scope_key, title, doc_type_key, mandatory, status_at_generation,
             due_at_at_generation, asset_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            uuidv7(),
            ctx.orgId,
            projectId,
            packageId,
            req.id,
            req.requirement_key,
            req.scope_key,
            req.title,
            req.doc_type_key,
            req.mandatory,
            effectiveStatus,
            req.due_at,
            req.asset_tag ?? null,
          ],
        );

        const exclReason = exclusionMap.get(req.id);
        for (const versionId of evidenceVersionIds) {
          const existing = packageEvidence.get(versionId) ?? {
            sectionKey: req.doc_type_key,
            reasons: new Set<string>(),
            included: false,
          };
          if (exclReason) existing.reasons.add(exclReason);
          else existing.included = true;
          packageEvidence.set(versionId, existing);
        }
      }

      let sortOrder = 1;
      for (const [documentVersionId, item] of packageEvidence) {
        const exclusionReason = item.included ? null : [...item.reasons].join('; ') || 'No included requirement references this evidence.';
        await client.query(
          `INSERT INTO package_items
              (id, org_id, project_id, package_id, document_version_id,
               section_key, sort_order, included, exclusion_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            uuidv7(),
            ctx.orgId,
            projectId,
            packageId,
            documentVersionId,
            item.sectionKey,
            sortOrder++,
            item.included,
            exclusionReason,
          ],
        );
      }

      emit({
        eventType: 'HANDOVER_PACKAGE_QUEUED',
        projectId,
        entityType: 'HANDOVER_PACKAGE',
        entityId: packageId,
        afterJson: {
          versionNo: nextVersionNo,
          snapshotChecksum: activeSnapshot.checksum,
        },
      });

      return {
        packageId,
        versionNo: nextVersionNo,
        status: 'QUEUED',
        snapshotChecksum: activeSnapshot.checksum,
      };
    }, { isolationLevel: 'REPEATABLE READ' });
  }

  /**
   * API-117: POST /api/v1/submissions/:id/decision
   * Records recipient decision (ACCEPT / ACCEPT_WITH_EXCEPTIONS / REJECT) and writes
   * exceptions back as requirement_change_requests (SCR-031 / AUD-P-16).
   */
  async recordRecipientSubmissionDecision(
    ctx: TenantActorContext,
    projectId: string,
    submissionId: string,
    input: {
      recipientPartyId: string;
      decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT';
      remarks?: string;
      exceptionItems?: Array<{ title: string; docTypeKey: string; reason: string }>;
    },
  ) {
    if (!input || !input.recipientPartyId ||
        !['ACCEPT', 'ACCEPT_WITH_EXCEPTIONS', 'REJECT'].includes(input.decision)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_RECIPIENT_DECISION',
        detail: 'A valid recipient party and decision are required.',
      });
    }
    // Internal project managers may submit a package, but cannot impersonate
    // the legally independent external recipient who accepts it.
    if (ctx.actorType !== 'GUEST' || !ctx.guestGrantId) {
      throw new ForbiddenException({
        code: 'EXTERNAL_RECIPIENT_AUTHORITY_REQUIRED',
        detail: 'Recipient acceptance requires the authenticated recipient party grant.',
      });
    }
    if (input.decision !== 'ACCEPT' && (!input.remarks || input.remarks.trim().length < 5)) {
      throw new UnprocessableEntityException({
        code: 'REMARKS_REQUIRED',
        detail: 'Remarks are required when accepting with exceptions or rejecting a package (SCR-031).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // 1. Resolve and lock submission to guarantee correct project context (TC2-011)
      const subRes = await client.query(
        `SELECT s.id, s.project_id, s.status, s.package_id, hp.package_purpose
           FROM submissions s
           JOIN handover_packages hp
             ON hp.org_id = s.org_id AND hp.project_id = s.project_id AND hp.id = s.package_id
          WHERE s.org_id = $1 AND s.id = $2 FOR UPDATE OF s`,
        [ctx.orgId, submissionId],
      );
      if (!subRes.rows.length) {
        throw new NotFoundException('SUBMISSION_NOT_FOUND');
      }
      const submission = subRes.rows[0];
      if (submission.package_purpose !== 'FULL_HANDOVER') {
        throw new ConflictException({
          code: 'PARTIAL_PACKAGE_CANNOT_RECEIVE_HANDOVER_ACCEPTANCE',
          detail: 'An RA-bill annexure cannot be accepted as a full contractual handover.',
        });
      }
      if (projectId && submission.project_id && projectId !== submission.project_id) {
        throw new ConflictException({
          code: 'SUBMISSION_PROJECT_MISMATCH',
          message: 'SUBMISSION_PROJECT_MISMATCH',
          detail: `Submission ${submissionId} belongs to project ${submission.project_id}, not ${projectId}.`,
        });
      }
      const targetProjectId = submission.project_id || projectId;

      // 2. Map recipient decision to valid recipient status enum (ACCEPTED, ACCEPTED_WITH_EXCEPTIONS, REJECTED)
      const recipientStatusMap: Record<string, string> = {
        ACCEPT: 'ACCEPTED',
        ACCEPT_WITH_EXCEPTIONS: 'ACCEPTED_WITH_EXCEPTIONS',
        REJECT: 'REJECTED',
      };
      const nextRecipientStatus = recipientStatusMap[input.decision];

      // 3. Resolve and lock recipient row, verifying authority and preventing conflicting decisions (V05, F05)
      const recCheck = await client.query(
        `SELECT sr.*, gag.party_id AS grant_party_id, gag.status AS grant_status, gag.project_id AS grant_project_id,
                  gag.expires_at AS grant_expires_at, gag.capabilities AS grant_capabilities,
                  gag.independent_authority_verified_at AS grant_independent_authority_verified_at
           FROM submission_recipients sr
           LEFT JOIN guest_grants gag ON gag.org_id = sr.org_id AND gag.id = $4
          WHERE sr.org_id = $1 AND sr.submission_id = $2
            AND (sr.recipient_party_id = $3 OR sr.id = $3)
          FOR UPDATE OF sr`,
        [ctx.orgId, submissionId, input.recipientPartyId, ctx.guestGrantId || null],
      );
      if (!recCheck.rows.length) {
        throw new NotFoundException('SUBMISSION_RECIPIENT_NOT_FOUND');
      }
      const existingRec = recCheck.rows[0];

      if (existingRec.decided_at != null || ['ACCEPTED', 'ACCEPTED_WITH_EXCEPTIONS', 'REJECTED'].includes(existingRec.status)) {
        throw new ConflictException({
          code: 'SUBMISSION_DECISION_ALREADY_RECORDED',
          detail: `A decision has already been recorded for recipient ${input.recipientPartyId} on submission ${submissionId}.`,
        });
      }

      if (existingRec.grant_status !== 'ACTIVE' ||
          !existingRec.grant_expires_at || new Date(existingRec.grant_expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException('GUEST_GRANT_REVOKED_OR_EXPIRED');
      }
      if (!existingRec.grant_independent_authority_verified_at) {
        throw new ForbiddenException({
          code: 'INDEPENDENT_PARTY_AUTHORITY_REQUIRED',
          detail: 'Recipient acceptance requires independently verified authority.',
        });
      }
      if (!Array.isArray(existingRec.grant_capabilities) ||
          !existingRec.grant_capabilities.includes('package.accept')) {
        throw new ForbiddenException({
          code: 'RECIPIENT_AUTHORITY_DENIED',
          detail: 'The active grant does not permit handover acceptance.',
        });
      }
      if (!existingRec.grant_project_id || existingRec.grant_project_id !== targetProjectId) {
        throw new ForbiddenException({
          code: 'RECIPIENT_AUTHORITY_DENIED',
          detail: 'Guest grant does not belong to this project.',
        });
      }
      // Never permit an unlinked recipient row to be silently accepted by a
      // general organisation member or by a guest bound to another party.
      const effectivePartyId = existingRec.recipient_party_id || existingRec.party_id;
      if (!existingRec.grant_party_id || !effectivePartyId ||
          existingRec.grant_party_id !== effectivePartyId) {
        throw new ForbiddenException({
          code: 'RECIPIENT_AUTHORITY_DENIED',
          detail: 'Guest grant does not identify this submitted recipient party.',
        });
      }

      const updateRecRes = await client.query(
        `UPDATE submission_recipients
            SET status = $4,
                decision = $5,
                remarks = $6,
                decided_at = now()
          WHERE org_id = $1 AND submission_id = $2 AND id = $3
            AND decided_at IS NULL`,
        [
          ctx.orgId,
          submissionId,
          existingRec.id,
          nextRecipientStatus,
          input.decision,
          input.remarks ?? null,
        ],
      );

      let createdChangeRequestId: string | null = null;

      // AUD-P-16: Exceptions automatically write back a controlled Requirement Change Request
      if (input.decision === 'ACCEPT_WITH_EXCEPTIONS' || input.decision === 'REJECT') {
        createdChangeRequestId = uuidv7();
        await client.query(
          `INSERT INTO requirement_change_requests
            (id, org_id, project_id, requested_by, reason, items_json, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'SUBMITTED')`,
          [
            createdChangeRequestId,
            ctx.orgId,
            targetProjectId,
            ctx.userId,
            `Client handover decision (${input.decision}): ${input.remarks}`,
            JSON.stringify(input.exceptionItems ?? [{ note: input.remarks }]),
          ],
        );
      }

      // F05 / Gap 4: Determine aggregate submission status across REQUIRED approvers (observers cannot veto)
      const { rows: allRecs } = await client.query(
        `SELECT id, status, decision, is_required_approver FROM submission_recipients WHERE org_id = $1 AND submission_id = $2`,
        [ctx.orgId, submissionId],
      );

      const requiredRecs = allRecs.filter((r) => r.is_required_approver !== false);
      const effectiveRecs = requiredRecs.length > 0 ? requiredRecs : allRecs;

      const anyRejected = effectiveRecs.some((r) =>
        r.id === existingRec.id ? input.decision === 'REJECT' : (r.decision === 'REJECT' || r.status === 'REJECTED'),
      );
      const anyWithExceptions = effectiveRecs.some((r) =>
        r.id === existingRec.id
          ? input.decision === 'ACCEPT_WITH_EXCEPTIONS'
          : (r.decision === 'ACCEPT_WITH_EXCEPTIONS' || r.status === 'ACCEPTED_WITH_EXCEPTIONS'),
      );
      const allDecided = effectiveRecs.length > 0 && effectiveRecs.every((r) =>
        r.id === existingRec.id ? true : r.decision != null,
      );
      const allAccepted = effectiveRecs.length > 0 && effectiveRecs.every((r) =>
        r.id === existingRec.id ? input.decision === 'ACCEPT' : (r.decision === 'ACCEPT' || r.status === 'ACCEPTED'),
      );

      let nextSubStatus: string;
      if (anyRejected) {
        nextSubStatus = 'REJECTED';
      } else if (anyWithExceptions) {
        nextSubStatus = 'PARTIALLY_ACCEPTED';
      } else if (allAccepted && allDecided) {
        nextSubStatus = 'ACCEPTED';
      } else {
        // More recipients pending decision
        nextSubStatus = 'SUBMITTED';
      }

      await client.query(
        `UPDATE submissions
            SET status = $3, decided_at = CASE WHEN $3 IN ('ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED') THEN now() ELSE decided_at END,
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $4`,
        [ctx.orgId, targetProjectId, nextSubStatus, submissionId],
      );

      if (nextSubStatus === 'ACCEPTED' && submission.package_id) {
        await client.query(
          `UPDATE handover_packages
              SET status = 'ACCEPTED', updated_at = now()
            WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, submission.package_id],
        );
      }

      emit({
        eventType: `SUBMISSION_${nextSubStatus}`,
        projectId: targetProjectId,
        entityType: 'SUBMISSION',
        entityId: submissionId,
        afterJson: {
          decision: input.decision,
          createdChangeRequestId,
        },
      });

      return {
        submissionId,
        status: nextSubStatus,
        createdChangeRequestId,
      };
    });
  }

  /**
   * Fix Business Risk 4 (RT-008): Monthly Running Account (RA) Bill Evidence Pack Generator
   * Filters requirements strictly by billing milestone_key (DELIVERY, INSTALLATION, COMMISSIONING, etc.)
   * and compiles a focused evidence dossier PDF so contractors can unlock monthly progress payments.
   */
  async compileRaBillEvidencePack(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      milestoneKey:
        | 'MOBILISATION'
        | 'SUBMISSION'
        | 'DELIVERY'
        | 'INSTALLATION'
        | 'COMMISSIONING'
        | 'HANDOVER'
        | 'FINAL_BILL';
      billNumber: string;
      billAmountInr?: number;
      description?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // 1. Fetch requirements scoped to this milestone
      const { rows: milestoneReqs } = await client.query(
        `SELECT r.id, r.requirement_key, r.scope_key, r.title, r.doc_type_key,
                r.mandatory, r.status, r.milestone_key,
                d.id AS document_id, d.title AS document_title,
                dv.id AS version_id, dv.version_no, dv.revision_code,
                so.id AS storage_object_id, so.size_bytes, so.sha256,
                a.tag AS asset_tag, r.due_at
           FROM requirements r
           JOIN document_requirements dr
             ON dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
           JOIN documents d
             ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
            AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
              AND d.doc_type_key = r.doc_type_key
           JOIN document_versions dv
             ON dv.org_id = d.org_id AND dv.project_id = d.project_id
            AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
            AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
           JOIN storage_objects so
             ON so.org_id = dv.org_id AND so.id = dv.object_id
            AND so.status = 'READY'
              AND so.sha256 ~ '^[a-fA-F0-9]{64}$'
              AND so.size_bytes > 0 AND so.observed_size_bytes = so.size_bytes
              AND so.provider_version_id IS NOT NULL
              AND btrim(lower(so.provider_version_id)) NOT IN ('', 'null', 'undefined', 'none', 'unversioned')
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2
            AND r.milestone_key = $3
            AND r.superseded_at IS NULL
            AND dv.file_status = 'READY'
            AND dv.review_status = 'APPROVED'
            AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
          ORDER BY r.group_key, r.requirement_key`,
        [ctx.orgId, projectId, input.milestoneKey],
      );
      if (milestoneReqs.length === 0) {
        throw new UnprocessableEntityException('NO_APPROVED_MILESTONE_EVIDENCE');
      }

      const { rows: snapRows } = await client.query(
        `SELECT id, checksum FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const snapshotId = snapRows[0]?.id || null;
      const snapshotChecksum = snapRows[0]?.checksum || 'GENESIS_CHECKSUM';

      await client.query(
        `SELECT id FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      const { rows: verMax } = await client.query(
        `SELECT COALESCE(MAX(version_no), 0)::int AS max_ver
           FROM handover_packages
          WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const nextVersionNo = verMax[0].max_ver + 1;
      const packageId = uuidv7();

      await client.query(
        `INSERT INTO handover_packages
          (id, org_id, project_id, version_no, status, snapshot_id, snapshot_checksum,
           override_reason, requested_by, package_purpose)
         VALUES ($1, $2, $3, $4, 'QUEUED', $5, $6, $7, $8, 'RA_BILL')`,
        [
          packageId,
          ctx.orgId,
          projectId,
          nextVersionNo,
          snapshotId,
          snapshotChecksum,
          `RA Bill Annexure: ${input.billNumber} (${input.milestoneKey})`,
          ctx.userId,
        ],
      );

      const uniqueVersions = new Map<string, any>();
      const uniqueRequirements = new Map<string, any>();
      for (const req of milestoneReqs) {
        uniqueRequirements.set(req.id, req);
        uniqueVersions.set(req.version_id, req);
      }
      for (const req of uniqueRequirements.values()) {
        await client.query(
          `INSERT INTO package_requirements
            (id, org_id, project_id, package_id, requirement_id, requirement_key,
             scope_key, title, doc_type_key, mandatory, status_at_generation,
             due_at_at_generation, asset_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [uuidv7(), ctx.orgId, projectId, packageId, req.id, req.requirement_key,
            req.scope_key, req.title, req.doc_type_key, req.mandatory, req.status,
            req.due_at, req.asset_tag ?? null],
        );
      }
      let sortOrder = 1;
      for (const [documentVersionId, req] of uniqueVersions) {
        await client.query(
          `INSERT INTO package_items
            (id, org_id, project_id, package_id, document_version_id,
             section_key, sort_order, included)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          [uuidv7(), ctx.orgId, projectId, packageId, documentVersionId,
            req.doc_type_key, sortOrder++],
        );
      }

      emit({
        eventType: 'HANDOVER_PACKAGE_QUEUED',
        projectId,
        entityType: 'HANDOVER_PACKAGE',
        entityId: packageId,
        afterJson: {
          packageId,
          milestoneKey: input.milestoneKey,
          billNumber: input.billNumber,
          billAmountInr: input.billAmountInr,
          includedDocumentsCount: uniqueVersions.size,
          source: 'RA_BILL',
        },
      });

      return {
        packageId,
        versionNo: nextVersionNo,
        status: 'QUEUED',
        milestoneKey: input.milestoneKey,
        billNumber: input.billNumber,
        includedRequirementsCount: milestoneReqs.length,
        items: milestoneReqs.map((r: any) => ({
          requirementKey: r.requirement_key,
          documentTitle: r.document_title,
          revisionCode: r.revision_code,
          assetTag: r.asset_tag,
        })),
      };
    });
  }

  async listPackages(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT hp.*,
                (SELECT count(*) FROM package_items pi WHERE pi.package_id = hp.id) AS item_count
           FROM handover_packages hp
          WHERE hp.org_id = $1 AND hp.project_id = $2
          ORDER BY hp.version_no DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async getPackage(ctx: TenantActorContext, packageId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM handover_packages WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, packageId],
      );
      if (!rows.length) {
        throw new NotFoundException('Package not found');
      }
      const pkg = rows[0];
      const { rows: items } = await client.query(
        `SELECT pi.*, dv.revision_code, dv.file_status, d.title AS document_title
           FROM package_items pi
           JOIN document_versions dv ON dv.id = pi.document_version_id
           JOIN documents d ON d.id = dv.document_id
          WHERE pi.org_id = $1 AND pi.package_id = $2
          ORDER BY pi.sort_order ASC`,
        [ctx.orgId, packageId],
      );
      return { ...pkg, items };
    });
  }

  async getProjectPackage(ctx: TenantActorContext, projectId: string, packageId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM handover_packages
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, packageId],
      );
      if (!rows.length) throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', detail: 'Handover package not found.' });
      const { rows: items } = await client.query(
        `SELECT pi.*, dv.revision_code, dv.file_status, d.title AS document_title
           FROM package_items pi
           JOIN document_versions dv
             ON dv.org_id = pi.org_id AND dv.project_id = pi.project_id AND dv.id = pi.document_version_id
           JOIN documents d
             ON d.org_id = dv.org_id AND d.project_id = dv.project_id AND d.id = dv.document_id
          WHERE pi.org_id = $1 AND pi.project_id = $2 AND pi.package_id = $3
          ORDER BY pi.sort_order ASC, pi.id`,
        [ctx.orgId, projectId, packageId],
      );
      return { ...rows[0], items };
    });
  }

  async getPackageDownloadUrl(ctx: TenantActorContext, projectId: string, packageId: string) {
    const artifact = await withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT hp.status, hp.version_no, hp.checksum,
                so.object_key, so.original_filename, so.mime, so.size_bytes,
                so.sha256, so.status AS object_status, so.provider_version_id,
                so.observed_size_bytes
           FROM handover_packages hp
           JOIN storage_objects so
             ON so.org_id = hp.org_id AND so.id = hp.pdf_object_id
          WHERE hp.org_id = $1 AND hp.project_id = $2 AND hp.id = $3`,
        [ctx.orgId, projectId, packageId],
      );
      if (!rows.length) throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', detail: 'Handover package not found.' });
      const row = rows[0];
      if (!['READY', 'SUBMITTED', 'PARTIALLY_ACCEPTED', 'ACCEPTED'].includes(row.status) ||
          row.object_status !== 'READY' || row.mime !== 'application/pdf' ||
          !isImmutableStorageVersion(row.provider_version_id) || !row.sha256 || row.sha256 !== row.checksum ||
          Number(row.observed_size_bytes) !== Number(row.size_bytes)) {
        throw new UnprocessableEntityException({
          code: 'PACKAGE_ARTIFACT_NOT_VERIFIED',
          detail: 'The handover package does not have a verified, ready artifact available for download.',
        });
      }
      return row;
    });
    const downloadUrl = await this.storage.createSignedDownloadUrl({
      objectKey: artifact.object_key,
      versionId: artifact.provider_version_id,
      filename: `handover-v${artifact.version_no}.pdf`,
    });
    return {
      packageId,
      status: 'READY',
      downloadUrl,
      expiresInSeconds: 900,
      checksum: artifact.checksum,
      sizeBytes: artifact.size_bytes,
      mime: artifact.mime,
    };
  }

  async createSubmission(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      packageId?: string;
      recipients: Array<{
        partyId?: string;
        email: string;
        name: string;
        isRequiredApprover?: boolean;
        role?: string;
      }>;
      coverNote?: string;
    },
  ) {
    if (!Array.isArray(dto?.recipients) || dto.recipients.length === 0 ||
        !dto.recipients.some((r) => r.isRequiredApprover !== false)) {
      throw new UnprocessableEntityException({
        code: 'HANDOVER_RECIPIENT_REQUIRED',
        detail: 'A handover submission must identify at least one required approver.',
      });
    }
    const seenEmails = new Set<string>();
    const seenRequiredParties = new Set<string>();
    for (const recipient of dto.recipients) {
      if (!recipient || typeof recipient.email !== 'string' ||
          typeof recipient.name !== 'string' || !recipient.name.trim() ||
          recipient.name.length > 200 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email.trim()) ||
          recipient.email.length > 254 ||
          (recipient.isRequiredApprover !== undefined &&
            typeof recipient.isRequiredApprover !== 'boolean') ||
          (recipient.partyId !== undefined &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient.partyId))) {
        throw new UnprocessableEntityException('HANDOVER_RECIPIENT_INVALID');
      }
      const email = recipient.email.trim().toLowerCase();
      if (seenEmails.has(email)) throw new UnprocessableEntityException('HANDOVER_RECIPIENT_DUPLICATE');
      seenEmails.add(email);
      if (recipient.isRequiredApprover !== false) {
        if (!recipient.partyId || seenRequiredParties.has(recipient.partyId)) {
          throw new UnprocessableEntityException('HANDOVER_REQUIRED_PARTY_INVALID');
        }
        seenRequiredParties.add(recipient.partyId);
      }
    }
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // The legacy packages/:id/submit route supplies only a package ID.
      // Resolve the project from that tenant-owned package, never from a
      // missing/empty UUID or an untrusted request body.
      let targetProjectId = projectId;
      if (!targetProjectId) {
        if (!dto.packageId) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_OR_PACKAGE_REQUIRED',
            detail: 'Provide a project or an existing handover package.',
          });
        }
        const { rows: ownedPackage } = await client.query(
          `SELECT project_id FROM handover_packages
             WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, dto.packageId],
        );
        if (!ownedPackage.length) {
          throw new NotFoundException('HANDOVER_PACKAGE_NOT_FOUND');
        }
        targetProjectId = ownedPackage[0].project_id;
      }
      // The package must belong to this project, be the newest revision, and
      // have completed real artifact generation. Never submit QUEUED/FAILED
      // packages or older versions after a corrected dossier is generated.
      const { rows: latestPkg } = await client.query(
        `SELECT hp.id, hp.status FROM handover_packages hp
           WHERE hp.org_id = $1 AND hp.project_id = $2
             AND hp.package_purpose = 'FULL_HANDOVER'
           ORDER BY hp.version_no DESC LIMIT 1 FOR UPDATE`,
        [ctx.orgId, targetProjectId],
      );
      if (latestPkg.length === 0) {
        throw new NotFoundException('No handover package found for project');
      }
      const latest = latestPkg[0];
      if ((dto.packageId && dto.packageId !== latest.id) || latest.status !== 'READY') {
        throw new ConflictException({
          code: 'HANDOVER_PACKAGE_NOT_READY',
          detail: 'Only the latest successfully generated package can be submitted for acceptance.',
        });
      }
      const packageId = latest.id;
      // Locking the latest package above serializes duplicate commands for this revision.
      // A resend requires an explicit documented transition, not a second live submission.
      const { rows: existingSubmission } = await client.query(
        `SELECT id FROM submissions
          WHERE org_id = $1 AND project_id = $2 AND package_id = $3
            AND status NOT IN ('REJECTED', 'CANCELLED')
          LIMIT 1`,
        [ctx.orgId, targetProjectId, packageId],
      );
      if (existingSubmission.length) {
        throw new ConflictException({
          code: 'HANDOVER_SUBMISSION_ALREADY_EXISTS',
          detail: 'This handover revision already has a submission. Use its current delivery and decision state.',
        });
      }
      const submissionId = uuidv7();
      await client.query(
        `INSERT INTO submissions (id, org_id, project_id, package_id, status, submitted_by, submitted_at, cover_note)
         VALUES ($1, $2, $3, $4, 'SUBMITTED', $5, now(), $6)`,
        [submissionId, ctx.orgId, targetProjectId, packageId, ctx.userId, dto.coverNote || null],
      );

      for (const rec of dto.recipients) {
        await client.query(
          `INSERT INTO submission_recipients
             (id, org_id, project_id, submission_id, party_id, recipient_party_id, name, email, role, is_required_approver, status)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, 'PENDING_DELIVERY')`,
          [
            uuidv7(),
            ctx.orgId,
            targetProjectId,
            submissionId,
            rec.partyId || null,
            rec.name.trim(),
            rec.email.trim().toLowerCase(),
            rec.role || 'CLIENT',
            rec.isRequiredApprover ?? true,
          ],
        );
      }

      emit({
        eventType: 'SUBMISSION_PREPARED',
        projectId: targetProjectId,
        entityType: 'SUBMISSION',
        entityId: submissionId,
        afterJson: { packageId, recipientCount: dto.recipients.length, deliveryVerified: false },
      });

      return {
        submissionId,
        packageId,
        status: 'SUBMITTED',
        deliveryStatus: 'PENDING_DELIVERY',
        recipientsCount: dto.recipients.length,
      };
    });
  }

  /**
   * Legacy 'dossier/pdf' download uses the latest verified worker-generated
   * artifact. Never synthesize a front-matter-only PDF as a completed dossier.
   * An incomplete newer revision blocks fallback to a stale accepted version.
   */
  async getLatestDossierDownloadUrl(ctx: TenantActorContext, projectId: string) {
    const latestId = await withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM handover_packages
           WHERE org_id = $1 AND project_id = $2
             AND package_purpose = 'FULL_HANDOVER'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (!rows.length) {
        throw new NotFoundException('NO_HANDOVER_DOSSIER_AVAILABLE');
      }
      return rows[0].id as string;
    });
    return this.getPackageDownloadUrl(ctx, projectId, latestId);
  }

  async generateDossierPdf(ctx: TenantActorContext, projectId: string): Promise<Uint8Array> {
    void ctx;
    void projectId;
    throw new GoneException({
      code: 'PORTABLE_DOSSIER_ASSEMBLY_UNAVAILABLE',
      detail: 'The current endpoint can only create front matter and does not assemble verified evidence files. No dossier PDF was generated.',
    });
  }

  /**
   * API-125: POST /api/v1/projects/:id/archive-exports
   * Records a manifest-only export receipt. A portable object archive is not emitted by this path.
   */
  async exportProjectArchive(
    ctx: TenantActorContext,
    projectId: string,
    options?: { purpose?: string; includeArchiveFile?: boolean },
  ) {
    // G02-014: manifest-only exports still reveal highly sensitive client,
    // commercial, document and reviewer information.
    if(ctx.guestGrantId || (ctx.orgRole!=='R-OWNER' && ctx.orgRole!=='R-ADMIN')){
      throw new ForbiddenException({code:'EXPORT_AUTHORITY_REQUIRED'});
    }
    const reason=options?.purpose;
    if(typeof reason!=='string' || reason.trim().length<10 ||
       reason.length>500){
      throw new UnprocessableEntityException({code:'EXPORT_REASON_REQUIRED'});
    }
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Serialize hourly quota checks and project closure with the same
      // project lock. Concurrent export submissions cannot both see empty.
      const {rows:projRows}=await client.query(
        `SELECT id,code,name,site_json,created_at FROM projects
           WHERE org_id=$1 AND id=$2 AND purged_at IS NULL FOR UPDATE`,
        [ctx.orgId,projectId],
      );
      if(ctx.sessionId){
        const {rows:fresh}=await client.query(
          `SELECT id FROM sessions WHERE id=$1 AND user_id=$2
             AND active_org_id=$3 AND revoked_at IS NULL
             AND mfa_verified=true AND mfa_verified_at>now()-interval '10 minutes'
             FOR SHARE`,
          [ctx.sessionId,ctx.userId,ctx.orgId],
        );
        if(!fresh.length)throw new ForbiddenException({code:'EXPORT_FRESH_MFA_REQUIRED'});
      }
      const {rows:recent}=await client.query(
        `SELECT id FROM archive_exports
           WHERE org_id=$1 AND project_id=$2
             AND created_at>now()-interval '1 hour' LIMIT 1`,
        [ctx.orgId,projectId],
      );
      if(recent.length)throw new ConflictException({code:'EXPORT_HOURLY_LIMIT'});
      // 1. Fetch project info
      if (!projRows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      const proj = projRows[0];

      // 2. Fetch all document versions with storage objects and hash integrity
      const { rows: docRows } = await client.query(
        `SELECT dv.id AS version_id, dv.version_no, dv.revision_code, dv.file_status, dv.review_status,
                dv.issue_date, dv.expiry_date,
                d.id AS document_id, d.title AS document_title, d.category_key,
                so.id AS object_id, so.bucket, so.provider_version_id, so.object_key, so.size_bytes, so.mime, so.sha256,
                u.name AS uploaded_by_name
         FROM document_versions dv
         JOIN documents d ON d.id = dv.document_id AND d.org_id = dv.org_id AND d.project_id = dv.project_id
         JOIN storage_objects so ON so.id = dv.object_id AND so.org_id = dv.org_id
         LEFT JOIN users u ON u.id = dv.uploaded_by
         WHERE dv.org_id = $1 AND dv.project_id = $2
           AND dv.deleted_at IS NULL
           AND d.deleted_at IS NULL AND dv.file_status = 'READY' AND so.status = 'READY'
           AND so.provider_version_id IS NOT NULL AND so.sha256 IS NOT NULL
           AND so.observed_size_bytes = so.size_bytes
         ORDER BY d.category_key ASC, d.title ASC, dv.version_no ASC`,
        [ctx.orgId, projectId],
      );

      // 3. Fetch assets with identity revisions
      const { rows: assetRows } = await client.query(
        `SELECT a.id, a.tag, a.name, a.category_key, a.make, a.model, a.serial_no, a.location, a.status,
                a.warranty_start, a.warranty_end, a.warranty_start_basis,
                (SELECT count(*) FROM asset_identity_revisions air WHERE air.asset_id = a.id) AS identity_revisions_count
         FROM assets a
         WHERE a.org_id = $1 AND a.project_id = $2 AND a.deleted_at IS NULL
         ORDER BY a.tag ASC`,
        [ctx.orgId, projectId],
      );

      // 4. Fetch requirements and satisfaction state
      const { rows: reqRows } = await client.query(
        `SELECT r.id, r.requirement_key, r.scope_key, r.title, r.doc_type_key, r.mandatory, r.status,
                d.current_approved_version_id
         FROM requirements r
         LEFT JOIN document_requirements dr ON dr.requirement_id = r.id AND dr.org_id = r.org_id
         LEFT JOIN documents d ON d.id = dr.document_id
         WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
         ORDER BY r.requirement_key ASC`,
        [ctx.orgId, projectId],
      );

      // 5. Fetch reviews and external approvals with bitemporal dates
      const { rows: revRows } = await client.query(
        `SELECT r.id, r.document_version_id, r.method, r.external_method, r.external_approver_name,
                r.external_reference, r.status, r.decision, r.comment, r.decided_at,
                r.occurred_at, r.occurred_at_precision, r.recorded_at, r.backdating_reason,
                u.name AS reviewer_name
         FROM reviews r
         LEFT JOIN users u ON u.id = r.reviewer_user_id
         WHERE r.org_id = $1 AND r.project_id = $2
         ORDER BY r.created_at ASC`,
        [ctx.orgId, projectId],
      );

      // 6. Fetch handover packages generated
      const { rows: pkgRows } = await client.query(
        `SELECT hp.id, hp.version_no, hp.status, hp.checksum, hp.snapshot_checksum, hp.created_at
         FROM handover_packages hp
         WHERE hp.org_id = $1 AND hp.project_id = $2
         ORDER BY hp.version_no ASC`,
        [ctx.orgId, projectId],
      );

      // Calculate totals
      let totalBytes = 0n;
      for (const d of docRows) {
        if (d.size_bytes) {
          totalBytes += BigInt(d.size_bytes);
        }
      }

      const exportId = uuidv7();
      const exportedAt = new Date().toISOString();

      // Build canonical manifest
      const manifest = {
        schema_version: '2.0',
        export_id: exportId,
        exported_at: exportedAt,
        project: {
          id: proj.id,
          code: proj.code,
          name: proj.name,
          site: proj.site_json,
        },
        summary: {
          total_documents: docRows.length,
          total_bytes: totalBytes.toString(),
          total_assets: assetRows.length,
          total_requirements: reqRows.length,
          total_reviews: revRows.length,
          total_packages: pkgRows.length,
        },
        objects: docRows.map((d: any) => ({
          version_id: d.version_id,
          document_id: d.document_id,
          document_title: d.document_title,
          category_key: d.category_key,
          version_no: d.version_no,
          revision_code: d.revision_code,
          object_id: d.object_id,
          bucket: d.bucket,
          provider_version_id: d.provider_version_id,
          archive_path: `evidence/${d.version_id}`,
          object_key: d.object_key,
          mime: d.mime,
          size_bytes: d.size_bytes?.toString() || '0',
          sha256: d.sha256,
          file_status: d.file_status,
          review_status: d.review_status,
          issue_date: d.issue_date,
          expiry_date: d.expiry_date,
          uploaded_by: d.uploaded_by_name,
        })),
        assets: assetRows.map((a: any) => ({
          id: a.id,
          tag: a.tag,
          name: a.name,
          category_key: a.category_key,
          make: a.make,
          model: a.model,
          serial_no: a.serial_no,
          location: a.location,
          status: a.status,
          warranty_start: a.warranty_start,
          warranty_end: a.warranty_end,
          warranty_start_basis: a.warranty_start_basis,
          identity_revisions_count: parseInt(a.identity_revisions_count, 10),
        })),
        requirements: reqRows.map((r: any) => ({
          id: r.id,
          key: r.requirement_key,
          scope_key: r.scope_key,
          title: r.title,
          doc_type_key: r.doc_type_key,
          mandatory: r.mandatory,
          status: r.status,
          approved_version_id: r.current_approved_version_id,
        })),
        reviews: revRows.map((r: any) => ({
          id: r.id,
          document_version_id: r.document_version_id,
          method: r.method,
          external_method: r.external_method,
          external_approver: r.external_approver_name,
          external_reference: r.external_reference,
          status: r.status,
          decision: r.decision,
          comment: r.comment,
          decided_at: r.decided_at,
          occurred_at: r.occurred_at,
          occurred_at_precision: r.occurred_at_precision,
          recorded_at: r.recorded_at,
          backdating_reason: r.backdating_reason,
          reviewer_name: r.reviewer_name,
        })),
        packages: pkgRows.map((p: any) => ({
          id: p.id,
          version_no: p.version_no,
          status: p.status,
          checksum: p.checksum,
          snapshot_checksum: p.snapshot_checksum,
        })),
      };

      // Compute canonical digest of the manifest
      const manifestCanonicalJson = canonicalJson(manifest);
      const manifestSha256 = createHash('sha256').update(manifestCanonicalJson).digest('hex');

      const shouldIncludeArchive = options?.includeArchiveFile === true;
      const initialStatus = shouldIncludeArchive ? 'PENDING' : 'MANIFEST_ONLY';

      // Generate verification receipt
      const verificationReceipt = {
        receipt_id: uuidv7(),
        issued_at: exportedAt,
        schema_version: '2.0',
        project_id: projectId,
        project_code: proj.code,
        manifest_sha256: manifestSha256,
        total_objects: docRows.length,
        total_bytes: totalBytes.toString(),
        hash_algorithm: 'SHA-256',
        verifier_compatibility: 'TradeCloseout Offline Verifier v2.0',
        receipt_signature_basis: 'CANONICAL_MANIFEST_DIGEST',
        instructions: shouldIncludeArchive
          ? 'The archive is queued. After completion, extract it and open verify.html, then select the extracted folder. Digest checks establish consistency, not signer authenticity.'
          : 'This receipt covers the canonical manifest only. Verify each downloaded file against its listed SHA-256; no portable archive file is included.',
      };

      // Record archive export in database
      await client.query(
        `INSERT INTO archive_exports (
          id, org_id, project_id, schema_version, status,
          archive_sha256, total_objects, total_bytes, manifest_json,
          verification_receipt_json, created_by, created_at, completed_at
        ) VALUES ($1, $2, $3, '2.0', '${initialStatus}', NULL, $4, $5, $6, $7, $8, now(), NULL)`,
        [
          exportId,
          ctx.orgId,
          projectId,
          docRows.length,
          totalBytes.toString(),
          manifestCanonicalJson,
          JSON.stringify(verificationReceipt),
          ctx.userId,
        ],
      );

      if (shouldIncludeArchive) {
        emit({
          eventType: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
          projectId,
          entityType: 'PROJECT_ARCHIVE',
          entityId: exportId,
          afterJson: {
            exportId,
            orgId: ctx.orgId,
            projectId,
            manifestSha256,
            totalObjects: docRows.length,
            totalBytes: totalBytes.toString(),
          },
        });
      }

      emit({
        eventType: 'PROJECT_ARCHIVE_MANIFEST_CREATED',
        projectId,
        entityType: 'PROJECT_ARCHIVE',
        entityId: exportId,
        afterJson: {
          exportId,
          manifestSha256,
          totalObjects: docRows.length,
          totalBytes: totalBytes.toString(),
        },
      });

      return {
        exportId,
        status: initialStatus,
        portableArchiveReady: false,
        manifestSha256,
        totalObjects: docRows.length,
        totalBytes: totalBytes.toString(),
        manifest,
        verificationReceipt,
      };
    });
  }

  async listArchiveExports(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, schema_version, status, archive_sha256,
                total_objects, total_bytes, created_at, completed_at
         FROM archive_exports
         WHERE org_id = $1 AND project_id = $2
         ORDER BY created_at DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async getArchiveExport(ctx: TenantActorContext, projectId: string, exportId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM archive_exports WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, exportId],
      );
      if (!rows.length) {
        throw new NotFoundException('ARCHIVE_EXPORT_NOT_FOUND');
      }
      const record = rows[0];
      let downloadUrl: string | null = null;
      if (record.status === 'COMPLETED' && this.storage) {
        const artifact = record.verification_receipt_json?.artifact;
        // Security Invariant (V06 / F06): Require verified immutable artifact identity; forbid unversioned fallback
        if (!artifact?.objectId || !artifact?.objectKey || !isImmutableStorageVersion(artifact?.providerVersionId)) {
          throw new ConflictException({
            code: 'ARCHIVE_ARTIFACT_INTEGRITY_MISSING',
            detail: `Completed archive export ${exportId} lacks immutable artifact objectId, objectKey or providerVersionId.`,
          });
        }

        // F06: Query authoritative storage_objects row under tenant and verify status & immutable attributes
        const { rows: soRows } = await client.query(
          `SELECT id, org_id, bucket, object_key, provider_version_id, sha256, size_bytes, observed_size_bytes, status
             FROM storage_objects
            WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, artifact.objectId],
        );
        if (!soRows.length || soRows[0].status !== 'READY') {
          throw new ConflictException({
            code: 'ARCHIVE_STORAGE_INTEGRITY_MISMATCH',
            detail: `Archive storage object ${artifact.objectId} is not in verified READY status.`,
          });
        }

        const so = soRows[0];
        const expectedSha = record.archive_sha256 || artifact.sha256;
        const expectedSize = artifact.sizeBytes != null ? Number(artifact.sizeBytes) : null;
        const observedSize = so.observed_size_bytes != null ? Number(so.observed_size_bytes) : null;
        const declaredSize = so.size_bytes != null ? Number(so.size_bytes) : null;

        // Security Invariant (Gap 3 / PA12): READY row must possess non-null provider_version_id, bucket, key,
        // authoritative observed_size_bytes matching declared size_bytes, and matching sha
        if (
          !isImmutableStorageVersion(so.provider_version_id) ||
          !so.bucket ||
          !so.object_key ||
          !so.sha256 ||
          observedSize === null ||
          declaredSize === null ||
          observedSize !== declaredSize ||
          (artifact.bucket && so.bucket !== artifact.bucket) ||
          (so.object_key !== artifact.objectKey) ||
          (so.provider_version_id !== artifact.providerVersionId) ||
          (expectedSha && so.sha256 !== expectedSha) ||
          (expectedSize != null && observedSize !== expectedSize)
        ) {
          throw new ConflictException({
            code: 'ARCHIVE_STORAGE_INTEGRITY_MISMATCH',
            detail: `Archive storage object ${artifact.objectId} does not match verified export artifact attributes or lacks immutable versioning/observed size metadata.`,
          });
        }

        try {
          downloadUrl = await this.storage.createSignedDownloadUrl({
            objectKey: so.object_key,
            filename: `project-archive-${exportId.slice(0, 8)}.zip`,
            versionId: so.provider_version_id,
            bucket: so.bucket || artifact.bucket,
          });
        } catch {
          // If storage credentials are not available, downloadUrl remains null
        }
      }
      return {
        id: record.id,
        projectId: record.project_id,
        schemaVersion: record.schema_version,
        status: record.status,
        archiveSha256: record.archive_sha256,
        totalObjects: record.total_objects,
        totalBytes: record.total_bytes,
        downloadUrl,
        createdAt: record.created_at,
        completedAt: record.completed_at,
      };
    });
  }
}
