// apps/api/src/modules/parties/parties.service.ts
// Guest grants, Supplier upload links, OTP & rate limits (API-024..029, RT-014, CB-007, FR-DOC-032, AUD-P-15)

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { DltSmsGateway, TransactionalMailGateway } from '../identity/identity.controller';
import { consumeAuthenticationBudget, deriveSessionCsrf, isProductionEnvironment } from '../identity/auth-security';

export interface CreatePartyDto {
  name: string;
  types: string[];
  gstin?: string;
  email?: string;
  phone?: string;
}

export interface GuestGrantProfile {
  grantType: 'SUPPLIER_UPLOAD' | 'SUPPLIER_CONTRIBUTOR' | 'CONSULTANT_REVIEW' | 'CLIENT_VIEW' | 'MC_VIEW' | 'AUDITOR_READ';
  role: string;
  capabilities: string[];
}

export const GUEST_GRANT_PROFILES: Record<string, GuestGrantProfile> = {
  SUPPLIER_UPLOAD: {
    grantType: 'SUPPLIER_UPLOAD',
    role: 'R-SUPPLIER-OEM',
    capabilities: ['document.upload', 'document.read'],
  },
  SUPPLIER_CONTRIBUTOR: {
    grantType: 'SUPPLIER_CONTRIBUTOR',
    role: 'R-SUBCONTRACTOR',
    capabilities: ['document.upload', 'document.read', 'review.read', 'defect.manage'],
  },
  CONSULTANT_REVIEW: {
    grantType: 'CONSULTANT_REVIEW',
    role: 'R-CONSULTANT',
    capabilities: ['project.read', 'asset.read', 'document.read', 'document.download', 'review.read', 'review.decide', 'package.download', 'inspection.witness'],
  },
  CLIENT_VIEW: {
    grantType: 'CLIENT_VIEW',
    role: 'R-CLIENT',
    capabilities: ['project.read', 'document.read', 'document.download', 'package.download', 'package.accept', 'inspection.witness'],
  },
  MC_VIEW: {
    grantType: 'MC_VIEW',
    role: 'R-SITE',
    capabilities: ['project.read', 'asset.read', 'document.read', 'document.download', 'review.read', 'package.download'],
  },
  AUDITOR_READ: {
    grantType: 'AUDITOR_READ',
    role: 'R-AUDITOR',
    capabilities: ['project.read', 'asset.read', 'document.read', 'document.download', 'review.read', 'package.download'],
  },
};

