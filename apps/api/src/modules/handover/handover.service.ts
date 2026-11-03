import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, consumePlanQuota, TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { PackageBuilder, PackageMetadata } from '@tradecloseout/pdf-engine';

@Injectable()
export class HandoverService {
  constructor(private readonly pool: Pool) {}

  /**
   * API-118: GET /api/v1/projects/:id/readiness
   * Evaluates mandatory requirements, separating MISSING and EXPIRED blockers from EXPIRING warnings (FR-HND-008).
   */
  async evaluateProjectReadiness(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows: reqs } = await client.query(
        `SELECT r.id, r.requirement_key, r.title, r.mandatory, r.status, r.due_at,
                dv.expiry_date, dv.revision_code,
                a.tag AS asset_tag
           FROM requirements r
           LEFT JOIN document_requirements dr
             ON dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
           LEFT JOIN documents d
             ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
           LEFT JOIN document_versions dv
             ON dv.org_id = d.org_id AND dv.project_id = d.project_id AND dv.id = d.current_approved_version_id
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL`,
        [ctx.orgId, projectId],
      );

      const now = Date.now();
      const thirtyDaysMs = 30 * 86_400_000;

      const missingMandatory: any[] = [];
      const expiredMandatory: any[] = [];
      const expiringWarnings: any[] = [];

      for (const r of reqs) {
        const expTime = r.expiry_date ? new Date(r.expiry_date).getTime() : null;
        const isExpired = r.status === 'EXPIRED' || (expTime !== null && expTime < now);
        const isExpiringSoon = expTime !== null && expTime >= now && expTime <= now + thirtyDaysMs;

        if (isExpired && r.mandatory) {
          expiredMandatory.push(r);
        } else if (
          r.mandatory &&
          !['APPROVED', 'WAIVED', 'NOT_APPLICABLE', 'HANDED_OVER'].includes(r.status)
        ) {
          missingMandatory.push(r);
        } else if (isExpiringSoon) {
          expiringWarnings.push(r);
        }
      }

