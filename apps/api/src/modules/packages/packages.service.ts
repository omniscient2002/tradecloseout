// apps/api/src/modules/packages/packages.service.ts
// Multi-recipient submission aggregation & package management (RT-007)

import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { SubmissionRecipientDecision, SubmissionStatus, PackageStatus } from '@tradecloseout/shared';

@Injectable()
export class PackagesService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-117 POST /submissions/:id/recipients/:recipientId/decision (RT-007)
   */
  async recordRecipientDecision(
    ctx: ExecutionContext,
    submissionId: string,
    recipientId: string,
    decision: 'ACCEPT' | 'ACCEPT_WITH_EXCEPTIONS' | 'REJECT',
    comment?: string,
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Update recipient record
      const updateRes = await client.query(
        `UPDATE submission_recipients
         SET decision = $1, decided_at = now()
         WHERE org_id = $2 AND submission_id = $3 AND id = $4
         RETURNING *`,
        [decision, ctx.orgId, submissionId, recipientId],
      );

      if (!updateRes.rows.length) {
        throw new NotFoundException('RECIPIENT_NOT_FOUND');
      }

      // 2. Fetch all recipients for this submission
      const allRecipients = await client.query(
        `SELECT * FROM submission_recipients WHERE org_id = $1 AND submission_id = $2`,
        [ctx.orgId, submissionId],
      );

      const requiredRecipients = allRecipients.rows.filter((r) => r.is_required_approver === true);

      let nextSubmissionStatus: SubmissionStatus;
      let nextPackageStatus: PackageStatus;

      const anyRequiredRejected = requiredRecipients.some((r) => r.decision === 'REJECT');
      const allRequiredAccepted = requiredRecipients.length > 0 && requiredRecipients.every(
        (r) => r.decision === 'ACCEPT' || r.decision === 'ACCEPT_WITH_EXCEPTIONS',
      );
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

      // 3. Update submission status
      const subRes = await client.query(
        `UPDATE submissions
         SET status = $1, decided_at = CASE WHEN $1 IN ('ACCEPTED', 'REJECTED') THEN now() ELSE decided_at END,
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
}
