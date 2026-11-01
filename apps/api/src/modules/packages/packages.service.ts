// apps/api/src/modules/packages/packages.service.ts
// Multi-recipient submission aggregation, readiness checks & Bates compilation (RT-007, CB-006, AUD-P-16, FR-HND-001..021)

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { SubmissionStatus, PackageStatus } from '@tradecloseout/shared';
import { PackageBuilder, PackageMetadata } from '@tradecloseout/pdf-engine';

export interface CreatePackageDto {
  title?: string;
  scopeFilter?: Record<string, any>;
  batesPrefix?: string;
  coverStyle?: string;
}

export interface SubmitPackageDto {
  recipients: Array<{
    partyId?: string;
    email: string;
    name: string;
    isRequiredApprover?: boolean;
    role?: string;
  }>;
  coverNote?: string;
}

@Injectable()
export class PackagesService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-118 GET /projects/:projectId/packages/readiness
   * Readiness check separating MISSING and EXPIRED from EXPIRING (FR-HND-008).
   */
  async checkReadiness(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const reqRes = await client.query(
        `SELECT r.id, r.requirement_key, r.title, r.status, r.mandatory,
                dv.id AS version_id, dv.revision_code, dv.review_status,
                dv.expiry_date
           FROM requirements r
           LEFT JOIN document_requirements dr ON dr.requirement_id = r.id
           LEFT JOIN documents d ON d.id = dr.document_id
           LEFT JOIN document_versions dv ON dv.id = d.current_approved_version_id
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL`,
        [ctx.orgId, projectId],
      );

      const allReqs = reqRes.rows;
      const now = new Date();
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const missing: any[] = [];
      const expired: any[] = [];
      const expiring: any[] = [];
      const satisfied: any[] = [];

      for (const req of allReqs) {
        if (req.status === 'WAIVED') {
          satisfied.push(req);
          continue;
        }

        if (req.status === 'APPROVED' && req.version_id) {
          if (req.expiry_date && new Date(req.expiry_date) < now) {
            expired.push(req);
          } else if (req.expiry_date && new Date(req.expiry_date) <= in30Days) {
            expiring.push(req);
            satisfied.push(req);
          } else {
            satisfied.push(req);
          }
        } else if (req.mandatory) {
          missing.push(req);
        }
      }

      const isReady = missing.length === 0 && expired.length === 0;

      return {
        isReady,
        stats: {
          total: allReqs.length,
          satisfiedCount: satisfied.length,
          missingCount: missing.length,
          expiredCount: expired.length,
          expiringCount: expiring.length,
        },
        items: {
          missing,
          expired,
          expiring,
        },
      };
    });
  }

  /**
   * API-110 POST /projects/:projectId/packages
   * Creates a draft handover package.
   */
  async createDraftPackage(ctx: ExecutionContext, projectId: string, dto: CreatePackageDto) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const packageId = uuidv7();
      const title = dto.title || 'Statutory & Technical Handover Dossier';

      const res = await client.query(
        `INSERT INTO handover_packages (
          id, org_id, project_id, title, status, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, now(), now())
        RETURNING *`,
        [packageId, ctx.orgId, projectId, title, ctx.userId],
      );

      return res.rows[0];
    });
  }

  /**
   * API-111 GET /packages/:id
   */
  async getPackage(ctx: ExecutionContext, packageId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const pkgRes = await client.query(
        `SELECT * FROM handover_packages WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, packageId],
      );
      if (!pkgRes.rows.length) {
        throw new NotFoundException('PACKAGE_NOT_FOUND');
      }
      return pkgRes.rows[0];
    });
  }

  /**
   * API-114 POST /packages/:id/submit
   * Submits a handover package to multi-recipient approvers (WF-17, FR-HND-019).
   */
  async submitPackage(ctx: ExecutionContext, packageId: string, dto: SubmitPackageDto) {
    if (!dto.recipients || dto.recipients.length === 0) {
      throw new BadRequestException('At least one recipient is required for submission');
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const pkgRes = await client.query(
        `SELECT * FROM handover_packages WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, packageId],
      );
      if (!pkgRes.rows.length) {
        throw new NotFoundException('PACKAGE_NOT_FOUND');
      }
      const pkg = pkgRes.rows[0];

      const submissionId = uuidv7();
      await client.query(
        `INSERT INTO submissions (
          id, org_id, project_id, package_id, status, submitted_by, submitted_at, cover_note
        ) VALUES ($1, $2, $3, $4, 'SENT', $5, now(), $6)`,
        [submissionId, ctx.orgId, pkg.project_id, packageId, ctx.userId, dto.coverNote || null],
      );

      for (const r of dto.recipients) {
        const recipientId = uuidv7();
        await client.query(
          `INSERT INTO submission_recipients (
            id, org_id, submission_id, party_id, email, name, role, is_required_approver, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
          [
            recipientId,
            ctx.orgId,
            submissionId,
            r.partyId || null,
            r.email,
            r.name,
            r.role || 'R-CLIENT',
            r.isRequiredApprover ?? true,
          ],
        );
      }

      await client.query(
        `UPDATE handover_packages SET status = 'SUBMITTED', updated_at = now() WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, packageId],
      );

      return {
        submissionId,
        packageId,
        status: 'SENT',
        recipientCount: dto.recipients.length,
      };
    });
  }

  /**
   * API-117 POST /submissions/:id/recipients/:recipientId/decision (RT-007, CB-006, AUD-P-16)
   */
  async recordRecipientDecision(
    ctx: ExecutionContext,
    submissionId: string,
    recipientId: string,
    decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT',
    comment?: string,
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Update recipient record with status, decision, remarks, and decided_at (CB-006)
      const recipientStatus =
        decision === 'REJECT'
          ? 'REJECTED'
          : decision === 'ACCEPT_WITH_EXCEPTIONS'
            ? 'ACCEPTED_WITH_EXCEPTIONS'
            : 'ACCEPTED';

      const updateRes = await client.query(
        `UPDATE submission_recipients
         SET status = $1, decision = $2, remarks = $3, decided_at = now()
         WHERE org_id = $4 AND submission_id = $5 AND id = $6
         RETURNING *`,
        [recipientStatus, decision, comment || null, ctx.orgId, submissionId, recipientId],
      );

      if (!updateRes.rows.length) {
        throw new NotFoundException('RECIPIENT_NOT_FOUND');
      }

      // 2. AUD-P-16: When client records ACCEPT_WITH_EXCEPTIONS or REJECT, write back exception
      if ((decision === 'ACCEPT_WITH_EXCEPTIONS' || decision === 'REJECT') && comment) {
        const subInfo = await client.query(
          `SELECT project_id FROM submissions WHERE org_id = $1 AND id = $2`,
          [ctx.orgId, submissionId],
        );
        const projectId = subInfo.rows[0]?.project_id;
        if (projectId) {
          await client.query(
            `INSERT INTO requirement_change_requests (
              id, org_id, project_id, title, justification, change_type, status, requested_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, 'CLIENT_EXCEPTION', 'SUBMITTED', $6, now())`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              `Submission Exception: ${comment.substring(0, 50)}`,
              `Client logged ${decision} remark: ${comment}`,
              ctx.userId,
            ],
          );
        }
      }

      // 3. Fetch all recipients for this submission
      const allRecipients = await client.query(
        `SELECT * FROM submission_recipients WHERE org_id = $1 AND submission_id = $2`,
        [ctx.orgId, submissionId],
      );

      const requiredRecipients = allRecipients.rows.filter((r) => r.is_required_approver === true);

      let nextSubmissionStatus: SubmissionStatus;
      let nextPackageStatus: PackageStatus;

      const anyRequiredRejected = requiredRecipients.some((r) => r.decision === 'REJECT');
      const allRequiredAccepted =
        requiredRecipients.length > 0 &&
        requiredRecipients.every((r) => r.decision === 'ACCEPT' || r.decision === 'ACCEPT_WITH_EXCEPTIONS');
      const someAccepted = allRecipients.rows.some(
        (r) => r.decision === 'ACCEPT' || r.decision === 'ACCEPT_WITH_EXCEPTIONS',
      );

      if (anyRequiredRejected) {
        nextSubmissionStatus = SubmissionStatus.REJECTED;
        nextPackageStatus = PackageStatus.REJECTED;
      } else if (allRequiredAccepted) {
        nextSubmissionStatus = SubmissionStatus.ACCEPTED;
        nextPackageStatus = PackageStatus.ACCEPTED;
      } else if (someAccepted) {
        nextSubmissionStatus = SubmissionStatus.PARTIALLY_ACCEPTED;
        nextPackageStatus = PackageStatus.PARTIALLY_ACCEPTED;
      } else {
        nextSubmissionStatus = SubmissionStatus.SENT;
        nextPackageStatus = PackageStatus.SUBMITTED;
      }

      // 4. Update submission status with updated_at (CB-006)
      const subRes = await client.query(
        `UPDATE submissions
         SET status = $1,
             decided_at = CASE WHEN $1 IN ('ACCEPTED', 'REJECTED') THEN now() ELSE decided_at END,
             updated_at = now()
         WHERE org_id = $2 AND id = $3
         RETURNING package_id`,
        [nextSubmissionStatus, ctx.orgId, submissionId],
      );

      const packageId = subRes.rows[0]?.package_id;
      if (packageId) {
        await client.query(
          `UPDATE handover_packages
           SET status = $1, updated_at = now()
           WHERE org_id = $2 AND id = $3`,
          [nextPackageStatus, ctx.orgId, packageId],
        );
      }

      return {
        submissionStatus: nextSubmissionStatus,
        packageStatus: nextPackageStatus,
        decision,
      };
    });
  }

  /**
   * Generates pure-Node front matter and TOC PDF for Handover Dossier
   */
  async generateDossierPdf(ctx: ExecutionContext, projectId: string): Promise<Uint8Array> {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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

      const itemsWithPages = reqRes.rows.map((r, idx) => ({
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