export interface CreateGuestGrantDto {
  partyId?: string;
  grantType?: string;
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
  constructor(
    private readonly db: TenantDbService,
    @Optional() private readonly smsGateway?: DltSmsGateway,
    @Optional() private readonly mailGateway?: TransactionalMailGateway,
  ) {}

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
    if (!dto || typeof dto.partyId !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(dto.partyId)) {
      throw new BadRequestException({ code: 'PARTY_ID_REQUIRED' });
    }
    if (dto.expiresInDays !== undefined &&
        (!Number.isInteger(dto.expiresInDays) || dto.expiresInDays < 1 || dto.expiresInDays > 30)) {
      throw new BadRequestException({ code: 'INVALID_GUEST_GRANT_EXPIRATION' });
    }
    const providedEmail = typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
    const providedPhone = typeof dto.phone === 'string' ? dto.phone.trim() : '';
    if ((dto.email !== undefined && !providedEmail) ||
        (dto.phone !== undefined && !providedPhone) ||
        (!providedEmail && !providedPhone) ||
        (providedEmail && (providedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedEmail))) ||
        (providedPhone && !/^\+91[6-9][0-9]{9}$/.test(providedPhone))) {
      throw new BadRequestException({ code: 'INVALID_GUEST_CONTACT' });
    }
    if (dto.capabilities !== undefined &&
        (!Array.isArray(dto.capabilities) || dto.capabilities.length > 50 ||
         dto.capabilities.some(cap => typeof cap !== 'string'))) {
      throw new BadRequestException({ code: 'INVALID_GUEST_CAPABILITIES' });
    }

    if (ctx.actorType === 'GUEST') {
      throw new ForbiddenException('GUEST_CANNOT_ISSUE_GRANTS: Guests cannot issue guest grants');
    }

    const rawType = (dto.grantType || 'SUPPLIER_UPLOAD').toUpperCase();
    const typeMap: Record<string, keyof typeof GUEST_GRANT_PROFILES> = {
      SUPPLIER: 'SUPPLIER_UPLOAD',
      SUPPLIER_UPLOAD: 'SUPPLIER_UPLOAD',
      SUPPLIER_CONTRIBUTOR: 'SUPPLIER_CONTRIBUTOR',
      CONSULTANT: 'CONSULTANT_REVIEW',
      CONSULTANT_REVIEW: 'CONSULTANT_REVIEW',
      CLIENT: 'CLIENT_VIEW',
      CLIENT_VIEW: 'CLIENT_VIEW',
      MC: 'MC_VIEW',
      MC_VIEW: 'MC_VIEW',
      AUDITOR: 'AUDITOR_READ',
      AUDITOR_READ: 'AUDITOR_READ',
    };
    const profileKey = typeMap[rawType];
    if (!profileKey || !GUEST_GRANT_PROFILES[profileKey]) {
      throw new BadRequestException(`INVALID_GRANT_TYPE: Grant type '${dto.grantType}' is unrecognized`);
    }

    // Issuer delegation ceiling (FV01): Procurement (R-PROC) and Subcontractors can only issue supplier grants
    if (ctx.orgRole === 'R-PROC' || ctx.orgRole === 'R-SUBCONTRACTOR') {
      if (profileKey !== 'SUPPLIER_UPLOAD' && profileKey !== 'SUPPLIER_CONTRIBUTOR') {
        throw new ForbiddenException('DELEGATION_CEILING_EXCEEDED: Procurement members can only issue supplier grants');
      }
    }

    // Only Owner, Admin, PM, or Doc Controller can issue Client or Consultant grants
    if (profileKey === 'CLIENT_VIEW' || profileKey === 'CONSULTANT_REVIEW') {
      const allowedRoles = new Set(['R-OWNER', 'R-ADMIN', 'R-PM', 'R-DOC']);
      if (!allowedRoles.has(ctx.orgRole || '') && !allowedRoles.has(ctx.projectRole || '')) {
        throw new ForbiddenException(`DELEGATION_CEILING_EXCEEDED: Cannot issue ${profileKey} grant without management authority`);
      }
    }

    const profile = GUEST_GRANT_PROFILES[profileKey];
    const grantType = profile.grantType;

    // Forbid internal organisation roles or role override attempts (FV01)
    const FORBIDDEN_GUEST_ROLES = new Set([
      'R-OWNER',
      'R-ADMIN',
      'R-PROC',
      'R-SAFETY',
      'R-DOC',
      'R-BILLING',
      'R-PM',
    ]);
    if (dto.role && (FORBIDDEN_GUEST_ROLES.has(dto.role) || dto.role !== profile.role)) {
      throw new BadRequestException(`INVALID_GUEST_ROLE: Guest grants cannot adopt internal role '${dto.role}' or override profile role '${profile.role}'`);
    }
    const role = profile.role;

    // Capabilities ceiling: must be strict subset of profile capabilities (FV01)
    let capabilities = profile.capabilities;
    if (dto.capabilities && dto.capabilities.length > 0) {
      for (const cap of dto.capabilities) {
        if (!profile.capabilities.includes(cap)) {
          throw new BadRequestException(`UNAUTHORIZED_CAPABILITY: Capability '${cap}' exceeds grant profile ceiling for '${grantType}'`);
        }
      }
      capabilities = dto.capabilities;
    }

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
          dto.partyId,
          grantType,
          role,
          capabilities,
          JSON.stringify(dto.scopeJson || {}),
          dto.otpRequired ?? true,
          providedPhone || null,
          providedEmail || null,
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
        role,
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
            SET status = 'REVOKED'
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
      grantType: 'SUPPLIER_UPLOAD',
      role: 'R-SUPPLIER-OEM',
      capabilities: ['document.upload', 'document.read'],
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
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) {
      throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
    }
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
      await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [grant.org_id]);
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

      return {
        grantId: grant.id,
        grantType: grant.grant_type,
        projectId: grant.project_id,
        contractorName: meta.contractor_name || 'TradeCloseout Contractor',
        brandColor: meta.brand_color || '#0F172A',
        projectName: meta.project_name || 'Project Closeout',
        projectCode: meta.project_code || '',
        otpRequired: true,
        otpVerified: false,
        supportContactText: `Contact ${meta.contractor_name || 'the contractor'} for assistance.`,
      };
    });
  }

  async getGuestSessionContext(ctx: ExecutionContext) {
    if (ctx.actorType !== 'GUEST' || !ctx.guestGrantId) throw new NotFoundException('GUEST_GRANT_NOT_FOUND');
    return this.db.withTenantContext(ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id, project_id, scope_json FROM guest_grants
          WHERE org_id = $1 AND id = $2 AND status = 'ACTIVE' AND expires_at > now()`,
        [ctx.orgId, ctx.guestGrantId],
      );
      if (!rows.length) throw new NotFoundException('GUEST_GRANT_NOT_FOUND');
      const grant = rows[0];
      const allowedIds: string[] = Array.isArray(grant.scope_json?.requirementIds) ? grant.scope_json.requirementIds : [];
      const reqs = allowedIds.length ? await client.query(
        `SELECT id, requirement_key, title, doc_type_key, status, due_at FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) AND superseded_at IS NULL
          ORDER BY requirement_key, id`,
        [ctx.orgId, grant.project_id, allowedIds],
      ) : { rows: [] };
      return {
        grantId: grant.id,
        projectId: grant.project_id,
        otpVerified: true,
        assignedRequirements: reqs.rows.map((r: any) => ({
          id: r.id, requirementKey: r.requirement_key, title: r.title,
          docTypeKey: r.doc_type_key, status: r.status, dueAt: r.due_at,
        })),
      };
    });
  }

  /**
   * API-028A POST /guest/:token/otp/request (RT-014, CB-007, CB-011)
   */
  async requestGuestOtp(token: string, sourceIp = 'unknown', authIntentHash: string | null = null): Promise<{ success: boolean; challengeId: string; maskedTarget: string; channel: string; debugOtp?: string }> {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) {
      throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
    }
    const tokenHash = this.hashSecret(token);
    if (isProductionEnvironment()) {
      await consumeAuthenticationBudget(this.db.getPool(), 'guest-otp:ip:hour', sourceIp, 20, 3600);
      await consumeAuthenticationBudget(this.db.getPool(), 'guest-otp:grant:hour', tokenHash, 3, 3600);
      await consumeAuthenticationBudget(this.db.getPool(), 'guest-otp:global:hour', 'all', 6000, 3600);
    }
    const prepared = await this.db.withTokenContext(tokenHash, async (client) => {
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
      await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [grants[0].org_id]);
      const locked = await client.query(
        `SELECT * FROM guest_grants
          WHERE id = $1 AND org_id = $2 AND token_hash = $3 AND status = 'ACTIVE' AND expires_at > now()
          FOR UPDATE`,
        [grants[0].id, grants[0].org_id, tokenHash],
      );
      if (!locked.rows.length) throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
      const grant = locked.rows[0];

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
      const challengeId = uuidv7();
      const otpSecret = process.env.AUTH_OTP_HMAC_KEY;
      const codeHash = isProductionEnvironment()
        ? crypto.createHmac('sha256', otpSecret!)
          .update(`GUEST_ACCESS:${challengeId}:${grant.id}:${grant.target_phone_e164 || grant.target_email}:${rawCode}`)
          .digest('hex')
        : this.hashSecret(rawCode);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const targetIdentifier = grant.target_phone_e164 || grant.target_email;
      if (!targetIdentifier) throw new UnprocessableEntityException('GUEST_CONTACT_REQUIRED');
      const channel = grant.target_phone_e164 ? 'SMS' : 'EMAIL';

      // One active proof generation per grant: resending invalidates every
      // prior unconsumed OTP, while preserving the historical attempt records.
      await client.query(
        `UPDATE otp_challenges SET consumed_at = now()
          WHERE guest_grant_id = $1 AND purpose = 'GUEST_ACCESS'
            AND consumed_at IS NULL`,
        [grant.id],
      );

      await client.query(
        `INSERT INTO otp_challenges (id, channel, identifier, purpose, guest_grant_id, code_hash, expires_at, delivery_status, auth_intent_hash)
         VALUES ($1, $2, $3, 'GUEST_ACCESS', $4, $5, $6, $7, $8)`,
        [challengeId, channel, targetIdentifier, grant.id, codeHash, expiresAt,
          process.env.ENABLE_DEBUG_OTP === 'true' && !isProductionEnvironment() ? 'SENT' : 'PENDING',
          authIntentHash],
      );

      const isExplicitDebug = process.env.ENABLE_DEBUG_OTP === 'true' && !isProductionEnvironment();
      const maskedTarget = channel === 'EMAIL'
        ? `${targetIdentifier.slice(0, 1)}***@${targetIdentifier.split('@')[1] || 'hidden'}`
        : targetIdentifier.replace(/^(\+?\d{2,4})\d+(\d{4})$/, '$1******$2');
      return { challengeId, maskedTarget, channel, targetIdentifier, rawCode, isExplicitDebug };
    });

    if (!prepared.isExplicitDebug) {
      // Never hold a database grant lock while talking to an external provider.
      // A timeout after provider acceptance is ambiguous and the proof remains
      // non-usable until SENT is committed in its own short transaction.
      try {
        if (prepared.channel === 'SMS') {
          if (!this.smsGateway) throw new ServiceUnavailableException('SMS_GATEWAY_UNAVAILABLE');
          const sent = await this.smsGateway.sendOtpSms(
            prepared.targetIdentifier,
            prepared.rawCode,
            process.env.DLT_GUEST_OTP_TEMPLATE_ID || process.env.DLT_OTP_TEMPLATE_ID || '',
          );
          if (!sent.delivered) throw new ServiceUnavailableException('GUEST_OTP_DELIVERY_FAILED');
        } else {
          if (!this.mailGateway) throw new ServiceUnavailableException('MAIL_GATEWAY_UNAVAILABLE');
          await this.mailGateway.sendOtpEmail(prepared.targetIdentifier, prepared.rawCode, 'GUEST_ACCESS');
        }
      } catch {
        await this.db.withTokenContext(tokenHash, async (client) => {
          await client.query(
            `UPDATE otp_challenges SET delivery_status = 'AMBIGUOUS'
              WHERE id = $1 AND consumed_at IS NULL`,
            [prepared.challengeId],
          );
        }).catch(() => {});
        throw new ServiceUnavailableException({
          code: 'GUEST_OTP_DELIVERY_UNVERIFIED',
          detail: 'The verification code could not be confirmed delivered. Request a new code.',
        });
      }
      await this.db.withTokenContext(tokenHash, async (client) => {
        await client.query(
          `UPDATE otp_challenges SET delivery_status = 'SENT'
            WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
              AND delivery_status = 'PENDING'`,
          [prepared.challengeId],
        );
      });
    }
    return {
      success: true,
      challengeId: prepared.challengeId,
      maskedTarget: prepared.maskedTarget,
      channel: prepared.isExplicitDebug ? 'DEBUG' : prepared.channel,
      debugOtp: prepared.isExplicitDebug ? prepared.rawCode : undefined,
    };
  }

  /**
   * API-028B POST /guest/:token/otp/verify (RT-014, CB-007, CB-011)
   */
  async verifyGuestOtp(
    token: string,
    code: string,
    challengeId: string,
    authIntentHash: string | null = null,
  ): Promise<{ sessionToken: string; activeOrgId: string; grantId: string; csrfToken: string; authGeneration: string }> {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token) ||
        typeof challengeId !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(challengeId) ||
        typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('INVALID_CHALLENGE_OR_CODE');
    }
    const tokenHash = this.hashSecret(token);
    const result = await this.db.withTokenContext(tokenHash, async (client) => {
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
      await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [grants[0].org_id]);
      const locked = await client.query(
        `SELECT * FROM guest_grants
          WHERE id = $1 AND org_id = $2 AND token_hash = $3 AND status = 'ACTIVE' AND expires_at > now()
          FOR UPDATE`,
        [grants[0].id, grants[0].org_id, tokenHash],
      );
      if (!locked.rows.length) throw new NotFoundException('GUEST_GRANT_NOT_FOUND_OR_EXPIRED');
      const grant = locked.rows[0];

      // Check cooldown
      if (grant.cooldown_until && new Date(grant.cooldown_until) > new Date()) {
        throw new ForbiddenException('COOLDOWN_ACTIVE');
      }

      const challenges = (
        await client.query(
          `SELECT * FROM otp_challenges
           WHERE guest_grant_id = $1 AND id = $2 AND purpose = 'GUEST_ACCESS'
             AND consumed_at IS NULL AND expires_at > now()
             AND delivery_status = 'SENT'
             AND NOT EXISTS (
               SELECT 1 FROM otp_challenges newer
                 WHERE newer.guest_grant_id = $1 AND newer.purpose = 'GUEST_ACCESS'
                   AND newer.created_at > otp_challenges.created_at
             )
           LIMIT 1 FOR UPDATE`,
          [grant.id, challengeId],
        )
      ).rows;

      if (!challenges.length) {
        throw new UnauthorizedException('NO_ACTIVE_CHALLENGE');
      }

      const challenge = challenges[0];
      if (isProductionEnvironment() &&
          (!authIntentHash || !challenge.auth_intent_hash ||
           authIntentHash !== challenge.auth_intent_hash)) {
        throw new ForbiddenException({ code: 'LOGIN_INTENT_MISMATCH' });
      }
      const incomingHash = isProductionEnvironment()
        ? crypto.createHmac('sha256', process.env.AUTH_OTP_HMAC_KEY!)
          .update(`GUEST_ACCESS:${challenge.id}:${grant.id}:${challenge.identifier}:${code}`)
          .digest('hex')
        : this.hashSecret(code);

      if (challenge.code_hash !== incomingHash) {
        const newAttempts = (grant.failed_otp_count || 0) + 1;
        if (newAttempts >= 5) {
          // Enforce 15-minute cooldown (RT-014)
          const cooldownUntil = new Date(Date.now() + 15 * 60 * 1000);
          await client.query(
            `UPDATE guest_grants SET failed_otp_count = 0, cooldown_until = $1 WHERE id = $2`,
            [cooldownUntil, grant.id],
          );
          await client.query(
            `INSERT INTO auth_security_events(id,org_id,event_type,outcome,subject_digest)
              VALUES(gen_random_uuid(),$1,$2,$3,$4)`,
            [grant.org_id, 'GUEST_OTP_VERIFICATION',
             'THROTTLED', tokenHash],
          );
          return { failure: 'TOO_MANY_FAILED_ATTEMPTS' as const };
        } else {
          await client.query(
            `UPDATE guest_grants SET failed_otp_count = $1 WHERE id = $2`,
            [newAttempts, grant.id],
          );
          await client.query(
            `INSERT INTO auth_security_events(id,org_id,event_type,outcome,subject_digest)
              VALUES(gen_random_uuid(),$1,$2,$3,$4)`,
            [grant.org_id, 'GUEST_OTP_VERIFICATION',
             'DENIED', tokenHash],
          );
          return { failure: 'INVALID_OTP_CODE' as const };
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
      const authGeneration = uuidv7();
      const csrfToken = deriveSessionCsrf(sessionToken, authGeneration);
      const sessionId = uuidv7();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for guest

      // A guest is a distinct authenticated principal, NOT the employee who
      // issued the invitation. Keep created_by on the grant only as provenance.
      let principalUserId: string = grant.principal_user_id;
      if (!principalUserId) {
        principalUserId = uuidv7();
        await client.query(
          `INSERT INTO users (id, name, status)
           VALUES ($1, 'Verified external guest contact', 'ACTIVE')`,
          [principalUserId],
        );
        await client.query(
          `UPDATE guest_grants SET principal_user_id = $2
            WHERE id = $1 AND principal_user_id IS NULL`,
          [grant.id, principalUserId],
        );
      }

      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, active_org_id, guest_grant_id, expires_at, auth_generation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, principalUserId, this.hashSecret(sessionToken), this.hashSecret(csrfToken), grant.org_id, grant.id, expiresAt, authGeneration],
      );

      await client.query(
        `INSERT INTO auth_security_events
           (id,actor_user_id,org_id,session_id,event_type,outcome)
         VALUES(gen_random_uuid(),$1,$2,$3,'GUEST_OTP_LOGIN','SUCCESS')`,
        [principalUserId,grant.org_id,sessionId],
      );
      return { sessionToken, activeOrgId: grant.org_id, grantId: grant.id, csrfToken, authGeneration };
    });

    if ('failure' in result) {
      if (result.failure === 'TOO_MANY_FAILED_ATTEMPTS') {
        throw new ForbiddenException('TOO_MANY_FAILED_ATTEMPTS: 15-minute cooldown activated');
      }
      throw new UnauthorizedException('INVALID_OTP_CODE');
    }
    return result;
  }

  /**
   * API-028C POST /guest/:token/session
   * Legacy bearer/PIN exchange is disabled; OTP verification creates the session.
   */
  async createGuestSession(
    _token: string,
    _pin?: string,
  ): Promise<{ sessionToken: string; activeOrgId: string; grantId: string; csrfToken: string }> {
    throw new UnauthorizedException({
      code: 'OTP_REQUIRED',
      detail: 'Verify a single-use OTP challenge before creating a guest session.',
    });
  }

  /**
   * API-029A: POST /api/v1/projects/:projectId/procurement-orders
   * Creates a purchase order with lines and vendor document obligation schedules (Top 25 Item 2).
   */
  async createProcurementOrder(
    ctx: ExecutionContext,
    projectId: string,
    input: {
      poNumber: string;
      supplierPartyId: string;
      orderedAt?: string;
      promisedDeliveryAt?: string;
      totalAmountPaise?: number;
      notes?: string;
      lines: Array<{
        lineNo: number;
        assetCategoryKey: string;
        description: string;
        quantity?: number;
        assetId?: string;
        make?: string;
        model?: string;
        obligations?: Array<{
          docTypeKey: string;
          stageKey: string;
          title: string;
          dueDate?: string;
        }>;
      }>;
    },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const poId = uuidv7();
      await client.query(
        `INSERT INTO procurement_orders (
          id, org_id, project_id, po_number, supplier_party_id, status,
          ordered_at, promised_delivery_at, total_amount_paise, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'ISSUED', COALESCE($6, CURRENT_DATE), $7, $8, $9, $10)`,
        [
          poId,
          ctx.orgId,
          projectId,
          input.poNumber.trim(),
          input.supplierPartyId,
          input.orderedAt || null,
          input.promisedDeliveryAt || null,
          input.totalAmountPaise || null,
          input.notes || null,
          ctx.userId,
        ],
      );

      let totalObligations = 0;
      for (const line of input.lines || []) {
        const lineId = uuidv7();
        await client.query(
          `INSERT INTO procurement_order_lines (
            id, org_id, project_id, po_id, line_no, asset_category_key,
            description, quantity, asset_id, make, model
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            lineId,
            ctx.orgId,
            projectId,
            poId,
            line.lineNo,
            line.assetCategoryKey,
            line.description.trim(),
            line.quantity ?? 1,
            line.assetId || null,
            line.make || null,
            line.model || null,
          ],
        );

        for (const obl of line.obligations || []) {
          const oblId = uuidv7();
          await client.query(
            `INSERT INTO supplier_document_obligations (
              id, org_id, project_id, po_line_id, doc_type_key, stage_key,
              title, due_date, supplier_party_id, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')`,
            [
              oblId,
              ctx.orgId,
              projectId,
              lineId,
              obl.docTypeKey,
              obl.stageKey || 'FAT',
              obl.title,
              obl.dueDate || null,
              input.supplierPartyId,
            ],
          );
          totalObligations++;
        }
      }

      return {
        poId,
        poNumber: input.poNumber,
        linesCount: input.lines?.length ?? 0,
        obligationsCount: totalObligations,
        status: 'ISSUED',
      };
    });
  }

  /**
   * API-029B: GET /api/v1/projects/:projectId/procurement-orders
   */
  async listProcurementOrders(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT po.*, p.name AS supplier_name,
                (SELECT count(*) FROM procurement_order_lines pol WHERE pol.po_id = po.id)::int AS line_count,
                (SELECT count(*) FROM supplier_document_obligations sdo
                  JOIN procurement_order_lines pol ON pol.id = sdo.po_line_id
                  WHERE pol.po_id = po.id)::int AS obligation_count,
                (SELECT count(*) FROM supplier_document_obligations sdo
                  JOIN procurement_order_lines pol ON pol.id = sdo.po_line_id
                  WHERE pol.po_id = po.id AND sdo.status = 'PENDING')::int AS pending_obligation_count
         FROM procurement_orders po
         JOIN parties p ON p.id = po.supplier_party_id
         WHERE po.org_id = $1 AND po.project_id = $2
         ORDER BY po.ordered_at DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async intakeSupplierObligation(
    ctx: ExecutionContext,
    projectId: string,
    obligationId: string,
    dto: { decision?: 'ACCEPT' | 'REJECT'; notes?: string; documentVersionId?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT * FROM supplier_document_obligations
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, obligationId],
      );
      if (!rows.length) {
        throw new NotFoundException({
          code: 'OBLIGATION_NOT_FOUND',
          detail: `Supplier document obligation ${obligationId} not found in project ${projectId}.`,
        });
      }
      const existing = rows[0];
      const decision = dto.decision ?? 'ACCEPT';
      const newStatus = decision === 'REJECT' ? 'PENDING' : 'ACCEPTED';

      await client.query(
        `UPDATE supplier_document_obligations
            SET status = $4,
                document_version_id = COALESCE($5, document_version_id)
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, obligationId, newStatus, dto.documentVersionId ?? null],
      );

      return {
        id: obligationId,
        projectId,
        status: newStatus,
        decision,
        documentVersionId: dto.documentVersionId ?? existing.document_version_id,
        notes: dto.notes ?? null,
      };
    });
  }
}
