// apps/api/src/modules/organisations/organisations.service.ts
// Organisations & Member Offboarding Service (API-010..019, WF-21, FR-ORG-014, FR-IAM-007, AUD-P-12)

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { randomBytes, createHash } from 'crypto';
import { withTenantTransaction, TenantActorContext, DomainOutboxEvent } from '@tradecloseout/db';
import { isValidIndianGstin, IndianPanSchema } from '@tradecloseout/shared';

export interface OffboardingGapReport {
  targetUserId: string;
  openRequirementsCount: number;
  pendingReviewsCount: number;
  draftPackagesCount: number;
  byProject: Array<{
    projectId: string;
    projectCode: string;
    openRequirements: number;
    pendingReviews: number;
    requiredReplacementRoles: string[];
  }>;
}

@Injectable()
export class OrganisationsService {
  constructor(private readonly pool: Pool) {}

  /**
   * API-010: GET /api/v1/orgs/:orgId
   */
  async getDashboard(ctx: TenantActorContext, targetOrgId: string) {
    const orgId = targetOrgId === 'current' ? ctx.orgId : targetOrgId;
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      // 1. Fetch Org and Profile
      const { rows: orgRows } = await client.query(
        `SELECT o.id, o.legal_name, o.display_name, o.state, op.gstin
           FROM organisations o
           LEFT JOIN org_profiles op ON op.org_id = o.id
          WHERE o.id = $1 LIMIT 1`,
        [orgId],
      );
      if (orgRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Organisation not found.' });
      }
      const org = orgRows[0];

      // 2. Fetch User & Membership
      const { rows: userRows } = await client.query(
        `SELECT u.id, u.name, m.role
           FROM users u
           JOIN memberships m ON m.user_id = u.id AND m.org_id = $1
          WHERE u.id = $2 LIMIT 1`,
        [orgId, ctx.userId],
      );
      const user = userRows[0] || { id: ctx.userId, name: 'Team Member', role: 'R-SITE' };

      // 3. Fetch Projects with Contracts, Counterparties & Requirement Counts
      const { rows: projRows } = await client.query(
        `SELECT
           p.id, p.code, p.name, p.status, p.target_handover_date,
           p.site_json->>'city' as city,
           COALESCE(c.value_paise, 0)::text as contract_value_paise,
           COALESCE(ROUND((c.value_paise * c.retention_bps) / 10000), 0)::text as retention_at_risk_paise,
           p_client.name as client_name,
           p_mc.name as mc_name,
           p_pmc.name as pmc_name,
           COUNT(r.id) FILTER (WHERE r.status != 'NOT_APPLICABLE' AND r.superseded_at IS NULL) as applicable_count,
           COUNT(r.id) FILTER (WHERE r.status IN ('APPROVED', 'APPROVED_EXTERNAL') AND r.superseded_at IS NULL) as approved_count,
           COUNT(r.id) FILTER (WHERE r.status IN ('NOT_STARTED', 'REQUESTED', 'CHANGES_REQUESTED', 'EXPIRED') AND r.superseded_at IS NULL) as missing_count,
           COUNT(r.id) FILTER (WHERE r.status IN ('UPLOADED', 'IN_REVIEW') AND r.superseded_at IS NULL) as in_review_count
         FROM projects p
         LEFT JOIN contracts c ON c.project_id = p.id AND c.org_id = p.org_id
         LEFT JOIN parties p_client ON p_client.id = p.client_party_id
         LEFT JOIN parties p_mc ON p_mc.id = p.mc_party_id
         LEFT JOIN parties p_pmc ON p_pmc.id = p.consultant_party_id
         LEFT JOIN requirements r ON r.project_id = p.id AND r.org_id = p.org_id
        WHERE p.org_id = $1
        GROUP BY p.id, c.value_paise, c.retention_bps, p_client.name, p_mc.name, p_pmc.name
        ORDER BY p.created_at DESC`,
        [orgId],
      );

      const projects = projRows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientName: p.client_name || '—',
        mcName: p.mc_name || '—',
        pmcName: p.pmc_name || '—',
        city: p.city || 'Hyderabad',
        targetHandoverDate: p.target_handover_date || '',
        contractValuePaise: p.contract_value_paise,
        retentionAtRiskPaise: p.retention_at_risk_paise,
        approvedCount: Number(p.approved_count || 0),
        applicableCount: Number(p.applicable_count || 0),
        missingCount: Number(p.missing_count || 0),
        inReviewCount: Number(p.in_review_count || 0),
      }));

      // 4. Compute High-Level KPIs
      let totalRetentionAtRisk = 0n;
      let totalMissingOrExpired = 0;
      let awaitingReview = 0;
      let activeProjects = 0;

      for (const p of projects) {
        if (['ACTIVE', 'HANDOVER'].includes(p.status)) {
          activeProjects++;
          totalRetentionAtRisk += BigInt(p.retentionAtRiskPaise || '0');
        }
        totalMissingOrExpired += p.missingCount;
        awaitingReview += p.inReviewCount;
      }

      // Expiring in next 30 days
      const { rows: expiringRows } = await client.query(
        `SELECT COUNT(*) as count
           FROM document_versions dv
          WHERE dv.org_id = $1
            AND dv.expiry_date IS NOT NULL
            AND dv.expiry_date BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                                   AND ((now() AT TIME ZONE 'Asia/Kolkata') + interval '30 days')::date`,
        [orgId],
      );
      const expiringSoonCount = Number(expiringRows[0]?.count || 0);

      // 5. Immediate Attention Requirements
      const { rows: attentionRows } = await client.query(
        `SELECT r.id as requirement_id, r.project_id, p.code as project_code,
                r.requirement_key, r.title, r.status, r.due_at,
                a.tag as asset_tag, u.name as owner_name
           FROM requirements r
           JOIN projects p ON p.id = r.project_id
           LEFT JOIN assets a ON a.id = r.asset_id
           LEFT JOIN users u ON u.id = r.owner_user_id
          WHERE r.org_id = $1
            AND r.status IN ('EXPIRED', 'CHANGES_REQUESTED', 'IN_REVIEW', 'REQUESTED', 'NOT_STARTED')
            AND r.superseded_at IS NULL
          ORDER BY r.due_at ASC NULLS LAST, r.created_at DESC
          LIMIT 5`,
        [orgId],
      );

      const needsAttention = attentionRows.map((r) => ({
        requirementId: r.requirement_id,
        projectId: r.project_id,
        projectCode: r.project_code,
        requirementKey: r.requirement_key,
        title: r.title,
        assetTag: r.asset_tag || null,
        status: r.status,
        dueDate: r.due_at ? new Date(r.due_at).toLocaleDateString('en-IN') : 'ASAP',
        ownerName: r.owner_name || 'Unassigned',
      }));

      return {
        org: {
          id: org.id,
          legalName: org.legal_name,
          displayName: org.display_name || org.legal_name,
          gstin: org.gstin || null,
          state: org.state || 'TS',
        },
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
        },
        kpis: {
          activeProjectsCount: activeProjects,
          totalMissingOrExpiredCount: totalMissingOrExpired,
          awaitingMyReviewCount: awaitingReview,
          expiringSoonCount,
          totalRetentionAtRiskPaise: totalRetentionAtRisk.toString(),
        },
        projects,
        needsAttention,
      };
    });
  }

  /**
   * API-010: GET /api/v1/orgs/:orgId
   */
  async getOrganisation(ctx: TenantActorContext, orgId: string) {
    if (orgId !== ctx.orgId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Organisation not found',
        detail: 'The requested organisation resource was not found in your active scope.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: orgRows } = await client.query(
        `SELECT id, legal_name, display_name, entity_type, status, country, state, row_version, created_at, updated_at
           FROM organisations WHERE id = $1 LIMIT 1`,
        [orgId],
      );

      if (orgRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Organisation not found.' });
      }

      const { rows: profileRows } = await client.query(
        `SELECT gstin, pan, brand_color, signatory_name, signatory_designation, logo_url, accent_color, watermark_enabled, allow_self_approval, default_retention_months
           FROM org_profiles WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );

      return {
        ...orgRows[0],
        profile: profileRows[0] ?? null,
      };
    });
  }

  /**
   * API-012: PATCH /api/v1/orgs/:orgId
   * Updates organisation legal profile, GSTIN/PAN (validated structurally), and branding (WF-02).
   */
  async updateOrgProfile(
    ctx: TenantActorContext,
    expectedRowVersion: number,
    input: {
      legalName?: string;
      displayName?: string;
      entityType?: string;
      state?: string;
      gstin?: string | null;
      pan?: string | null;
      brandColor?: string;
      signatoryName?: string;
      signatoryDesignation?: string;
      logoUrl?: string;
      accentColor?: string;
      watermarkEnabled?: boolean;
      allowSelfApproval?: boolean;
      defaultRetentionMonths?: number;
    },
  ) {
    if (input.gstin && !isValidIndianGstin(input.gstin)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_GSTIN',
        title: 'Invalid GSTIN checksum or structure',
        detail: 'Enter a valid 15-character Indian GSTIN (FR-ORG-005).',
        fieldErrors: [{ field: 'gstin', message: 'Checksum or state code invalid' }],
      });
    }

    if (input.pan) {
      const panCheck = IndianPanSchema.safeParse(input.pan);
      if (!panCheck.success) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PAN',
          title: 'Invalid PAN structure',
          detail: 'Enter a valid 10-character Indian PAN (FR-ORG-006).',
          fieldErrors: [{ field: 'pan', message: 'Expected format AAAAA9999A' }],
        });
      }
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: orgRows } = await client.query(
        `SELECT id, legal_name, display_name, entity_type, state, row_version
           FROM organisations
          WHERE id = $1
          FOR UPDATE`,
        [ctx.orgId],
      );

      if (orgRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Organisation not found.' });
      }
      const org = orgRows[0];

      if (expectedRowVersion !== undefined && expectedRowVersion !== null && org.row_version !== expectedRowVersion) {
        throw new ConflictException({
          code: 'PRECONDITION_FAILED',
          detail: 'Organisation profile was updated by another user. Reload and retry.',
        });
      }

      await client.query(
        `UPDATE organisations
            SET legal_name = COALESCE($2, legal_name),
                display_name = COALESCE($3, display_name),
                entity_type = COALESCE($4, entity_type),
                state = COALESCE($5, state),
                row_version = row_version + 1,
                updated_at = now()
          WHERE id = $1`,
        [ctx.orgId, input.legalName, input.displayName, input.entityType, input.state],
      );

      await client.query(
        `INSERT INTO org_profiles (org_id, gstin, pan, brand_color, signatory_name, signatory_designation, logo_url, accent_color, watermark_enabled, allow_self_approval, default_retention_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (org_id) DO UPDATE SET
            gstin = COALESCE($2, org_profiles.gstin),
            pan = COALESCE($3, org_profiles.pan),
            brand_color = COALESCE($4, org_profiles.brand_color),
            signatory_name = COALESCE($5, org_profiles.signatory_name),
            signatory_designation = COALESCE($6, org_profiles.signatory_designation),
            logo_url = COALESCE($7, org_profiles.logo_url),
            accent_color = COALESCE($8, org_profiles.accent_color),
            watermark_enabled = COALESCE($9, org_profiles.watermark_enabled),
            allow_self_approval = COALESCE($10, org_profiles.allow_self_approval),
            default_retention_months = COALESCE($11, org_profiles.default_retention_months),
            row_version = org_profiles.row_version + 1,
            updated_at = now()`,
        [
          ctx.orgId,
          input.gstin?.toUpperCase() ?? null,
          input.pan?.toUpperCase() ?? null,
          input.brandColor ?? null,
          input.signatoryName ?? null,
          input.signatoryDesignation ?? null,
          input.logoUrl ?? null,
          input.accentColor ?? null,
          input.watermarkEnabled ?? null,
          input.allowSelfApproval ?? null,
          input.defaultRetentionMonths ?? null,
        ],
      );

      emit({
        eventType: 'ORG_PROFILE_UPDATED',
        entityType: 'ORGANISATION',
        entityId: ctx.orgId,
        beforeJson: org,
        afterJson: input,
      });

      return { orgId: ctx.orgId, rowVersion: org.row_version + 1 };
    });
  }

  /**
   * API-011: Backward-compatible wrapper for controller
   */
  async updateOrganisation(ctx: TenantActorContext, orgId: string, dto: any) {
    const rowVersion = dto.rowVersion ?? 1;
    return this.updateOrgProfile(ctx, rowVersion, dto);
  }

  /**
   * API-013: GET /api/v1/orgs/:orgId/members
   */
  async listMembers(ctx: TenantActorContext, orgId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: members } = await client.query(
        `SELECT m.id, m.user_id, m.role, m.status, m.joined_at, u.name,
                (SELECT value FROM user_identities WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1) AS identifier
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1
          ORDER BY m.created_at ASC`,
        [orgId],
      );

      const { rows: pendingInvitations } = await client.query(
        `SELECT id, email, role, status, expires_at, created_at
           FROM invitations
          WHERE org_id = $1 AND status = 'PENDING'
          ORDER BY created_at DESC`,
        [orgId],
      );

      return { members, pendingInvitations };
    });
  }

  /**
   * API-014: POST /api/v1/orgs/:orgId/invitations
   */
  async createInvitation(
    ctx: TenantActorContext,
    orgId: string,
    dto: { email: string; role: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');
    const email = dto.email.trim().toLowerCase();

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: existing } = await client.query(
        `SELECT m.id FROM memberships m
           JOIN user_identities i ON i.user_id = m.user_id
          WHERE m.org_id = $1 AND i.value = $2 AND m.status = 'ACTIVE' LIMIT 1`,
        [orgId, email],
      );

      if (existing.length > 0) {
        throw new ConflictException({
          code: 'MEMBER_ALREADY_EXISTS',
          title: 'Member already belongs to organisation',
          detail: 'This user already holds an active membership in this organisation.',
        });
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const invId = uuidv7();

      const { rows: inv } = await client.query(
        `INSERT INTO invitations (id, org_id, email, role, token_hash, status, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', now() + interval '7 days', $6)
         RETURNING id, email, role, status, expires_at, created_at`,
        [invId, orgId, email, dto.role, tokenHash, ctx.userId],
      );

      return {
        ...inv[0],
        invitationToken: rawToken,
      };
    });
  }

  /**
   * API-015: DELETE /api/v1/orgs/:orgId/invitations/:id
   */
  async revokeInvitation(ctx: TenantActorContext, orgId: string, invitationId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `UPDATE invitations
            SET status = 'REVOKED', updated_at = now()
          WHERE org_id = $1 AND id = $2 AND status = 'PENDING'
          RETURNING id, status`,
        [orgId, invitationId],
      );

      if (rows.length === 0) {
        throw new NotFoundException('INVITATION_NOT_FOUND');
      }

      return rows[0];
    });
  }

  /**
   * API-016: PATCH /api/v1/orgs/:orgId/members/:userId
   */
  async updateMemberRole(
    ctx: TenantActorContext,
    orgId: string,
    targetUserId: string,
    dto: { role: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      if (dto.role !== 'R-OWNER') {
        const { rows: ownerRows } = await client.query(
          `SELECT user_id FROM memberships
            WHERE org_id = $1 AND role = 'R-OWNER' AND status = 'ACTIVE'`,
          [orgId],
        );
        if (ownerRows.length === 1 && ownerRows[0].user_id === targetUserId) {
          throw new ConflictException({
            code: 'LAST_OWNER_DEMOTION_BLOCKED',
            title: 'Cannot demote last Owner',
            detail: 'An organisation must have at least one active Owner. Transfer ownership first.',
          });
        }
      }

      const { rows } = await client.query(
        `UPDATE memberships
            SET role = $1, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $2 AND user_id = $3 AND status = 'ACTIVE'
          RETURNING *`,
        [dto.role, orgId, targetUserId],
      );

      if (rows.length === 0) throw new NotFoundException('MEMBERSHIP_NOT_FOUND');
      return rows[0];
    });
  }

  /**
   * WF-21 & API-017 / API-019: Suspend / Remove Member with Gap Report & Bulk Work Reassignment.
   * Guarantees zero orphaned requirements or reviews (AUD-P-12).
   */
  async offboardOrReassignMember(
    ctx: TenantActorContext,
    input: {
      targetUserId: string;
      action: 'SUSPEND' | 'REMOVE' | 'REASSIGN_ONLY';
      replacementUserId?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: targetMemberRows } = await client.query(
        `SELECT id, role, status FROM memberships
          WHERE org_id = $1 AND user_id = $2
          FOR UPDATE`,
        [ctx.orgId, input.targetUserId],
      );

      if (targetMemberRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Member not found in organisation.' });
      }
      const targetMember = targetMemberRows[0];

      // Guardrail (11 §4.13 & WF-21): Cannot suspend or remove the sole Owner
      if (targetMember.role === 'R-OWNER' && input.action !== 'REASSIGN_ONLY') {
        throw new ConflictException({
          code: 'CANNOT_REMOVE_SOLE_OWNER',
          title: 'Cannot remove organisation owner',
          detail: 'Transfer ownership to another active member before suspending or removing the owner (FR-IAM-004).',
        });
      }

      // 1. Revoke all active sessions for the departing user in this org immediately (FR-IAM-007)
      if (input.action === 'SUSPEND' || input.action === 'REMOVE') {
        await client.query(
          `UPDATE sessions
              SET revoked_at = now()
            WHERE user_id = $1 AND active_org_id = $2 AND revoked_at IS NULL`,
          [input.targetUserId, ctx.orgId],
        );
      }

      // 2. Compute the WF-21 Gap Report across all active projects
      const gapReport = await this.computeMemberGapReport(client, ctx.orgId, input.targetUserId);
      const hasOpenWork =
        gapReport.openRequirementsCount > 0 || gapReport.pendingReviewsCount > 0;

      if (hasOpenWork && !input.replacementUserId && input.action === 'REMOVE') {
        throw new ConflictException({
          code: 'OPEN_WORK_REQUIRES_REASSIGNMENT',
          title: 'Member owns open requirements or reviews',
          detail:
            'Reassign all open requirements and pending reviews to an eligible member before removing this user (WF-21 / AUD-P-12).',
          fieldErrors: [{ field: 'replacementUserId', message: JSON.stringify(gapReport) }],
        });
      }

      // 3. Perform Bulk Reassignment if replacementUserId is provided (FR-IAM-008 / SCR-056)
      if (input.replacementUserId) {
        const { rows: repRows } = await client.query(
          `SELECT role, status FROM memberships WHERE org_id = $1 AND user_id = $2`,
          [ctx.orgId, input.replacementUserId],
        );
        if (repRows.length === 0 || repRows[0].status !== 'ACTIVE') {
          throw new UnprocessableEntityException({
            code: 'INVALID_REPLACEMENT_MEMBER',
            detail: 'Replacement user must be an ACTIVE member of this organisation.',
          });
        }

        await client.query(
          `UPDATE requirements
              SET owner_user_id = $3, row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND owner_user_id = $2
              AND status NOT IN ('APPROVED', 'WAIVED', 'NOT_APPLICABLE', 'SUPERSEDED')`,
          [ctx.orgId, input.targetUserId, input.replacementUserId],
        );

        await client.query(
          `UPDATE reviews
              SET reviewer_subject_id = $3, reviewer_user_id = $3,
                  row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND reviewer_user_id = $2
              AND status IN ('PENDING', 'IN_REVIEW')`,
          [ctx.orgId, input.targetUserId, input.replacementUserId],
        );
      }

      // 4. Transition membership state (06 §3.3)
      if (input.action === 'SUSPEND' || input.action === 'REMOVE') {
        const nextStatus = input.action === 'SUSPEND' ? 'SUSPENDED' : 'REMOVED';
        await client.query(
          `UPDATE memberships
              SET status = $3, row_version = row_version + 1, updated_at = now()
            WHERE org_id = $1 AND user_id = $2`,
          [ctx.orgId, input.targetUserId, nextStatus],
        );
      }

      emit({
        eventType: `MEMBER_${input.action}`,
        entityType: 'MEMBERSHIP',
        entityId: targetMember.id,
        beforeJson: { status: targetMember.status },
        afterJson: {
          action: input.action,
          replacementUserId: input.replacementUserId ?? null,
          gapReport,
        },
      });

      return {
        targetUserId: input.targetUserId,
        action: input.action,
        reassignedTo: input.replacementUserId ?? null,
        gapReport,
      };
    });
  }

  /**
   * API-017: DELETE /orgs/:orgId/members/:userId wrapper
   */
  async removeMember(
    ctx: TenantActorContext,
    orgId: string,
    targetUserId: string,
    reassignToUserId?: string,
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');
    return this.offboardOrReassignMember(ctx, {
      targetUserId,
      action: 'REMOVE',
      replacementUserId: reassignToUserId,
    });
  }

  /**
   * API-018: POST /api/v1/orgs/:orgId/transfer-ownership
   * Atomically transfers R-OWNER to another active member (FR-IAM-004, FR-ORG-014).
   */
  async transferOwnership(ctx: TenantActorContext, newOwnerUserId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: currentOwnerRows } = await client.query(
        `SELECT id, role FROM memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE`,
        [ctx.orgId, ctx.userId],
      );
      if (currentOwnerRows[0]?.role !== 'R-OWNER') {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          detail: 'Only the current Organisation Owner can transfer ownership.',
        });
      }

      const { rows: targetRows } = await client.query(
        `SELECT id, status FROM memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE`,
        [ctx.orgId, newOwnerUserId],
      );
      if (targetRows.length === 0 || targetRows[0].status !== 'ACTIVE') {
        throw new UnprocessableEntityException({
          code: 'INVALID_TARGET_OWNER',
          detail: 'Target user must be an active member of this organisation.',
        });
      }

      await client.query(
        `UPDATE memberships SET role = 'R-ADMIN', row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND user_id = $2`,
        [ctx.orgId, ctx.userId],
      );
      await client.query(
        `UPDATE memberships SET role = 'R-OWNER', row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND user_id = $2`,
        [ctx.orgId, newOwnerUserId],
      );

      emit({
        eventType: 'ORG_OWNERSHIP_TRANSFERRED',
        entityType: 'ORGANISATION',
        entityId: ctx.orgId,
        beforeJson: { ownerUserId: ctx.userId },
        afterJson: { ownerUserId: newOwnerUserId },
      });

      return { previousOwnerUserId: ctx.userId, newOwnerUserId };
    });
  }

  /**
   * API-019: POST /orgs/:orgId/reassign-work wrapper
   */
  async reassignWork(
    ctx: TenantActorContext,
    orgId: string,
    dto: { fromUserId: string; toUserId: string },
  ) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');
    return this.offboardOrReassignMember(ctx, {
      targetUserId: dto.fromUserId,
      action: 'REASSIGN_ONLY',
      replacementUserId: dto.toUserId,
    });
  }

  /**
   * API-018: GET /orgs/:orgId/members/:userId/offboarding-gap-report
   */
  async getOffboardingGapReport(ctx: TenantActorContext, orgId: string, targetUserId: string) {
    if (orgId !== ctx.orgId) throw new NotFoundException('ORGANISATION_NOT_FOUND');

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      return this.computeMemberGapReport(client, orgId, targetUserId);
    });
  }

  private async computeMemberGapReport(
    client: any,
    orgId: string,
    targetUserId: string,
  ): Promise<OffboardingGapReport> {
    const { rows: reqRows } = await client.query(
      `SELECT p.id AS project_id, p.code AS project_code, COUNT(r.id)::int AS open_reqs
         FROM requirements r
         JOIN projects p ON p.org_id = r.org_id AND p.id = r.project_id
        WHERE r.org_id = $1 AND r.owner_user_id = $2
          AND r.status NOT IN ('APPROVED','WAIVED','NOT_APPLICABLE','SUPERSEDED')
        GROUP BY p.id, p.code`,
      [orgId, targetUserId],
    );

    const { rows: revRows } = await client.query(
      `SELECT p.id AS project_id, p.code AS project_code,
              COUNT(rv.id)::int AS pending_reviews,
              ARRAY_AGG(DISTINCT r.reviewer_role) FILTER (WHERE r.reviewer_role IS NOT NULL) AS needed_roles
         FROM reviews rv
         JOIN projects p ON p.org_id = rv.org_id AND p.id = rv.project_id
         LEFT JOIN document_requirements dr ON dr.org_id = rv.org_id AND dr.project_id = rv.project_id
         LEFT JOIN requirements r ON r.org_id = dr.org_id AND r.project_id = dr.project_id AND r.id = dr.requirement_id
        WHERE rv.org_id = $1 AND rv.reviewer_user_id = $2
          AND rv.status IN ('PENDING','IN_REVIEW')
        GROUP BY p.id, p.code`,
      [orgId, targetUserId],
    );

    const projectMap = new Map<
      string,
      {
        projectId: string;
        projectCode: string;
        openRequirements: number;
        pendingReviews: number;
        requiredReplacementRoles: string[];
      }
    >();

    let totalReqs = 0;
    let totalRevs = 0;

    for (const r of reqRows) {
      totalReqs += r.open_reqs;
      projectMap.set(r.project_id, {
        projectId: r.project_id,
        projectCode: r.project_code,
        openRequirements: r.open_reqs,
        pendingReviews: 0,
        requiredReplacementRoles: [],
      });
    }

    for (const rv of revRows) {
      totalRevs += rv.pending_reviews;
      const existing = projectMap.get(rv.project_id) ?? {
        projectId: rv.project_id,
        projectCode: rv.project_code,
        openRequirements: 0,
        pendingReviews: 0,
        requiredReplacementRoles: [],
      };
      existing.pendingReviews = rv.pending_reviews;
      existing.requiredReplacementRoles = rv.needed_roles ?? [];
      projectMap.set(rv.project_id, existing);
    }

    return {
      targetUserId,
      openRequirementsCount: totalReqs,
      pendingReviewsCount: totalRevs,
      draftPackagesCount: 0,
      byProject: Array.from(projectMap.values()),
    };
  }

  async getAuditLog(ctx: TenantActorContext, orgId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT a.id, a.org_id, a.project_id, a.actor_type, a.actor_user_id, a.action, a.entity_type, a.entity_id,
                a.before_json, a.after_json, a.ip, a.user_agent, a.request_id, a.prev_hash, a.hash, a.chain_seq, a.created_at,
                u.name AS actor_name
           FROM audit_events a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.org_id = $1
          ORDER BY a.chain_seq DESC
          LIMIT 100`,
        [ctx.orgId],
      );
      return rows;
    });
  }
}
