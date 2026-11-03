// apps/api/src/modules/parties/parties.service.ts
// Guest grants, Supplier upload links, OTP & rate limits (API-024..029, RT-014, CB-007, FR-DOC-032, AUD-P-15)

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';

export interface CreatePartyDto {
  name: string;
  types: string[];
  gstin?: string;
  email?: string;
  phone?: string;
}

export interface CreateGuestGrantDto {
  partyId?: string;
  grantType?: 'SUPPLIER' | 'CONSULTANT' | 'CLIENT' | 'AUDITOR';
  role?: string;
  capabilities?: string[];
  scopeJson?: Record<string, any>;
  otpRequired?: boolean;
  phone?: string;
  email?: string;
  expiresInDays?: number;
}

@Injectable()
export class PartiesService {
  constructor(private readonly db: TenantDbService) {}

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * GET /api/v1/parties
   * Returns all counterparties for the tenant organisation.
   */
  async getParties(ctx: ExecutionContext) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT id, org_id, name, types, gstin, email, phone, status, created_at
           FROM parties
          WHERE org_id = $1
          ORDER BY name ASC`,
        [ctx.orgId],
      );
      return res.rows;
    });
  }

  /**
   * POST /api/v1/parties
   * Registers a new counterparty (Client, MC, Consultant, Supplier OEM, Lab).
   */
  async createParty(ctx: ExecutionContext, dto: CreatePartyDto) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const id = uuidv7();
      const res = await client.query(
        `INSERT INTO parties (
          id, org_id, name, types, gstin, email, phone, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8)
        RETURNING id, org_id, name, types, gstin, email, phone, status, created_at`,
        [
          id,
          ctx.orgId,
          dto.name.trim(),
          dto.types && dto.types.length ? dto.types : ['SUPPLIER_OEM'],
          dto.gstin?.trim() || null,
          dto.email?.trim() || null,
          dto.phone?.trim() || null,
          ctx.userId,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * API-024 POST /projects/:projectId/guest-grants
   * Issues a scoped guest grant with a raw secret token (hash stored in DB).
   */
  async createGuestGrant(ctx: ExecutionContext, projectId: string, dto: CreateGuestGrantDto) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashSecret(rawToken);
      const grantId = uuidv7();

      const days = dto.expiresInDays && dto.expiresInDays > 0 ? dto.expiresInDays : 7;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const res = await client.query(
        `INSERT INTO guest_grants (
          id, org_id, project_id, party_id, grant_type, role,
          capabilities, scope_json, otp_required, target_phone_e164, target_email,
          token_hash, status, expires_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE', $13, $14)
        RETURNING *`,
        [
          grantId,
          ctx.orgId,
          projectId,
          dto.partyId || null,
          dto.grantType || 'SUPPLIER',
          dto.role || 'R-SUPPLIER-OEM',
          dto.capabilities || ['REQUIREMENT_UPLOAD', 'DOCUMENT_VIEW'],
          JSON.stringify(dto.scopeJson || {}),
          dto.otpRequired ?? true,
          dto.phone || null,
          dto.email || null,
          tokenHash,
          expiresAt,
          ctx.userId,
        ],
      );

      return {
        grantId,
        token: rawToken,
        link: `/guest/${rawToken}`,
        expiresAt,
        role: dto.role || 'R-SUPPLIER-OEM',
        capabilities: res.rows[0].capabilities,
        scope: dto.scopeJson || {},
      };
    });
  }

  /**
   * API-025 POST /guest-grants/:id/revoke
   * Revokes a guest grant within 60s and terminates any active sessions.
   */
  async revokeGuestGrant(ctx: ExecutionContext, grantId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const grantRes = await client.query(
        `UPDATE guest_grants
            SET status = 'REVOKED', revoked_at = now()
          WHERE org_id = $1 AND id = $2 AND status = 'ACTIVE'
          RETURNING id`,
        [ctx.orgId, grantId],
      );
      if (!grantRes.rows.length) {
        throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_ALREADY_REVOKED');
      }

      // Revoke any active guest sessions linked to this grant
      await client.query(
        `UPDATE sessions SET revoked_at = now() WHERE active_org_id = $1 AND guest_grant_id = $2`,
        [ctx.orgId, grantId],
      );

      return { grantId, status: 'REVOKED' };
    });
  }

  /**
   * API-026 POST /projects/:projectId/supplier-upload-links
   * Creates a single-use or scoped supplier upload link (FR-DOC-032, AUD-P-15).
   */
  async createSupplierUploadLink(
    ctx: ExecutionContext,
    projectId: string,
    dto: {
      supplierPartyId: string;
      requirementIds: string[];
      phone?: string;
      email?: string;
      expiresInDays?: number;
    },
  ) {
    if (!dto.requirementIds || dto.requirementIds.length === 0) {
      throw new BadRequestException('At least one requirementId must be assigned to the upload link');
    }

    return this.createGuestGrant(ctx, projectId, {
      partyId: dto.supplierPartyId,
      grantType: 'SUPPLIER',
      role: 'R-SUPPLIER-OEM',
      capabilities: ['REQUIREMENT_UPLOAD', 'DOCUMENT_VIEW'],
      scopeJson: {
        projectId,
        supplierPartyId: dto.supplierPartyId,
        requirementIds: dto.requirementIds,
      },
      phone: dto.phone,
      email: dto.email,
      expiresInDays: dto.expiresInDays || 14,
    });
  }

  /**
   * Enforces TC-PTY-01: Verifies that a guest session only accesses requirements in its scope.
   */
  async validateSupplierRequirementAccess(
    guestScope: { requirementIds?: string[]; projectId?: string },
    targetRequirementId: string,
  ) {
    if (!guestScope || !guestScope.requirementIds || !guestScope.requirementIds.includes(targetRequirementId)) {
      throw new NotFoundException({
        code: 'REQUIREMENT_NOT_FOUND',
        title: 'Requirement not found in guest scope',
        detail: 'The requested requirement is not assigned to this guest session (TC-PTY-01).',
      });
    }
  }

  /**
   * API-028 GET /guest/:token (RT-014)
   */
  async getGuestGrant(token: string) {
    const tokenHash = this.hashSecret(token);
    return await this.db.withTokenContext(tokenHash, async (client) => {
      const res = await client.query(
        `SELECT id, org_id, project_id, party_id, grant_type, role, capabilities, scope_json, otp_required, target_phone_e164, target_email, cooldown_until, expires_at
         FROM guest_grants
         WHERE token_hash = $1 AND status = 'ACTIVE' AND expires_at > now()`,
        [tokenHash],
      );
      if (!res.rows.length) {
        throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
      }
      const grant = res.rows[0];
      if (grant.cooldown_until && new Date(grant.cooldown_until) > new Date()) {
        throw new ForbiddenException(`RATE_LIMIT_COOLDOWN_ACTIVE: Try again after ${grant.cooldown_until}`);
      }

      // Query contractor org and project metadata
      const metaRes = await client.query(
        `SELECT o.display_name AS contractor_name, op.brand_color, p.name AS project_name, p.code AS project_code
           FROM organisations o
           LEFT JOIN org_profiles op ON op.org_id = o.id
           LEFT JOIN projects p ON p.org_id = o.id AND p.id = $2
          WHERE o.id = $1`,
        [grant.org_id, grant.project_id],
      );
      const meta = metaRes.rows[0] || {};

      let assignedRequirements: any[] = [];
      const allowedReqIds: string[] = Array.isArray(grant.scope_json?.requirementIds)
        ? grant.scope_json.requirementIds
        : [];
      if (allowedReqIds.length > 0) {
        const reqRes = await client.query(
          `SELECT id, requirement_key, title, doc_type_key, status, due_at
             FROM requirements
            WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])
              AND superseded_at IS NULL`,
          [grant.org_id, grant.project_id, allowedReqIds],
        );
        assignedRequirements = reqRes.rows.map((r: any) => ({
          id: r.id,
          requirementKey: r.requirement_key,
          title: r.title,
          docTypeKey: r.doc_type_key,
          status: r.status,
          dueAt: r.due_at,
        }));
      }

      return {
        ...grant,
        grantId: grant.id,
        grantType: grant.grant_type,
        projectId: grant.project_id,
        contractorName: meta.contractor_name || 'TradeCloseout Contractor',
        brandColor: meta.brand_color || '#0F172A',
        projectName: meta.project_name || 'Project Closeout',
        projectCode: meta.project_code || '',
        otpRequired: grant.otp_required,
        otpVerified: !grant.otp_required,
        supportContactText: `Contact ${meta.contractor_name || 'the contractor'} for assistance.`,
        assignedRequirements,
      };
    });
  }

  /**
   * API-028A POST /guest/:token/otp/request (RT-014, CB-007, CB-011)
   */
  async requestGuestOtp(token: string): Promise<{ success: boolean; maskedTarget: string }> {
    const tokenHash = this.hashSecret(token);
    return await this.db.withTokenContext(tokenHash, async (client) => {
      const grants = (
        await client.query(
          `SELECT * FROM guest_grants
           WHERE token_hash = $1 AND status = 'ACTIVE' AND expires_at > now()`,
          [tokenHash],
        )
      ).rows;

      if (!grants.length) {
        throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
      }
      const grant = grants[0];

      // Check 15-minute cooldown
      if (grant.cooldown_until && new Date(grant.cooldown_until) > new Date()) {
        throw new ForbiddenException(`RATE_LIMIT_COOLDOWN_ACTIVE: Try again after ${grant.cooldown_until}`);
      }

      // Check sliding window request counters (max 3/hr, 10/day - RT-014)
      const recentHourly = (
        await client.query(
          `SELECT count(*) as count FROM otp_challenges
           WHERE guest_grant_id = $1 AND created_at > now() - interval '1 hour'`,
          [grant.id],
        )
      ).rows;
      if (Number(recentHourly[0]?.count || 0) >= 3) {
        throw new ForbiddenException('HOURLY_OTP_LIMIT_EXCEEDED: Maximum 3 requests per hour');
      }

      const recentDaily = (
        await client.query(
          `SELECT count(*) as count FROM otp_challenges
           WHERE guest_grant_id = $1 AND created_at > now() - interval '24 hours'`,
          [grant.id],
        )
      ).rows;
      if (Number(recentDaily[0]?.count || 0) >= 10) {
        throw new ForbiddenException('DAILY_OTP_LIMIT_EXCEEDED: Maximum 10 requests per day');
      }

      const rawCode = crypto.randomInt(100000, 999999).toString();
      const codeHash = this.hashSecret(rawCode);
      const challengeId = uuidv7();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const targetIdentifier = grant.target_phone_e164 || grant.target_email || 'guest';
      const channel = grant.target_phone_e164 ? 'SMS' : 'EMAIL';

      await client.query(
        `INSERT INTO otp_challenges (id, channel, identifier, purpose, guest_grant_id, code_hash, expires_at)
         VALUES ($1, $2, $3, 'GUEST_ACCESS', $4, $5, $6)`,
        [challengeId, channel, targetIdentifier, grant.id, codeHash, expiresAt],
      );

      const maskedTarget = targetIdentifier.replace(/^(\+?\d{2,4})\d+(\d{4})$/, '$1******$2');
      return { success: true, maskedTarget };
    });
  }

  /**
   * API-028B POST /guest/:token/otp/verify (RT-014, CB-007, CB-011)
   */
  async verifyGuestOtp(
    token: string,
    code: string,
  ): Promise<{ sessionToken: string; activeOrgId: string; grantId: string; csrfToken: string }> {
    const tokenHash = this.hashSecret(token);
    return await this.db.withTokenContext(tokenHash, async (client) => {
      const grants = (
        await client.query(
          `SELECT * FROM guest_grants
           WHERE token_hash = $1 AND status = 'ACTIVE' AND expires_at > now()`,
          [tokenHash],
        )
      ).rows;

      if (!grants.length) {
        throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
      }
      const grant = grants[0];

      // Check cooldown
      if (grant.cooldown_until && new Date(grant.cooldown_until) > new Date()) {
        throw new ForbiddenException('COOLDOWN_ACTIVE');
      }

      const challenges = (
        await client.query(
          `SELECT * FROM otp_challenges
           WHERE guest_grant_id = $1 AND purpose = 'GUEST_ACCESS' AND consumed_at IS NULL AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1`,
          [grant.id],
        )
      ).rows;

      if (!challenges.length) {
        throw new UnauthorizedException('NO_ACTIVE_CHALLENGE');
      }

      const challenge = challenges[0];
      const incomingHash = this.hashSecret(code);

      if (challenge.code_hash !== incomingHash) {
        const newAttempts = (grant.failed_otp_count || 0) + 1;
        if (newAttempts >= 5) {
          // Enforce 15-minute cooldown (RT-014)
          const cooldownUntil = new Date(Date.now() + 15 * 60 * 1000);
          await client.query(
            `UPDATE guest_grants SET failed_otp_count = 0, cooldown_until = $1 WHERE id = $2`,
            [cooldownUntil, grant.id],
          );
          throw new ForbiddenException('TOO_MANY_FAILED_ATTEMPTS: 15-minute cooldown activated');
        } else {
          await client.query(
            `UPDATE guest_grants SET failed_otp_count = $1 WHERE id = $2`,
            [newAttempts, grant.id],
          );
          throw new UnauthorizedException('INVALID_OTP_CODE');
        }
      }

      // Mark challenge consumed & reset failed attempts
      await client.query(
        `UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`,
        [challenge.id],
      );
      await client.query(
        `UPDATE guest_grants SET failed_otp_count = 0, cooldown_until = NULL WHERE id = $1`,
        [grant.id],
      );

      // Create Guest Session
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const csrfToken = crypto.randomBytes(32).toString('hex');
      const sessionId = uuidv7();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for guest

      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, active_org_id, guest_grant_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, grant.created_by, this.hashSecret(sessionToken), this.hashSecret(csrfToken), grant.org_id, grant.id, expiresAt],
      );

      return { sessionToken, activeOrgId: grant.org_id, grantId: grant.id, csrfToken };
    });
  }
}
