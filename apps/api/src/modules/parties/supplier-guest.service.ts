import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { projectGuestVisiblePayload } from '@tradecloseout/shared/permissions';

@Injectable()
export class SupplierGuestService {
  constructor(private readonly pool: Pool) {}

  /**
   * API-027: POST /api/v1/projects/:projectId/supplier-links
   * Generates a scoped, revocable supplier upload link for 1..20 assigned requirements (WF-08).
   */
  async createScopedSupplierUploadLink(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      supplierPartyId: string;
      requirementIds: string[];
      expiresInDays?: number;
      otpRequired?: boolean;
    },
  ) {
    if (!input.requirementIds || input.requirementIds.length === 0 || input.requirementIds.length > 20) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'A supplier upload link must be scoped to between 1 and 20 requirements (05 §6.3).',
      });
    }

    const expiryDays = Math.min(Math.max(input.expiresInDays ?? 30, 1), 90);
    const otpRequired = true;

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // Verify all requirementIds belong to this project and assign supplier party
      const { rows: validReqs } = await client.query(
        `SELECT id, requirement_key, title
           FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])
            AND superseded_at IS NULL
          FOR UPDATE`,
        [ctx.orgId, projectId, input.requirementIds],
      );

      if (validReqs.length !== input.requirementIds.length) {
        throw new UnprocessableEntityException({
          code: 'INVALID_REQUIREMENT_SCOPE',
          detail: 'One or more requirement IDs do not belong to this project.',
        });
      }

      await client.query(
        `UPDATE requirements
            SET owner_party_id = $4,
                status = CASE WHEN status = 'NOT_STARTED' THEN 'REQUESTED' ELSE status END,
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`,
        [ctx.orgId, projectId, input.requirementIds, input.supplierPartyId],
      );

      const { rows: partyRows } = await client.query(
        `SELECT email, COALESCE(phone_e164, phone) AS phone, status, deleted_at
           FROM parties WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, input.supplierPartyId],
      );
      const party = partyRows[0];
      if (!party || party.status !== 'ACTIVE' || party.deleted_at) {
        throw new NotFoundException('ACTIVE_SUPPLIER_PARTY_NOT_FOUND');
      }
      const targetEmail = party.email?.trim() || null;
      const targetPhone = party.phone?.trim() || null;
      if (!targetEmail && !targetPhone) {
        throw new UnprocessableEntityException({
          code: 'SUPPLIER_VERIFIED_CONTACT_REQUIRED',
          detail: 'Add a supplier email or phone before issuing an OTP-protected upload link.',
        });
      }

      const rawToken = randomBytes(24).toString('hex'); // 192-bit entropy (>= 128-bit requirement)
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const grantId = uuidv7();

      await client.query(
        `INSERT INTO guest_grants
          (id, org_id, project_id, party_id, target_email, target_phone_e164, role, grant_type, capabilities,
           scope_json, otp_required, token_hash, expires_at, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'R-SUPPLIER-OEM', 'SUPPLIER_UPLOAD',
                 ARRAY['document.upload'], $7, $8, $9,
                 now() + ($10 || ' days')::interval, 'ACTIVE', $11)`,
        [
          grantId,
          ctx.orgId,
          projectId,
          input.supplierPartyId,
          targetEmail,
          targetPhone,
          JSON.stringify({ requirementIds: input.requirementIds, workflowQueue: 'SUPPLIER_QUARANTINE_REVIEW' }),
          otpRequired,
          tokenHash,
          String(expiryDays),
          ctx.userId,
        ],
      );

      emit({
        eventType: 'SUPPLIER_UPLOAD_LINK_CREATED',
        projectId,
        entityType: 'GUEST_GRANT',
        entityId: grantId,
        afterJson: {
          supplierPartyId: input.supplierPartyId,
          requirementCount: input.requirementIds.length,
          otpRequired,
          expiryDays,
        },
      });

      const guestUrl = `${process.env.PUBLIC_APP_URL || 'https://app.tradecloseout.com'}/guest/${rawToken}`;
      const shareMessage = `Please upload the requested HVAC project documents via this secure link: ${guestUrl}`;

      return {
        grantId,
        guestUrl,
        projectPin: 'OTP required',
        whatsappDeepLink: `https://wa.me/?text=${encodeURIComponent(shareMessage)}`,
        otpRequired,
      };
    });
  }

  /**
   * Enforces FR-DOC-032 & AUD-P-15 when a Guest Supplier opens or uploads to a link.
   * Rejects any unassigned requirement with the exact list of assigned requirements.
   */
  async verifyGuestSupplierScope(
    rawToken: string,
    targetRequirementId?: string,
  ) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const client = await this.pool.connect();
    try {
      const { rows: grantRows } = await client.query(
        `SELECT id AS grant_id, org_id, project_id, party_id, role, scope_json, otp_required, expires_at, status
           FROM guest_grants
          WHERE token_hash = $1
          LIMIT 1`,
        [tokenHash],
      );

      if (grantRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Guest link is invalid.' });
      }
      const grant = grantRows[0];

      if (grant.status !== 'ACTIVE' || new Date(grant.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException({
          code: 'GUEST_LINK_EXPIRED',
          title: 'Upload link has expired or been revoked',
          detail: 'Ask contractor for a new upload link (11 §4.12).',
        });
      }

      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [grant.org_id]);

      const { rows: metaRows } = await client.query(
        `SELECT o.display_name AS contractor_name, op.brand_color, p.name AS project_name, p.code AS project_code
           FROM organisations o
           LEFT JOIN org_profiles op ON op.org_id = o.id
           LEFT JOIN projects p ON p.org_id = o.id AND p.id = $2
          WHERE o.id = $1`,
        [grant.org_id, grant.project_id],
      );

      const allowedRequirementIds: string[] = Array.isArray(grant.scope_json?.requirementIds)
        ? grant.scope_json.requirementIds
        : [];

      // Fetch only the assigned requirements for this link (AUD-P-15)
      const { rows: assignedReqs } = await client.query(
        `SELECT id, requirement_key, title, doc_type_key, status, due_at
           FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])
            AND superseded_at IS NULL`,
        [grant.org_id, grant.project_id, allowedRequirementIds],
      );

      await client.query('COMMIT');

      // FR-DOC-032: Reject unassigned upload attempts with the list of available requirements
      if (targetRequirementId && !allowedRequirementIds.includes(targetRequirementId)) {
        throw new ForbiddenException({
          code: 'UNASSIGNED_SUPPLIER_REQUIREMENT',
          message: 'UNASSIGNED_SUPPLIER_REQUIREMENT: Requirement not assigned to this supplier link',
          title: 'Requirement not assigned to this supplier link',
          detail: 'Uploads via this link are restricted to your assigned requirements (FR-DOC-032).',
          fieldErrors: assignedReqs.map((r) => ({
            field: r.id,
            message: `${r.requirement_key}: ${r.title}`,
          })),
        });
      }

      const meta = metaRows[0] || {};
      return {
        grantId: grant.grant_id,
        orgId: grant.org_id,
        projectId: grant.project_id,
        contractorName: meta.contractor_name,
        brandColor: meta.brand_color,
        projectName: meta.project_name,
        otpRequired: grant.otp_required,
        assignedRequirements: assignedReqs.map((r) =>
          projectGuestVisiblePayload(r, grant.role),
        ),
      };
    } finally {
      client.release();
    }
  }
}