      return {
        readyWithoutOverride: missingMandatory.length === 0 && expiredMandatory.length === 0,
        blockers: {
          missingMandatoryCount: missingMandatory.length,
          expiredMandatoryCount: expiredMandatory.length,
          missingMandatory,
          expiredMandatory,
        },
        warnings: {
          expiringSoonCount: expiringWarnings.length,
          expiringWarnings,
        },
      };
    });
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
      overrideReason?: string;
      excludedRequirementIds?: Array<{ requirementId: string; reason: string }>;
    },
  ) {
    const readiness = await this.evaluateProjectReadiness(ctx, projectId);
    if (!readiness.readyWithoutOverride && !input.overrideReason?.trim()) {
      throw new UnprocessableEntityException({
        code: 'READINESS_BLOCKERS_PRESENT',
        title: 'Mandatory requirements are missing or expired',
        detail:
          'Resolve missing/expired mandatory items or provide a mandatory overrideReason to generate anyway (FR-HND-008).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      await consumePlanQuota(client, ctx.orgId, 'PACKAGE_GENERATIONS', currentMonth, 1n, 50n);

      const { rows: snapRows } = await client.query(
        `SELECT id, checksum FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (snapRows.length === 0) {
        throw new UnprocessableEntityException({
          code: 'NO_ACTIVE_SNAPSHOT',
          detail: 'Project has no active checklist snapshot.',
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
           override_reason, requested_by)
         VALUES ($1, $2, $3, $4, 'QUEUED', $5, $6, $7, $8)`,
        [
          packageId,
          ctx.orgId,
          projectId,
          nextVersionNo,
          activeSnapshot.id,
          activeSnapshot.checksum,
          input.overrideReason?.trim() ?? null,
          ctx.userId,
        ],
      );

      // Snapshot requirement states into package_requirements (AUD-008)
      const { rows: reqRows } = await client.query(
        `SELECT r.id, r.requirement_key, r.scope_key, r.title, r.doc_type_key,
                r.mandatory, r.status, r.due_at,
                d.current_approved_version_id,
                a.tag AS asset_tag
           FROM requirements r
           LEFT JOIN document_requirements dr
             ON dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
           LEFT JOIN documents d
             ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
          ORDER BY r.group_key, r.requirement_key`,
        [ctx.orgId, projectId],
      );

      const exclusionMap = new Map(
        (input.excludedRequirementIds ?? []).map((e) => [e.requirementId, e.reason]),
      );

      let sortOrder = 1;
      for (const req of reqRows) {
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
            req.status,
            req.due_at,
            req.asset_tag ?? null,
          ],
        );

        if (req.current_approved_version_id) {
          const exclReason = exclusionMap.get(req.id);
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
              req.current_approved_version_id,
              req.doc_type_key,
              sortOrder++,
              !exclReason,
              exclReason ?? null,
            ],
          );
        }
      }

      emit({
        eventType: 'HANDOVER_PACKAGE_QUEUED',
        projectId,
        entityType: 'HANDOVER_PACKAGE',
        entityId: packageId,
        afterJson: {
          versionNo: nextVersionNo,
          snapshotChecksum: activeSnapshot.checksum,
          overrideReason: input.overrideReason ?? null,
        },
      });

      return {
        packageId,
        versionNo: nextVersionNo,
        status: 'QUEUED',
        snapshotChecksum: activeSnapshot.checksum,
      };
    });
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
    if (input.decision !== 'ACCEPT' && (!input.remarks || input.remarks.trim().length < 5)) {
      throw new UnprocessableEntityException({
        code: 'REMARKS_REQUIRED',
        detail: 'Remarks are required when accepting with exceptions or rejecting a package (SCR-031).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      await client.query(
        `UPDATE submission_recipients
            SET status = $5,
                decision = $5,
                remarks = $6,
                decided_at = now()
          WHERE org_id = $1 AND project_id = $2
            AND submission_id = $3 AND recipient_party_id = $4`,
        [
          ctx.orgId,
          projectId,
          submissionId,
          input.recipientPartyId,
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
            projectId,
            ctx.userId,
            `Client handover decision (${input.decision}): ${input.remarks}`,
            JSON.stringify(input.exceptionItems ?? [{ note: input.remarks }]),
          ],
        );
      }

      const nextSubStatus = input.decision === 'REJECT' ? 'REJECTED' : 'ACCEPTED';
      await client.query(
        `UPDATE submissions
            SET status = $3, decided_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $4`,
        [ctx.orgId, projectId, nextSubStatus, submissionId],
      );

      emit({
        eventType: `SUBMISSION_${nextSubStatus}`,
        projectId,
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
                a.tag AS asset_tag
           FROM requirements r
           JOIN document_requirements dr
             ON dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
           JOIN documents d
             ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
           JOIN document_versions dv
             ON dv.org_id = d.org_id AND dv.project_id = d.project_id AND dv.id = d.current_approved_version_id
           JOIN storage_objects so
             ON so.id = dv.object_id
           LEFT JOIN assets a
             ON r.scope_key = ('asset:' || a.id::text) AND a.org_id = r.org_id AND a.project_id = r.project_id
          WHERE r.org_id = $1 AND r.project_id = $2
            AND r.milestone_key = $3
            AND r.superseded_at IS NULL
            AND dv.file_status = 'READY'
            AND dv.review_status = 'APPROVED'
          ORDER BY r.group_key, r.requirement_key`,
        [ctx.orgId, projectId, input.milestoneKey],
      );

      const { rows: snapRows } = await client.query(
        `SELECT id, checksum FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const snapshotId = snapRows[0]?.id || null;
      const snapshotChecksum = snapRows[0]?.checksum || 'GENESIS_CHECKSUM';

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
           override_reason, requested_by)
         VALUES ($1, $2, $3, $4, 'READY', $5, $6, $7, $8)`,
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

      emit({
        eventType: 'RA_BILL_EVIDENCE_PACK_COMPILED',
        projectId,
        entityType: 'HANDOVER_PACKAGE',
        entityId: packageId,
        afterJson: {
          packageId,
          milestoneKey: input.milestoneKey,
          billNumber: input.billNumber,
          billAmountInr: input.billAmountInr,
          includedDocumentsCount: milestoneReqs.length,
        },
      });

      return {
        packageId,
        versionNo: nextVersionNo,
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
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      let packageId = dto.packageId;
      if (!packageId) {
        const { rows: latestPkg } = await client.query(
          `SELECT id FROM handover_packages WHERE org_id = $1 AND project_id = $2 ORDER BY version_no DESC LIMIT 1`,
          [ctx.orgId, projectId],
        );
        if (!latestPkg.length) {
          throw new NotFoundException('No compiled package found for project');
        }
        packageId = latestPkg[0].id;
      }

      const submissionId = uuidv7();
      await client.query(
        `INSERT INTO submissions (id, org_id, project_id, package_id, status, submitted_by, submitted_at, cover_note)
         VALUES ($1, $2, $3, $4, 'SUBMITTED', $5, now(), $6)`,
        [submissionId, ctx.orgId, projectId, packageId, ctx.userId, dto.coverNote || null],
      );

      for (const rec of dto.recipients) {
        await client.query(
          `INSERT INTO submission_recipients
             (id, org_id, project_id, submission_id, party_id, name, email, role, is_required_approver, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SENT')`,
          [
            uuidv7(),
            ctx.orgId,
            projectId,
            submissionId,
            rec.partyId || null,
            rec.name,
            rec.email,
            rec.role || 'CLIENT',
            rec.isRequiredApprover ?? true,
          ],
        );
      }

      emit({
        eventType: 'SUBMISSION_DISPATCHED',
        projectId,
        entityType: 'SUBMISSION',
        entityId: submissionId,
        afterJson: { packageId, recipientCount: dto.recipients.length },
      });

      return {
        submissionId,
        packageId,
        status: 'SUBMITTED',
        recipientsCount: dto.recipients.length,
      };
    });
  }

  async generateDossierPdf(ctx: TenantActorContext, projectId: string): Promise<Uint8Array> {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      const proj = projRes.rows[0];

      const reqRes = await client.query(
        `SELECT * FROM requirements WHERE org_id = $1 AND project_id = $2 AND superseded_at IS NULL ORDER BY created_at ASC`,
        [ctx.orgId, projectId],
      );

      const itemsWithPages = reqRes.rows.map((r: any, idx: number) => ({
        itemId: r.id,
        documentTitle: r.title,
        docTypeKey: r.doc_type_key || 'DT-001',
        revisionCode: 'R1',
        issueDate: new Date().toISOString().split('T')[0],
        filePath: '',
        sortOrder: idx + 1,
        pageStart: idx * 2 + 3,
        pageEnd: idx * 2 + 4,
      }));

      const meta: PackageMetadata = {
        packageId: uuidv7(),
        packageTitle: 'Statutory & Technical Handover Dossier',
        projectCode: proj.code,
        projectName: proj.name,
        clientName: proj.site_json?.client_name || 'Project Authority',
        contractorName: proj.site_json?.contractor_name || 'Main MEP Contractor',
        generatedAt: new Date(),
      };

      return PackageBuilder.generateFrontMatterPdf(meta, itemsWithPages);
    });
  }
}
