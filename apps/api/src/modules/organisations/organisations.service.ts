// apps/api/src/modules/organisations/organisations.service.ts
// Organisations Service (API-010..019, FR-ORG, WF-21, AUD-P-12, FR-ORG-014)

import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash, randomBytes } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { isValidIndianGstin, IndianPanSchema } from '@tradecloseout/shared';

@Injectable()
export class OrganisationsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-010: GET /orgs/:orgId
   */
  async getOrganisation(ctx: ExecutionContext, orgId: string) {
    if (orgId !== ctx.orgId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Organisation not found',
        detail: 'The requested organisation resource was not found in your active scope.',
      });
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const orgRes = await client.query(
        `SELECT id, legal_name, display_name, entity_type, status, country, state, gstin, pan, row_version, created_at, updated_at
           FROM organisations WHERE id = $1 LIMIT 1`,
        [orgId],
      );

      if (!orgRes.rows.length) {
        throw new NotFoundException('ORGANISATION_NOT_FOUND');
      }

      const profileRes = await client.query(
        `SELECT logo_url, accent_color, watermark_enabled, allow_self_approval, default_retention_months
           FROM org_profiles WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );

      return {
        ...orgRes.rows[0],
        profile: profileRes.rows[0] ?? null,
      };
    });
  }

  /**
   * API-011: PATCH /orgs/:orgId
   */
  async updateOrganisation(
    ctx: ExecutionContext,
    orgId: string,
    dto: {
      legalName?: string;
      displayName?: string;
      state?: string;
      gstin?: string;
      pan?: string;
      logoUrl?: string;
      accentColor?: string;
      watermarkEnabled?: boolean;
      allowSelfApproval?: boolean;
      defaultRetentionMonths?: number;
    },
  ) {
    if (orgId !== ctx.orgId) {
      throw new NotFoundException('ORGANISATION_NOT_FOUND');
    }

    // Validate GSTIN checksum if provided (FR-ORG-005)
    if (dto.gstin) {
      const trimmedGstin = dto.gstin.trim().toUpperCase();
      if (!isValidIndianGstin(trimmedGstin)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_GSTIN',
          title: 'Invalid Indian GSTIN',
          detail: 'The provided GSTIN fails Modulo-36 checksum or structural validation.',
        });
      }
      dto.gstin = trimmedGstin;
    }

    // Validate PAN if provided (FR-ORG-006)
    if (dto.pan) {
      const trimmedPan = dto.pan.trim().toUpperCase();
      const panRes = IndianPanSchema.safeParse(trimmedPan);
      if (!panRes.success) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PAN',
          title: 'Invalid Indian PAN',
          detail: 'Provide a valid 10-character alphanumeric Indian PAN.',
        });
      }
      dto.pan = trimmedPan;
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const orgRes = await client.query(
        `UPDATE organisations
            SET legal_name = COALESCE($1, legal_name),
                display_name = COALESCE($2, display_name),
                state = COALESCE($3, state),
                gstin = COALESCE($4, gstin),
                pan = COALESCE($5, pan),
                row_version = row_version + 1,
                updated_at = now()
          WHERE id = $6
          RETURNING *`,
        [dto.legalName, dto.displayName, dto.state, dto.gstin, dto.pan, orgId],
      );

      if (
        dto.logoUrl !== undefined ||
        dto.accentColor !== undefined ||
        dto.watermarkEnabled !== undefined ||
        dto.allowSelfApproval !== undefined ||
        dto.defaultRetentionMonths !== undefined
      ) {
        await client.query(
          `INSERT INTO org_profiles (org_id, logo_url, accent_color, watermark_enabled, allow_self_approval, default_retention_months)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (org_id) DO UPDATE SET
             logo_url = COALESCE($2, org_profiles.logo_url),
             accent_color = COALESCE($3, org_profiles.accent_color),
             watermark_enabled = COALESCE($4, org_profiles.watermark_enabled),
             allow_self_approval = COALESCE($5, org_profiles.allow_self_approval),
             default_retention_months = COALESCE($6, org_profiles.default_retention_months),
             updated_at = now()`,
          [
            orgId,
            dto.logoUrl ?? null,
            dto.accentColor ?? null,
            dto.watermarkEnabled ?? null,
            dto.allowSelfApproval ?? null,
            dto.defaultRetentionMonths ?? null,
          ],
        );
      }

      return orgRes.rows[0];
    });
  }

  /**
   * API-012: GET /orgs/:orgId/members
   */
  async listMembers(ctx: ExecutionContext, orgId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const membersRes = await client.query(
        `SELECT m.id, m.user_id, m.role, m.status, m.joined_at, u.name,
                (SELECT value FROM user_identities WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1) AS identifier
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1
          ORDER BY m.created_at ASC`,
        [orgId],
      );

      const invRes = await client.query(
        `SELECT id, email, role, status, expires_at, created_at
           FROM invitations
          WHERE org_id = $1 AND status = 'PENDING'
          ORDER BY created_at DESC`,
        [orgId],
      );

      return {
        members: membersRes.rows,
        pendingInvitations: invRes.rows,
      };
    });
  }

  /**
   * API-013: POST /orgs/:orgId/invitations
   */
  async createInvitation(
    ctx: ExecutionContext,
    orgId: string,
    dto: { email: string; role: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');
    const email = dto.email.trim().toLowerCase();

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Check existing active membership
      const existingRes = await client.query(
        `SELECT m.id FROM memberships m
           JOIN user_identities i ON i.user_id = m.user_id
          WHERE m.org_id = $1 AND i.value = $2 AND m.status = 'ACTIVE' LIMIT 1`,
        [orgId, email],
      );

      if (existingRes.rows.length) {
        throw new ConflictException({
          code: 'MEMBER_ALREADY_EXISTS',
          title: 'Member already belongs to organisation',
          detail: 'This user already holds an active membership in this organisation.',
        });
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const invId = uuidv7();

      const res = await client.query(
        `INSERT INTO invitations (id, org_id, email, role, token_hash, status, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '7 days', $6)
         RETURNING id, email, role, status, expires_at, created_at`,
        [invId, orgId, email, dto.role, tokenHash, ctx.userId],
      );

      return {
        ...res.rows[0],
        invitationToken: rawToken,
      };
    });
  }

  /**
   * API-014: DELETE /orgs/:orgId/invitations/:id
   */
  async revokeInvitation(ctx: ExecutionContext, orgId: string, invitationId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE invitations
            SET status = 'REVOKED', updated_at = now()
          WHERE org_id = $1 AND id = $2 AND status = 'PENDING'
          RETURNING id, status`,
        [orgId, invitationId],
      );

      if (!res.rows.length) {
        throw new NotFoundException('INVITATION_NOT_FOUND');
      }

      return res.rows[0];
    });
  }

  /**
   * API-015: PATCH /orgs/:orgId/members/:userId
   */
  async updateMemberRole(
    ctx: ExecutionContext,
    orgId: string,
    targetUserId: string,
    dto: { role: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Check if demoting the only active R-OWNER (AUD-P-12)
      if (dto.role !== 'R-OWNER') {
        const ownerRes = await client.query(
          `SELECT user_id FROM memberships
            WHERE org_id = $1 AND role = 'R-OWNER' AND status = 'ACTIVE'`,
          [orgId],
        );
        if (ownerRes.rows.length === 1 && ownerRes.rows[0].user_id === targetUserId) {
          throw new ConflictException({
            code: 'LAST_OWNER_DEMOTION_BLOCKED',
            title: 'Cannot demote last Owner',
            detail: 'An organisation must have at least one active Owner. Transfer ownership first.',
          });
        }
      }

      const res = await client.query(
        `UPDATE memberships
            SET role = $1, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $2 AND user_id = $3 AND status = 'ACTIVE'
          RETURNING *`,
        [dto.role, orgId, targetUserId],
      );

      if (!res.rows.length) {
        throw new NotFoundException('MEMBERSHIP_NOT_FOUND');
      }

      return res.rows[0];
    });
  }

  /**
   * API-018: GET /orgs/:orgId/members/:userId/offboarding-gap-report (WF-21)
   */
  async getOffboardingGapReport(ctx: ExecutionContext, orgId: string, targetUserId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Open reviews owned or assigned
      const reviewRes = await client.query(
        `SELECT r.id, r.project_id, r.stage_key, r.status
           FROM reviews r
          WHERE r.org_id = $1 AND r.reviewer_subject_id = $2 AND r.status IN ('PENDING', 'IN_REVIEW')`,
        [orgId, targetUserId],
      );

      // 2. Pending waivers waiting for second approval requested by this user
      const waiverRes = await client.query(
        `SELECT w.id, w.requirement_id, w.status
           FROM waivers w
           JOIN requirements req ON req.id = w.requirement_id
          WHERE req.org_id = $1 AND w.created_by = $2 AND w.status = 'PENDING_SECOND_APPROVAL'`,
        [orgId, targetUserId],
      );

      // 3. Is user the sole active owner?
      const ownersRes = await client.query(
        `SELECT user_id FROM memberships
          WHERE org_id = $1 AND role = 'R-OWNER' AND status = 'ACTIVE'`,
        [orgId],
      );
      const isSoleOwner = ownersRes.rows.length === 1 && ownersRes.rows[0].user_id === targetUserId;

      const openReviews = reviewRes.rows;
      const pendingWaivers = waiverRes.rows;
      const canOffboard = !isSoleOwner && openReviews.length === 0 && pendingWaivers.length === 0;

      return {
        targetUserId,
        isSoleOwner,
        openReviewsCount: openReviews.length,
        openReviews,
        pendingWaiversCount: pendingWaivers.length,
        pendingWaivers,
        canOffboard,
      };
    });
  }

  /**
   * API-016: DELETE /orgs/:orgId/members/:userId (WF-21, AUD-P-12)
   */
  async removeMember(
    ctx: ExecutionContext,
    orgId: string,
    targetUserId: string,
    reassignToUserId?: string,
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    const gapReport = await this.getOffboardingGapReport(ctx, orgId, targetUserId);

    if (gapReport.isSoleOwner) {
      throw new ConflictException({
        code: 'LAST_OWNER_CANNOT_BE_REMOVED',
        title: 'Cannot remove last Owner',
        detail: 'The organisation must have at least one active Owner. Transfer ownership before offboarding.',
      });
    }

    if (!gapReport.canOffboard && !reassignToUserId) {
      throw new ConflictException({
        code: 'OFFBOARDING_GAP_EXISTS',
        title: 'Member has outstanding project reviews or waivers',
        detail: 'Reassign outstanding reviews before offboarding this member.',
        gapReport,
      });
    }

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Reassign if specified
      if (reassignToUserId) {
        await client.query(
          `UPDATE reviews
              SET reviewer_subject_id = $1, updated_at = now()
            WHERE org_id = $2 AND reviewer_subject_id = $3 AND status IN ('PENDING', 'IN_REVIEW')`,
          [reassignToUserId, orgId, targetUserId],
        );
      }

      // Suspend membership & revoke active sessions immediately (FR-IAM-007)
      const res = await client.query(
        `UPDATE memberships
            SET status = 'SUSPENDED', updated_at = now()
          WHERE org_id = $1 AND user_id = $2
          RETURNING *`,
        [orgId, targetUserId],
      );

      await client.query(
        `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND active_org_id = $2`,
        [targetUserId, orgId],
      );

      return { success: true, removedUserId: targetUserId };
    });
  }

  /**
   * API-017: POST /orgs/:orgId/transfer-ownership (FR-ORG-014)
   */
  async transferOwnership(
    ctx: ExecutionContext,
    orgId: string,
    dto: { targetUserId: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Caller must be active R-OWNER
      const callerRes = await client.query(
        `SELECT role FROM memberships
          WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [orgId, ctx.userId],
      );

      if (!callerRes.rows.length || callerRes.rows[0].role !== 'R-OWNER') {
        throw new ForbiddenException({
          code: 'ONLY_OWNER_CAN_TRANSFER',
          title: 'Ownership transfer forbidden',
          detail: 'Only the current active Owner can transfer organisation ownership.',
        });
      }

      // Target must be active member
      const targetRes = await client.query(
        `SELECT role FROM memberships
          WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [orgId, dto.targetUserId],
      );

      if (!targetRes.rows.length) {
        throw new NotFoundException({
          code: 'TARGET_MEMBER_NOT_FOUND',
          title: 'Target member not found',
          detail: 'The designated new owner must be an active member of this organisation.',
        });
      }

      // Atomic transition: current owner becomes R-ADMIN, target becomes R-OWNER
      await client.query(
        `UPDATE memberships SET role = 'R-ADMIN', updated_at = now() WHERE org_id = $1 AND user_id = $2`,
        [orgId, ctx.userId],
      );
      await client.query(
        `UPDATE memberships SET role = 'R-OWNER', updated_at = now() WHERE org_id = $1 AND user_id = $2`,
        [orgId, dto.targetUserId],
      );

      return {
        success: true,
        previousOwnerId: ctx.userId,
        newOwnerId: dto.targetUserId,
      };
    });
  }

  /**
   * API-019: POST /orgs/:orgId/reassign-work (WF-21)
   */
  async reassignWork(
    ctx: ExecutionContext,
    orgId: string,
    dto: { fromUserId: string; toUserId: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rowCount: reviewCount } = await client.query(
        `UPDATE reviews
            SET reviewer_subject_id = $1, updated_at = now()
          WHERE org_id = $2 AND reviewer_subject_id = $3 AND status IN ('PENDING', 'IN_REVIEW')`,
        [dto.toUserId, orgId, dto.fromUserId],
      );

      return {
        success: true,
        reassignedReviewsCount: reviewCount ?? 0,
        fromUserId: dto.fromUserId,
        toUserId: dto.toUserId,
      };
    });
  }
}
