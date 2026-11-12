// apps/api/src/modules/organisations/organisations.service.ts
// Organisations & Member Offboarding Service (API-010..019, WF-21, FR-ORG-014, FR-IAM-007, AUD-P-12)

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { randomBytes, createHash } from 'crypto';
import { withTenantTransaction, TenantActorContext, DomainOutboxEvent } from '@tradecloseout/db';
import { hasPermission, isValidIndianGstin, IndianPanSchema, canonicalAuthenticationEmail } from '@tradecloseout/shared';
import { OwnershipTransfersService } from './ownership-transfers.service';
import { TransactionalMailGateway } from '../identity/identity.controller';
import { isProductionEnvironment } from '../identity/auth-security';
import { OrgProfilePatch, resolveOrganisationTarget } from './organisation-validation';

export interface OffboardingGapReport {
  targetUserId: string;
  openRequirementsCount: number;
  pendingReviewsCount: number;
  draftPackagesCount: number;
  assignedDefectsCount?: number;
  byProject: Array<{
    projectId: string;
    projectCode: string;
    openRequirements: number;
    pendingReviews: number;
    draftPackages?: number;
    assignedDefects?: number;
    requiredReplacementRoles: string[];
  }>;
}

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly pool: Pool,
    @Optional() private readonly mailGateway?: TransactionalMailGateway,
  ) {}

  /**
   * API-010: GET /api/v1/orgs/:orgId
   */
  async getDashboard(ctx: TenantActorContext, targetOrgId: string) {
    const orgId = targetOrgId === 'current' ? ctx.orgId : targetOrgId;
    if (orgId !== ctx.orgId || ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new NotFoundException('ORGANISATION_NOT_FOUND');
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      // PH2-G03: a previously privileged user must not enumerate projects or
      // receive commercial metrics after demotion. Resolve the live current
      // org grant before building either the scoped queries or the DTO.
      const { rows: userRows } = await client.query(
        `SELECT u.id, u.name, m.role
           FROM users u JOIN memberships m ON m.user_id=u.id AND m.org_id=$1
          WHERE u.id=$2 AND u.status='ACTIVE' AND m.status='ACTIVE'
          FOR SHARE OF u,m`,
        [orgId,ctx.userId],
      );
      if (!userRows.length) throw new NotFoundException('ORGANISATION_NOT_FOUND');
      const user=userRows[0];
      const projectRead = hasPermission({orgRole:user.role}, 'project.read');
      if (!projectRead.allowed) throw new NotFoundException('ORGANISATION_NOT_FOUND');
      const mayReadCommercial = hasPermission({orgRole:user.role}, 'contract.manage').allowed;
      const projectScopeClause = projectRead.scope === 'S'
        ? `AND EXISTS (SELECT 1 FROM project_members pm
                        WHERE pm.org_id=p.org_id AND pm.project_id=p.id
                          AND pm.user_id=$2 AND pm.status='ACTIVE')` : '';
      const requirementsScopeClause = projectRead.scope === 'S'
        ? `AND EXISTS (SELECT 1 FROM project_members pm
                        WHERE pm.org_id=r.org_id AND pm.project_id=r.project_id
                          AND pm.user_id=$2 AND pm.status='ACTIVE')` : '';
      // PostgreSQL rejects extra bind parameters. Only scoped queries use $2.
      const dashboardQueryArgs = projectRead.scope === 'S'
        ? [orgId, ctx.userId] : [orgId];
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

      // 2. Fetch Projects with Pre-Aggregated Contracts, Counterparties & Requirement Counts (Finding N21)
      const { rows: projRows } = await client.query(
        `WITH contract_summary AS (
           SELECT project_id, org_id,
                  COALESCE(SUM(value_paise), 0) AS total_contract_value_paise,
                  COALESCE(SUM(ROUND((value_paise * retention_bps) / 10000)), 0) AS total_retention_at_risk_paise
             FROM contracts
            WHERE status = 'ACTIVE'
            GROUP BY project_id, org_id
         ),
         req_summary AS (
           SELECT project_id, org_id,
                  COUNT(id) FILTER (WHERE status != 'NOT_APPLICABLE' AND superseded_at IS NULL) as applicable_count,
                  COUNT(id) FILTER (WHERE status IN ('APPROVED', 'APPROVED_EXTERNAL') AND superseded_at IS NULL) as approved_count,
                  COUNT(id) FILTER (WHERE status IN ('NOT_STARTED', 'REQUESTED', 'CHANGES_REQUESTED', 'EXPIRED') AND superseded_at IS NULL) as missing_count,
                  COUNT(id) FILTER (WHERE status IN ('UPLOADED', 'IN_REVIEW') AND superseded_at IS NULL) as in_review_count
             FROM requirements
            GROUP BY project_id, org_id
         )
         SELECT
            p.id, p.code, p.name, p.status, p.target_handover_date,
            p.site_json->>'city' as city,
            COALESCE(cs.total_contract_value_paise, p.contract_value_paise, 0)::text as contract_value_paise,
            COALESCE(cs.total_retention_at_risk_paise, 0)::text as retention_at_risk_paise,
            p_client.name as client_name,
            p_mc.name as mc_name,
            p_pmc.name as pmc_name,
            COALESCE(rs.applicable_count, 0) as applicable_count,
            COALESCE(rs.approved_count, 0) as approved_count,
            COALESCE(rs.missing_count, 0) as missing_count,
            COALESCE(rs.in_review_count, 0) as in_review_count
          FROM projects p
          LEFT JOIN contract_summary cs ON cs.project_id = p.id AND cs.org_id = p.org_id
          LEFT JOIN req_summary rs ON rs.project_id = p.id AND rs.org_id = p.org_id
          LEFT JOIN parties p_client ON p_client.id = p.client_party_id
          LEFT JOIN parties p_mc ON p_mc.id = p.mc_party_id
          LEFT JOIN parties p_pmc ON p_pmc.id = p.consultant_party_id
         WHERE p.org_id = $1 ${projectScopeClause}
         ORDER BY p.created_at DESC`,
        dashboardQueryArgs,
      );

      const projects = projRows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientName: p.client_name || '—',
        mcName: p.mc_name || '—',
        pmcName: p.pmc_name || '—',
        city: p.city || '—',
        targetHandoverDate: p.target_handover_date || '',
        contractValuePaise: mayReadCommercial ? p.contract_value_paise : null,
        retentionAtRiskPaise: mayReadCommercial ? p.retention_at_risk_paise : null,
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
            ${projectRead.scope === 'S' ? `AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.org_id = dv.org_id AND pm.project_id = dv.project_id AND pm.user_id = $2 AND pm.status = 'ACTIVE')` : ''}
            AND dv.expiry_date IS NOT NULL
            AND dv.expiry_date BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                                   AND ((now() AT TIME ZONE 'Asia/Kolkata') + interval '30 days')::date`,
        dashboardQueryArgs,
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
            ${requirementsScopeClause}
            AND r.status IN ('EXPIRED', 'CHANGES_REQUESTED', 'IN_REVIEW', 'REQUESTED', 'NOT_STARTED')
            AND r.superseded_at IS NULL
          ORDER BY r.due_at ASC NULLS LAST, r.created_at DESC
          LIMIT 5`,
        dashboardQueryArgs,
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
          totalRetentionAtRiskPaise: mayReadCommercial ? totalRetentionAtRisk.toString() : null,
        },
        projects,
        needsAttention,
      };
    });
  }

  /**
   * API-010: GET /api/v1/orgs/:orgId
   */
  async getOrganisation(ctx: TenantActorContext, targetOrgId: string) {
    const orgId = targetOrgId === 'current' ? ctx.orgId : targetOrgId;
    if (orgId !== ctx.orgId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Organisation not found',
        detail: 'The requested organisation resource was not found in your active scope.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: orgRows } = await client.query(
        `SELECT id, legal_name, display_name, entity_type, status, country, state, timezone, allow_self_approval, row_version, created_at, updated_at
           FROM organisations WHERE id = $1 LIMIT 1`,
        [orgId],
      );

      if (orgRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Organisation not found.' });
      }

      const { rows: profileRows } = await client.query(
        `SELECT gstin, pan, brand_color, signatory_name, signatory_designation, logo_object_id, accent_color, watermark_enabled, allow_self_approval, default_retention_months, address_json, contact_email, contact_phone, footer_text, row_version
           FROM org_profiles WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );

      return {
        ...orgRows[0],
        profile: profileRows[0] ? {...profileRows[0], allow_self_approval: orgRows[0].allow_self_approval} : null,
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
    input: OrgProfilePatch,
  ) {
    if(input.allowSelfApproval===true)throw new UnprocessableEntityException({code:'SELF_APPROVAL_POLICY_NOT_SUPPORTED'});
    const orgColumns: Record<string, string> = {
      legalName:'legal_name', displayName:'display_name', entityType:'entity_type',
      state:'state', timeZone:'timezone', allowSelfApproval:'allow_self_approval',
    };
    const profileColumns: Record<string, string> = {
      gstin:'gstin', pan:'pan', brandColor:'brand_color',
      signatoryName:'signatory_name', signatoryDesignation:'signatory_designation',
      logoObjectId:'logo_object_id', accentColor:'accent_color',
      watermarkEnabled:'watermark_enabled', allowSelfApproval:'allow_self_approval',
      defaultRetentionMonths:'default_retention_months', addressJson:'address_json',
      contactEmail:'contact_email', contactPhone:'contact_phone', footerText:'footer_text',
    };
    return withTenantTransaction(this.pool, {...ctx,organisationWrite:true}, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const {rows:orgRows}=await client.query(
        `SELECT id,legal_name,display_name,entity_type,state,row_version FROM organisations
          WHERE id=$1 FOR UPDATE`,[ctx.orgId],
      );
      if (!orgRows.length) throw new NotFoundException({code:'NOT_FOUND'});
      const org=orgRows[0];
      if (org.row_version !== expectedRowVersion) {
        throw new ConflictException({code:'PRECONDITION_FAILED',detail:'Reload the organisation profile before retrying.'});
      }

      // The object must already be READY, virus-scanned and owned by the same
      // tenant. This endpoint never accepts arbitrary URL/SVG branding.
      if (input.logoObjectId) {
        const {rows:logo}=await client.query(
          `SELECT id FROM storage_objects
             WHERE org_id=$1 AND id=$2 AND status='READY'
               AND av_scanned_at IS NOT NULL
               AND mime IN ('image/png','image/jpeg','image/webp')
               AND sha256 ~ '^[a-fA-F0-9]{64}$' AND size_bytes>0
               AND observed_size_bytes=size_bytes
               AND provider_version_id IS NOT NULL AND provider_version_id<>''
             FOR SHARE`,[ctx.orgId,input.logoObjectId],
        );
        if (!logo.length) throw new UnprocessableEntityException({code:'INVALID_BRANDING_OBJECT'});
      }

      const orgFields=Object.entries(input).filter(([key])=>key in orgColumns);
      if (orgFields.length) {
        const args=[ctx.orgId,...orgFields.map(([,value])=>value)];
        const setters=orgFields.map(([key],index)=>`${orgColumns[key]}=$${index+2}`);
        await client.query(
          `UPDATE organisations SET ${setters.join(',')},row_version=row_version+1,updated_at=now()
            WHERE id=$1`,args,
        );
      } else {
        await client.query(`UPDATE organisations SET row_version=row_version+1,updated_at=now()
          WHERE id=$1`,[ctx.orgId]);
      }

      const profileFields=Object.entries(input).filter(([key])=>key in profileColumns);
      if (profileFields.length) {
        // Explicitly inserting only org_id ensures database defaults are used;
        // UPDATE only supplied columns permits nullable fields to be cleared.
        await client.query(
          `INSERT INTO org_profiles(org_id) VALUES($1)
            ON CONFLICT(org_id) DO NOTHING`,[ctx.orgId],
        );
        const args=[ctx.orgId,...profileFields.map(([,value])=>value)];
        const setters=profileFields.map(([key],index)=>`${profileColumns[key]}=$${index+2}`);
        await client.query(
          `UPDATE org_profiles SET ${setters.join(',')},
             row_version=row_version+1,updated_at=now() WHERE org_id=$1`,args,
        );
      }
      emit({
        eventType:'ORG_PROFILE_UPDATED',entityType:'ORGANISATION',entityId:ctx.orgId,
        beforeJson:{rowVersion:org.row_version},afterJson:{changedFields:Object.keys(input),rowVersion:org.row_version+1},
      });
      return {orgId:ctx.orgId,rowVersion:org.row_version+1};
    });
  }

  /**
   * API-011: Backward-compatible wrapper for controller
   */
  async updateOrganisation(ctx: TenantActorContext, orgId: string, dto: any) {
    if (orgId !== 'current' && orgId !== ctx.orgId) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    const {parseOrgProfilePatch} = await import('./organisation-validation');
    const patch = parseOrgProfilePatch(dto);
    return this.updateOrgProfile(ctx, patch.rowVersion, patch.input);
  }

  /**
   * API-013: GET /api/v1/orgs/:orgId/members
   */
  async listMembers(ctx: TenantActorContext, targetOrgId: string) {
    const orgId=resolveOrganisationTarget(ctx.orgId,targetOrgId);

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
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);
    const email=canonicalAuthenticationEmail(dto?.email);
    if (!email || typeof dto?.role !== 'string') {
      throw new UnprocessableEntityException({code:'INVALID_INVITATION_INPUT'});
    }
    // Owner authority is transferred only through the audited transfer path.
    const invitedRoles = new Set([
      'R-ADMIN','R-BILLING','R-PM','R-SITE','R-DOC','R-PROC',
      'R-QC','R-SAFETY','R-REVIEWER','R-AUDITOR',
    ]);
    if (!invitedRoles.has(dto.role)) {
      throw new UnprocessableEntityException({code:'INVALID_INVITATION_ROLE'});
    }
    if (isProductionEnvironment() && !this.mailGateway) {
      throw new ServiceUnavailableException({
        code:'INVITATION_DELIVERY_UNAVAILABLE',
        detail:'Invitation delivery is not configured.',
      });
    }

    const issued = await withTenantTransaction(this.pool, ctx,
      async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: issuer } = await client.query(
        `SELECT role FROM memberships
         WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,
        [orgId,ctx.userId],
      );
      const issuerRole = issuer[0]?.role;
      if (!['R-OWNER','R-ADMIN'].includes(issuerRole) ||
          (dto.role === 'R-ADMIN' && issuerRole !== 'R-OWNER')) {
        throw new ForbiddenException({code:'INVITATION_ROLE_EXCEEDS_ISSUER'});
      }
      // Serialize invitation creation by target identity. There must never be
      // two independently usable pending proofs granting potentially different
      // roles to the same intended organisation member.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`org-invitation:${orgId}:${email}`],
      );
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

      await client.query(
        `UPDATE invitations SET status='REVOKED'
          WHERE org_id=$1 AND lower(email)=lower($2)
            AND status IN ('PENDING','DELIVERY_PENDING')`,
        [orgId,email],
      );
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const invId = uuidv7();

      // Until a delivery provider has actually accepted the invitation,
      // its token cannot be redeemed. Crashes and ambiguous timeouts leave
      // DELIVERY_PENDING, never an implicitly usable PENDING grant.
      const initialStatus = this.mailGateway ? 'DELIVERY_PENDING' : 'PENDING';
      const { rows: inv } = await client.query(
        `INSERT INTO invitations (id, org_id, email, role, token_hash, status, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days', $7)
         RETURNING id, email, role, status, expires_at, created_at`,
        [invId, orgId, email, dto.role, tokenHash, initialStatus, ctx.userId],
      );

      emit({
        eventType:'ORG_INVITATION_ISSUED',entityType:'INVITATION',entityId:invId,
        afterJson:{invitedBy:ctx.userId,role:dto.role,deliveryStatus:initialStatus},
      });
      return {
        ...inv[0],
        invitationToken: rawToken,
      };
    });
    if (this.mailGateway) {
      const appOrigin = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL;
      const failDelivery = async () => {
        // This recovery does not assume the issuer still holds authority:
        // expiry, role change or a process restart must never convert an
        // unconfirmed delivery into a valid invitation.
        await withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
          await client.query(
            `UPDATE invitations SET status='REVOKED'
               WHERE org_id=$1 AND id=$2 AND status='DELIVERY_PENDING'`,
            [orgId, issued.id],
          );
        });
      };
      if (!appOrigin || (isProductionEnvironment() && !appOrigin.startsWith('https://'))) {
        await failDelivery();
        throw new ServiceUnavailableException({code:'INVITATION_APP_ORIGIN_INVALID'});
      }
      try {
        const link = new URL('/login',appOrigin);
        link.searchParams.set('invite',issued.invitationToken);
        await this.mailGateway.sendMagicLinkEmail(email,link.toString(),
          {kind:'INVITATION',targetId:issued.id,orgId,actorUserId:ctx.userId});

        // This conditional promotion is atomic and protects concurrent
        // invitation supersession: provider acceptance for an old challenge
        // cannot revive it or make its response appear successful.
        const promoted = await withTenantTransaction(this.pool, ctx, async (client: PoolClient) =>
          client.query(
            `UPDATE invitations i SET status='PENDING'
               WHERE i.org_id=$1 AND i.id=$2 AND i.status='DELIVERY_PENDING'
                 AND i.expires_at>now()
                 AND EXISTS (
                   SELECT 1 FROM memberships m
                    WHERE m.org_id=i.org_id AND m.user_id=i.invited_by
                      AND m.status='ACTIVE'
                      AND (m.role='R-OWNER' OR
                           (m.role='R-ADMIN' AND i.role<>'R-ADMIN'))
                 )
               RETURNING i.id`,
            [orgId, issued.id],
          ),
        );
        if (!promoted.rowCount) {
          throw new ConflictException({code:'INVITATION_SUPERSEDED_DURING_DELIVERY'});
        }
        return { id: issued.id, email: issued.email,
          role: issued.role, status: 'PENDING',
          expires_at: issued.expires_at, created_at:issued.created_at,
          deliveryStatus:'SENT' };
      } catch (error) {
        // The provider may have accepted and then timed out. The invitation
        // remains non-redeemable unless its accepted state was committed.
        // Retried issuances generate fresh tokens.
        // A durable attempt/receipt can reconcile an accepted-but-lost
        // acknowledgement. Keep the token nonredeemable; supersession, issuer
        // authority checks and expiry still prevent a late receipt reviving it.
        if (error instanceof ConflictException) throw error;
        throw new ServiceUnavailableException({
          code:'INVITATION_DELIVERY_UNVERIFIED',
          detail:'Could not confirm the invitation email. Create a new invitation.',
        });
      }
    }
    // Nonproduction fixtures may expose a token for local test flows only.
    if (isProductionEnvironment()) {
      throw new ServiceUnavailableException({code:'INVITATION_DELIVERY_UNAVAILABLE'});
    }
    return issued;
  }

  /**
   * API-015: DELETE /api/v1/orgs/:orgId/invitations/:id
   */
  async revokeInvitation(ctx: TenantActorContext, orgId: string, invitationId: string) {
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `UPDATE invitations
            SET status = 'REVOKED'
          WHERE org_id = $1 AND id = $2 AND status IN ('PENDING','DELIVERY_PENDING')
          RETURNING id, status`,
        [orgId, invitationId],
      );

      if (rows.length === 0) {
        throw new NotFoundException('INVITATION_NOT_FOUND');
      }
      emit({eventType:'ORG_INVITATION_REVOKED',entityType:'INVITATION',
        entityId:invitationId,afterJson:{revokedBy:ctx.userId,status:'REVOKED'}});
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
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);

    if (!dto || typeof dto.role !== 'string') {
      throw new UnprocessableEntityException({code:'INVALID_MEMBER_ROLE'});
    }
    const changeableRoles = new Set([
      'R-ADMIN','R-BILLING','R-PM','R-SITE','R-DOC','R-PROC',
      'R-QC','R-SAFETY','R-REVIEWER','R-AUDITOR',
    ]);
    if (!changeableRoles.has(dto.role)) {
      throw new UnprocessableEntityException({code:'OWNER_ROLE_REQUIRES_TRANSFER'});
    }
    return withTenantTransaction(this.pool, ctx, async (
      client: PoolClient, emit: (ev: DomainOutboxEvent) => void,
    ) => {
      const { rows: actorRows } = await client.query(
        `SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2
          AND status='ACTIVE' FOR SHARE`,
        [orgId,ctx.userId],
      );
      const activeActorRole = actorRows[0]?.role;
      if (!['R-OWNER','R-ADMIN'].includes(activeActorRole) ||
          (dto.role === 'R-ADMIN' && activeActorRole !== 'R-OWNER')) {
        throw new ForbiddenException({code:'MEMBER_ROLE_CHANGE_NOT_AUTHORIZED'});
      }
      // G03-023: Session row locks precede target membership row locks in
      // both role-change and offboarding. Otherwise one transaction can hold
      // session SHARE while the other holds membership FOR UPDATE.
      await client.query(
        `SELECT id FROM sessions WHERE user_id=$1 AND active_org_id=$2
          AND revoked_at IS NULL ORDER BY id FOR UPDATE`,
        [targetUserId,orgId],
      );
      const { rows: targetRoles } = await client.query(
        `SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2
          AND status='ACTIVE' FOR UPDATE`,
        [orgId,targetUserId],
      );
      if (!targetRoles.length) throw new NotFoundException('MEMBERSHIP_NOT_FOUND');
      if (targetRoles[0].role === 'R-OWNER' ||
          (activeActorRole !== 'R-OWNER' && targetRoles[0].role === 'R-ADMIN') ||
          (ctx.userId === targetUserId && activeActorRole === 'R-ADMIN')) {
        throw new ForbiddenException({code:'PROTECTED_MEMBER_ROLE_CHANGE'});
      }
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

      // Invalidate grants of *future membership authority* created by this
      // person whenever the new role would not be permitted to issue them.
      // This shares a transaction with the role edit; concurrent invitation
      // redemption serializes on the invitation row.
      const revokedInvitations = await client.query(
        `UPDATE invitations SET status='REVOKED'
          WHERE org_id=$1 AND invited_by=$2 AND status IN ('PENDING','DELIVERY_PENDING')
            AND ($3 <> 'R-ADMIN' OR role='R-ADMIN')`,
        [orgId,targetUserId,dto.role],
      );
      // Role changes cross an authentication-strength boundary. Invalidate
      // any browser sessions selected into this organisation so their tokens,
      // CSRF material and MFA state cannot survive privilege transitions.
      await client.query(
        `WITH revoked AS (
           UPDATE sessions SET revoked_at=now(),mfa_verified=false,
                 mfa_verified_at=NULL
            WHERE user_id=$1 AND active_org_id=$2 AND revoked_at IS NULL
            RETURNING id,user_id,active_org_id
         )
         INSERT INTO auth_security_events
           (id,actor_user_id,org_id,session_id,event_type,outcome)
         SELECT gen_random_uuid(),user_id,active_org_id,id,
           'MEMBER_ROLE_CHANGED_SESSION_REVOKED','SUCCESS' FROM revoked`,
        [targetUserId,orgId],
      );
      emit({
        eventType:'ORG_MEMBER_ROLE_CHANGED',
        entityType:'MEMBERSHIP',
        entityId:rows[0].id,
        beforeJson:{role:targetRoles[0].role,userId:targetUserId},
        afterJson:{
          role:dto.role,userId:targetUserId,sessionsRevoked:true,
          invitationsRevoked:revokedInvitations.rowCount || 0,
        },
      });
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
    if (input.replacementUserId === input.targetUserId) {
      throw new UnprocessableEntityException({ code: 'SELF_REPLACEMENT_NOT_ALLOWED' });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: actorRows } = await client.query(
        `SELECT role FROM memberships
           WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      if (!['R-OWNER','R-ADMIN'].includes(actorRows[0]?.role)) {
        throw new ForbiddenException({ code: 'OFFBOARDING_NOT_AUTHORIZED' });
      }
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
      if (targetMember.status === 'REMOVED') {
        throw new ConflictException({ code: 'MEMBERSHIP_ALREADY_REMOVED' });
      }
      if (actorRows[0]?.role !== 'R-OWNER' &&
          ['R-OWNER','R-ADMIN'].includes(targetMember.role)) {
        throw new ForbiddenException({ code: 'PROTECTED_MEMBER_TRANSITION' });
      }

      // Guardrail (11 §4.13 & WF-21): Cannot suspend or remove the sole Owner
      if (targetMember.role === 'R-OWNER' && input.action !== 'REASSIGN_ONLY') {
        throw new ConflictException({
          code: 'CANNOT_REMOVE_SOLE_OWNER',
          title: 'Cannot remove organisation owner',
          detail: 'Transfer ownership to another active member before suspending or removing the owner (FR-IAM-004).',
        });
      }

      if (input.action === 'SUSPEND' || input.action === 'REMOVE') {
        // An offboarded identity must not leave live invitation credentials
        // delegating its former organisation authority to others.
        await client.query(
          `UPDATE invitations SET status='REVOKED'
             WHERE org_id=$1 AND invited_by=$2 AND status IN ('PENDING','DELIVERY_PENDING')`,
          [ctx.orgId,input.targetUserId],
        );
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

      // 2. Compute the WF-21 Gap Report across all active projects (Top 25 Item 19)
      const gapReport = await this.computeMemberGapReport(client, ctx.orgId, input.targetUserId);
      const hasOpenWork =
        gapReport.openRequirementsCount > 0 ||
        gapReport.pendingReviewsCount > 0 ||
        gapReport.draftPackagesCount > 0 ||
        (gapReport.assignedDefectsCount ?? 0) > 0;

      if (hasOpenWork && !input.replacementUserId && input.action === 'REMOVE') {
        throw new ConflictException({
          code: 'OPEN_WORK_REQUIRES_REASSIGNMENT',
          title: 'Member owns open requirements, reviews, packages or defects',
          detail:
            'Reassign all open requirements, pending reviews, draft packages, and defects to an eligible member before removing this user (WF-21 / AUD-P-12).',
          fieldErrors: [{ field: 'replacementUserId', message: JSON.stringify(gapReport) }],
        });
      }

      // PH2-G03-004: acquire replacement membership and current identity
      // locks before project locks, matching live project-member admission.
      // Org membership alone does not grant every project responsibility.
      let replacementOrgRole: string | null = null;
      if (input.replacementUserId) {
        const { rows: eligibleReplacement } = await client.query(
          `SELECT m.role FROM memberships m
             JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
            WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
            FOR SHARE OF m, u`,
          [ctx.orgId, input.replacementUserId],
        );
        if (!eligibleReplacement.length) {
          throw new UnprocessableEntityException({ code: 'INVALID_REPLACEMENT_MEMBER' });
        }
        replacementOrgRole = eligibleReplacement[0].role;
      }

      // PH2-G03-003: project closure and reassignment must serialize on the
      // same project rows. Checking status before acquiring these locks would
      // let a concurrent closure commit while responsibilities are rewritten.
      if (input.replacementUserId) {
        const { rows: affectedProjects } = await client.query(
          `SELECT p.id,p.status FROM projects p
             WHERE p.org_id=$1 AND (
               EXISTS (SELECT 1 FROM requirements r
                 WHERE r.org_id=p.org_id AND r.project_id=p.id AND r.owner_user_id=$2
                   AND r.status NOT IN ('APPROVED','WAIVED','NOT_APPLICABLE','SUPERSEDED'))
               OR EXISTS (SELECT 1 FROM reviews rv
                 WHERE rv.org_id=p.org_id AND rv.project_id=p.id
                   AND rv.reviewer_user_id=$2 AND rv.status IN ('PENDING','IN_REVIEW'))
               OR EXISTS (SELECT 1 FROM handover_packages hp
                 WHERE hp.org_id=p.org_id AND hp.project_id=p.id AND hp.requested_by=$2
                   AND hp.status IN ('DRAFT','QUEUED','GENERATING'))
               OR EXISTS (SELECT 1 FROM defects d
                 WHERE d.org_id=p.org_id AND d.project_id=p.id AND d.assigned_user_id=$2
                   AND d.status IN ('OPEN','IN_PROGRESS'))
             ) ORDER BY p.id FOR UPDATE OF p`,
          [ctx.orgId, input.targetUserId],
        );
        if (affectedProjects.some(project => !['DRAFT','ACTIVE','HANDOVER'].includes(project.status))) {
          throw new ConflictException({
            code: 'PROJECT_LIFECYCLE_BLOCKS_REASSIGNMENT',
            detail: 'Reopen the affected project before moving its outstanding responsibilities.',
          });
        }
        if (!['R-OWNER','R-ADMIN'].includes(replacementOrgRole ?? '')) {
          for (const affected of affectedProjects) {
            const { rows: scope } = await client.query(
              `SELECT role FROM project_members
                WHERE org_id=$1 AND project_id=$2 AND user_id=$3
                  AND status='ACTIVE' FOR SHARE`,
              [ctx.orgId, affected.id, input.replacementUserId],
            );
            if (!scope.length) {
              throw new UnprocessableEntityException({
                code: 'REPLACEMENT_PROJECT_SCOPE_REQUIRED',
              });
            }
          }
        }
        const { rows: externalReviews } = await client.query(
          `SELECT id FROM reviews WHERE org_id=$1 AND reviewer_user_id=$2
             AND status IN ('PENDING','IN_REVIEW')
             AND reviewer_subject_type IS DISTINCT FROM 'USER' LIMIT 1`,
          [ctx.orgId, input.targetUserId],
        );
        if (externalReviews.length) {
          throw new ConflictException({ code: 'EXTERNAL_REVIEW_AUTHORITY_REQUIRES_REVERIFICATION' });
        }
      }

      // 3. Perform Bulk Reassignment if replacementUserId is provided (FR-IAM-008 / SCR-056 / Top 25 Item 19)
      if (input.replacementUserId) {
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
                  row_version = row_version + 1
            WHERE org_id = $1 AND reviewer_user_id = $2
              AND reviewer_subject_type = 'USER'
              AND status IN ('PENDING', 'IN_REVIEW')`,
          [ctx.orgId, input.targetUserId, input.replacementUserId],
        );

        await client.query(
          `UPDATE handover_packages
              SET requested_by = $3, updated_at = now()
            WHERE org_id = $1 AND requested_by = $2
              AND status IN ('DRAFT', 'QUEUED', 'GENERATING')`,
          [ctx.orgId, input.targetUserId, input.replacementUserId],
        );

        await client.query(
          `UPDATE defects
              SET assigned_user_id = $3
            WHERE org_id = $1 AND assigned_user_id = $2
              AND status IN ('OPEN', 'IN_PROGRESS')`,
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
  async suspendMember(ctx: TenantActorContext, orgId: string, targetUserId: string) {
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);
    return this.offboardOrReassignMember(ctx,{
      targetUserId,action:'SUSPEND',
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
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);
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
  async requestOwnershipTransfer(ctx:TenantActorContext,input:{targetUserId:string;rowVersion:number;requestKey:string}) {
    return new OwnershipTransfersService(this.pool).request(ctx,input);
  }
  async acceptOwnershipTransfer(ctx:TenantActorContext,id:string) {
    return new OwnershipTransfersService(this.pool).decide(ctx,id,'ACCEPT');
  }
  async cancelOwnershipTransfer(ctx:TenantActorContext,id:string) {
    return new OwnershipTransfersService(this.pool).decide(ctx,id,'CANCEL');
  }

  async transferOwnership(ctx: TenantActorContext, newOwnerUserId: string) {
    if (typeof newOwnerUserId !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(newOwnerUserId)) {
      throw new UnprocessableEntityException({code:'INVALID_TARGET_OWNER'});
    }
    if (newOwnerUserId === ctx.userId) {
      throw new UnprocessableEntityException({code:'OWNER_TRANSFER_REQUIRES_DIFFERENT_MEMBER'});
    }
    // FR-ORG-014 requires an expiring, two-party identity-bound intent with
    // recipient confirmation and fresh MFA. A one-sided POST must never
    // transfer sole control. This remains disabled until that contract is
    // implemented and independently accepted.
    throw new ConflictException({
      code:'OWNERSHIP_TWO_PARTY_CONFIRMATION_REQUIRED',
      detail:'One-sided ownership transfer is disabled until two-party confirmation is available.',
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
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);
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
    orgId=resolveOrganisationTarget(ctx.orgId,orgId);

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
              COUNT(DISTINCT rv.id)::int AS pending_reviews,
              ARRAY_AGG(DISTINCT r.reviewer_role) FILTER (WHERE r.reviewer_role IS NOT NULL) AS needed_roles
         FROM reviews rv
         JOIN projects p ON p.org_id = rv.org_id AND p.id = rv.project_id
         LEFT JOIN document_versions dv ON dv.org_id = rv.org_id AND dv.project_id = rv.project_id AND dv.id = rv.document_version_id
         LEFT JOIN document_requirements dr ON dr.org_id = rv.org_id AND dr.project_id = rv.project_id AND dr.document_id = dv.document_id
         LEFT JOIN requirements r ON r.org_id = dr.org_id AND r.project_id = dr.project_id AND r.id = dr.requirement_id
        WHERE rv.org_id = $1 AND rv.reviewer_user_id = $2
          AND rv.status IN ('PENDING','IN_REVIEW')
        GROUP BY p.id, p.code`,
      [orgId, targetUserId],
    );

    const { rows: pkgRows } = await client.query(
      `SELECT p.id AS project_id, p.code AS project_code, COUNT(hp.id)::int AS draft_packages
         FROM handover_packages hp
         JOIN projects p ON p.org_id = hp.org_id AND p.id = hp.project_id
        WHERE hp.org_id = $1 AND hp.requested_by = $2
          AND hp.status IN ('DRAFT', 'QUEUED', 'GENERATING')
        GROUP BY p.id, p.code`,
      [orgId, targetUserId],
    );

    const { rows: defectRows } = await client.query(
      `SELECT p.id AS project_id, p.code AS project_code, COUNT(d.id)::int AS open_defects
         FROM defects d
         JOIN projects p ON p.org_id = d.org_id AND p.id = d.project_id
        WHERE d.org_id = $1 AND d.assigned_user_id = $2
          AND d.status IN ('OPEN', 'IN_PROGRESS')
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
        draftPackages: number;
        assignedDefects: number;
        requiredReplacementRoles: string[];
      }
    >();

    let totalReqs = 0;
    let totalRevs = 0;
    let totalDraftPkgs = 0;
    let totalDefects = 0;

    for (const r of reqRows) {
      totalReqs += r.open_reqs;
      projectMap.set(r.project_id, {
        projectId: r.project_id,
        projectCode: r.project_code,
        openRequirements: r.open_reqs,
        pendingReviews: 0,
        draftPackages: 0,
        assignedDefects: 0,
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
        draftPackages: 0,
        assignedDefects: 0,
        requiredReplacementRoles: [],
      };
      existing.pendingReviews = rv.pending_reviews;
      existing.requiredReplacementRoles = rv.needed_roles ?? [];
      projectMap.set(rv.project_id, existing);
    }

    for (const pk of pkgRows) {
      totalDraftPkgs += pk.draft_packages;
      const existing = projectMap.get(pk.project_id) ?? {
        projectId: pk.project_id,
        projectCode: pk.project_code,
        openRequirements: 0,
        pendingReviews: 0,
        draftPackages: 0,
        assignedDefects: 0,
        requiredReplacementRoles: [],
      };
      existing.draftPackages = pk.draft_packages;
      projectMap.set(pk.project_id, existing);
    }

    for (const df of defectRows) {
      totalDefects += df.open_defects;
      const existing = projectMap.get(df.project_id) ?? {
        projectId: df.project_id,
        projectCode: df.project_code,
        openRequirements: 0,
        pendingReviews: 0,
        draftPackages: 0,
        assignedDefects: 0,
        requiredReplacementRoles: [],
      };
      existing.assignedDefects = df.open_defects;
      projectMap.set(df.project_id, existing);
    }

    return {
      targetUserId,
      openRequirementsCount: totalReqs,
      pendingReviewsCount: totalRevs,
      draftPackagesCount: totalDraftPkgs,
      assignedDefectsCount: totalDefects,
      byProject: Array.from(projectMap.values()),
    };
  }

  async getAuditLog(ctx: TenantActorContext, targetOrgId: string) {
    const orgId = targetOrgId === 'current' ? ctx.orgId : targetOrgId;
    if (orgId !== ctx.orgId || ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new NotFoundException('ORGANISATION_NOT_FOUND');
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      // PH2-G03: a project-scoped audit grant cannot turn the unscoped
      // organisation audit endpoint into a full-tenant data leak.
      // Fetch the CURRENT account and org membership inside the transaction,
      // not the possibly stale role claims in the browser session.
      const { rows: liveMembers } = await client.query(
        `SELECT m.role FROM memberships m
           JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
          WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
          FOR SHARE OF m,u`,
        [orgId, ctx.userId],
      );
      if (!liveMembers.length ||
          !hasPermission({orgRole:liveMembers[0].role}, 'audit.read').allowed) {
        throw new ForbiddenException({code:'AUDIT_READ_RESTRICTED'});
      }
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
