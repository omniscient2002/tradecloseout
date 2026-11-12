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
import { IndianGstinSchema, isImmutableObjectVersionId } from '@tradecloseout/shared';

export interface CreatePartyDto {
  name: string;
  types: string[];
  gstin?: string;
  email?: string;
  phone?: string;
}

/**
 * PH3-G04-001: validate party registry data before starting a transaction.
 * Party types are descriptors, NOT independent proof of counterparty authority.
 * Preserve explicit legacy aliases until the tenant catalogue is migrated.
 */
const PARTY_TYPES = new Set([
  'CLIENT', 'MAIN_CONTRACTOR', 'MC', 'CONSULTANT',
  'SUPPLIER', 'SUPPLIER_OEM', 'MANUFACTURER',
  'SUBCONTRACTOR', 'SUB_SUBCONTRACTOR', 'LAB', 'OTHER',
]);
export function normalizeCreateParty(input: unknown): CreatePartyDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('INVALID_PARTY_PAYLOAD');
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['name', 'types', 'gstin', 'email', 'phone'].includes(key))) {
    throw new BadRequestException('UNSUPPORTED_PARTY_FIELDS');
  }
  if (typeof value.name !== 'string' || value.name.trim().length < 2 || value.name.trim().length > 200) {
    throw new BadRequestException('INVALID_PARTY_NAME');
  }
  const types = value.types === undefined ? ['SUPPLIER_OEM'] : value.types;
  if (!Array.isArray(types) || types.length < 1 || types.length > 8 ||
      types.some((type) => typeof type !== 'string' || !PARTY_TYPES.has(type)) ||
      new Set(types).size !== types.length) {
    throw new BadRequestException('INVALID_PARTY_TYPES');
  }
  let gstin: string | undefined;
  if (value.gstin !== undefined && value.gstin !== null && value.gstin !== '') {
    const result = IndianGstinSchema.safeParse(value.gstin);
    if (!result.success) throw new BadRequestException('INVALID_PARTY_GSTIN');
    gstin = result.data;
  }
  let email: string | undefined;
  if (value.email !== undefined && value.email !== null && value.email !== '') {
    if (typeof value.email !== 'string') throw new BadRequestException('INVALID_PARTY_EMAIL');
    email = value.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('INVALID_PARTY_EMAIL');
    }
  }
  let phone: string | undefined;
  if (value.phone !== undefined && value.phone !== null && value.phone !== '') {
    if (typeof value.phone !== 'string') throw new BadRequestException('INVALID_PARTY_PHONE');
    phone = value.phone.trim();
    const digits = phone.replace(/\D/g, '');
    if (phone.length > 32 || digits.length < 7 || digits.length > 15 ||
        !/^\+?[0-9 ()-]+$/.test(phone)) {
      throw new BadRequestException('INVALID_PARTY_PHONE');
    }
  }
  return { name: value.name.trim(), types: types as string[], gstin, email, phone };
}

/** PH3-G04-003: validate issued procurement facts before any DB mutation. */
export function assertValidProcurementOrderInput(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('PROCUREMENT_ORDER_INVALID');
  }
  const value = input as Record<string, unknown>;
  if (typeof value.poNumber !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,79}$/.test(value.poNumber.trim()) ||
      typeof value.supplierPartyId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.supplierPartyId)) {
    throw new BadRequestException('PROCUREMENT_ORDER_IDENTITY_INVALID');
  }
  const validDate = (date: unknown): boolean => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(date);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  };
  if ((value.orderedAt !== undefined && !validDate(value.orderedAt)) ||
      (value.promisedDeliveryAt !== undefined && !validDate(value.promisedDeliveryAt)) ||
      (value.totalAmountPaise !== undefined &&
        (!Number.isSafeInteger(value.totalAmountPaise) || (value.totalAmountPaise as number) < 0)) ||
      (value.notes !== undefined &&
        (typeof value.notes !== 'string' || value.notes.length > 2000))) {
    throw new BadRequestException('PROCUREMENT_ORDER_FIELDS_INVALID');
  }
  const lines = value.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200) {
    throw new BadRequestException('PROCUREMENT_LINES_REQUIRED');
  }
  const lineNos = new Set<number>();
  for (const item of lines) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException('PROCUREMENT_LINE_INVALID');
    }
    const line = item as Record<string, unknown>;
    if (!Number.isSafeInteger(line.lineNo) ||
        (line.lineNo as number) < 1 || (line.lineNo as number) > 100000 ||
        lineNos.has(line.lineNo as number) ||
        typeof line.assetCategoryKey !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,80}$/.test(line.assetCategoryKey) ||
        typeof line.description !== 'string' ||
        line.description.trim().length < 2 || line.description.trim().length > 500 ||
        (line.quantity !== undefined &&
          (!Number.isSafeInteger(line.quantity) || (line.quantity as number) < 1 ||
           (line.quantity as number) > 1_000_000))) {
      throw new BadRequestException('PROCUREMENT_LINE_INVALID');
    }
    lineNos.add(line.lineNo as number);
    if ((line.make !== undefined && (typeof line.make !== 'string' || line.make.length > 200)) ||
        (line.model !== undefined && (typeof line.model !== 'string' || line.model.length > 200))) {
      throw new BadRequestException('PROCUREMENT_LINE_METADATA_INVALID');
    }
    const obligations = line.obligations ?? [];
    if (!Array.isArray(obligations) || obligations.length > 20) {
      throw new BadRequestException('PROCUREMENT_OBLIGATIONS_INVALID');
    }
    for (const ob of obligations) {
      if (!ob || typeof ob !== 'object' || Array.isArray(ob)) {
        throw new BadRequestException('PROCUREMENT_OBLIGATION_INVALID');
      }
      const item = ob as Record<string, unknown>;
      if (typeof item.docTypeKey !== 'string' ||
          !/^[A-Za-z0-9_.:-]{1,80}$/.test(item.docTypeKey) ||
          (item.stageKey !== undefined &&
           !['MANUFACTURING', 'FAT', 'DISPATCH', 'DELIVERY', 'INSTALLATION', 'HANDOVER', 'WARRANTY'].includes(String(item.stageKey))) ||
          typeof item.title !== 'string' || item.title.trim().length < 2 ||
          item.title.trim().length > 200 ||
          (item.dueDate !== undefined && !validDate(item.dueDate))) {
        throw new BadRequestException('PROCUREMENT_OBLIGATION_INVALID');
      }
    }
  }
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
    capabilities: ['project.read', 'asset.read', 'document.read', 'document.download', 'review.read', 'review.decide', 'package.download'],
  },
  CLIENT_VIEW: {
    grantType: 'CLIENT_VIEW',
    role: 'R-CLIENT',
    capabilities: ['project.read', 'document.read', 'document.download', 'package.download', 'package.accept'],
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
    const validated = normalizeCreateParty(dto);
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
          validated.name,
          validated.types,
          validated.gstin ?? null,
          validated.email ?? null,
          validated.phone ?? null,
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
    if (!dto.partyId) {
      throw new BadRequestException('PARTY_REQUIRED: partyId is required to create a guest grant');
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
  async requestGuestOtp(token: string): Promise<{ success: boolean; challengeId: string; maskedTarget: string; channel: string; debugOtp?: string }> {
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
      const codeHash = this.hashSecret(rawCode);
      const challengeId = uuidv7();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const targetIdentifier = grant.target_phone_e164 || grant.target_email;
      if (!targetIdentifier) throw new UnprocessableEntityException('GUEST_CONTACT_REQUIRED');
      const channel = grant.target_phone_e164 ? 'SMS' : 'EMAIL';

      await client.query(
        `INSERT INTO otp_challenges (id, channel, identifier, purpose, guest_grant_id, code_hash, expires_at)
         VALUES ($1, $2, $3, 'GUEST_ACCESS', $4, $5, $6)`,
        [challengeId, channel, targetIdentifier, grant.id, codeHash, expiresAt],
      );

      const isProductionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
      const isExplicitDebug = process.env.ENABLE_DEBUG_OTP === 'true' && !isProductionLike;
      if (!isExplicitDebug) {
        if (channel === 'SMS') {
          if (!this.smsGateway) throw new ServiceUnavailableException('SMS_GATEWAY_UNAVAILABLE');
          const sent = await this.smsGateway.sendOtpSms(
            targetIdentifier,
            rawCode,
            process.env.DLT_GUEST_OTP_TEMPLATE_ID || process.env.DLT_OTP_TEMPLATE_ID || '',
          );
          if (!sent.delivered) throw new Error('GUEST_OTP_DELIVERY_FAILED');
        } else {
          if (!this.mailGateway) throw new ServiceUnavailableException('MAIL_GATEWAY_UNAVAILABLE');
          await this.mailGateway.sendOtpEmail(targetIdentifier, rawCode, 'GUEST_ACCESS');
        }
      }

      const maskedTarget = channel === 'EMAIL'
        ? `${targetIdentifier.slice(0, 1)}***@${targetIdentifier.split('@')[1] || 'hidden'}`
        : targetIdentifier.replace(/^(\+?\d{2,4})\d+(\d{4})$/, '$1******$2');
      return { success: true, challengeId, maskedTarget, channel: isExplicitDebug ? 'DEBUG' : channel, debugOtp: isExplicitDebug ? rawCode : undefined };
    });
  }

  /**
   * API-028B POST /guest/:token/otp/verify (RT-014, CB-007, CB-011)
   */
  async verifyGuestOtp(
    token: string,
    code: string,
    challengeId: string,
  ): Promise<{ sessionToken: string; activeOrgId: string; grantId: string; csrfToken: string }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
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
           WHERE guest_grant_id = $1 AND id = $2 AND purpose = 'GUEST_ACCESS' AND consumed_at IS NULL AND expires_at > now()
           LIMIT 1 FOR UPDATE`,
          [grant.id, challengeId],
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
          return { failure: 'TOO_MANY_FAILED_ATTEMPTS' as const };
        } else {
          await client.query(
            `UPDATE guest_grants SET failed_otp_count = $1 WHERE id = $2`,
            [newAttempts, grant.id],
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
    assertValidProcurementOrderInput(input);
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const project = await client.query(
        `SELECT status FROM projects WHERE org_id = $1 AND id = $2
          AND purged_at IS NULL FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!project.rows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      if (project.rows[0].status !== 'ACTIVE') {
        throw new BadRequestException('PROCUREMENT_PROJECT_NOT_ACTIVE');
      }
      const supplier = await client.query(
        `SELECT id FROM parties WHERE org_id = $1 AND id = $2
          AND status = 'ACTIVE' AND deleted_at IS NULL FOR SHARE`,
        [ctx.orgId, input.supplierPartyId],
      );
      if (!supplier.rows.length) throw new NotFoundException('SUPPLIER_PARTY_NOT_FOUND');
      for (const line of input.lines) {
        if (!line.assetId) continue;
        const asset = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2
            AND id = $3 AND deleted_at IS NULL FOR SHARE`,
          [ctx.orgId, projectId, line.assetId],
        );
        if (!asset.rows.length) throw new NotFoundException('PROCUREMENT_ASSET_NOT_FOUND');
      }

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

  /**
   * Supplier evidence intake is a contractor responsibility, never a guest
   * upload permission. Resolve current authority from the DB rather than
   * the mutable role included in the HTTP context.
   */
  private async assertIntakeDecisionAuthority(
    client: PoolClient, ctx: ExecutionContext, projectId: string, write: boolean,
  ): Promise<void> {
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new ForbiddenException('CONTRACTOR_INTAKE_AUTHORITY_REQUIRED');
    }
    const { rows: orgMembers } = await client.query(
      `SELECT role FROM memberships
        WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE' FOR SHARE`,
      [ctx.orgId, ctx.userId],
    );
    if (!orgMembers.length) throw new ForbiddenException('ACTIVE_ORG_MEMBERSHIP_REQUIRED');
    const { rows: projects } = await client.query(
      `SELECT status FROM projects WHERE org_id = $1 AND id = $2
        AND purged_at IS NULL ${write ? 'FOR UPDATE' : 'FOR SHARE'}`,
      [ctx.orgId, projectId],
    );
    if (!projects.length) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (write && projects[0].status !== 'ACTIVE') {
      throw new BadRequestException('SUPPLIER_INTAKE_PROJECT_NOT_ACTIVE');
    }
    if (['R-OWNER', 'R-ADMIN'].includes(orgMembers[0].role)) return;
    if (!['R-PM', 'R-PROC', 'R-DOC'].includes(orgMembers[0].role)) {
      throw new ForbiddenException('CONTRACTOR_INTAKE_AUTHORITY_REQUIRED');
    }
    const { rows: projectMembers } = await client.query(
      `SELECT role FROM project_members
        WHERE org_id = $1 AND project_id = $2 AND user_id = $3
          AND status = 'ACTIVE' FOR SHARE`,
      [ctx.orgId, projectId, ctx.userId],
    );
    if (!projectMembers.length || !['R-PM', 'R-PROC', 'R-DOC'].includes(projectMembers[0].role)) {
      throw new ForbiddenException('PROJECT_INTAKE_AUTHORITY_REQUIRED');
    }
  }

  private normalizeIntakeCommand(dto: {
    decision?: 'ACCEPT' | 'REJECT';
    notes?: string;
    documentVersionId?: string;
    expectedRowVersion?: number;
    commandId?: string;
  }) {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('INVALID_INTAKE_COMMAND');
    }
    const decision = dto.decision ?? 'ACCEPT';
    if (decision !== 'ACCEPT' && decision !== 'REJECT') {
      throw new BadRequestException('INVALID_INTAKE_DECISION');
    }
    const notes = dto.notes === undefined ? null : dto.notes;
    if (notes !== null && (typeof notes !== 'string' || notes.trim().length > 2000)) {
      throw new BadRequestException('INVALID_INTAKE_NOTES');
    }
    const reason = typeof notes === 'string' ? notes.trim() : null;
    if (decision === 'REJECT' && (!reason || reason.length < 5)) {
      throw new BadRequestException('INTAKE_REJECTION_REASON_REQUIRED');
    }
    const isUuid = (value: unknown) => typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (dto.documentVersionId !== undefined && !isUuid(dto.documentVersionId)) {
      throw new BadRequestException('INVALID_INTAKE_VERSION_ID');
    }
    if (dto.commandId !== undefined && !isUuid(dto.commandId)) {
      throw new BadRequestException('INVALID_INTAKE_COMMAND_ID');
    }
    if (dto.expectedRowVersion !== undefined &&
        (!Number.isSafeInteger(dto.expectedRowVersion) || dto.expectedRowVersion < 1)) {
      throw new BadRequestException('INVALID_INTAKE_ROW_VERSION');
    }
    return { decision, reason, commandId: dto.commandId ?? uuidv7() };
  }

  async intakeSupplierObligation(
    ctx: ExecutionContext,
    projectId: string,
    obligationId: string,
    dto: {
      decision?: 'ACCEPT' | 'REJECT';
      notes?: string;
      documentVersionId?: string;
      expectedRowVersion?: number;
      commandId?: string;
    },
  ) {
    const command = this.normalizeIntakeCommand(dto);
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // Project lock precedes the obligation lock for close/decision serialization.
      await this.assertIntakeDecisionAuthority(client, ctx, projectId, true);
      const { rows } = await client.query(
        `SELECT * FROM supplier_document_obligations
          WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
        [ctx.orgId, projectId, obligationId],
      );
      if (!rows.length) throw new NotFoundException('OBLIGATION_NOT_FOUND');
      const existing = rows[0];
      const versionId = dto.documentVersionId ?? existing.document_version_id;
      if (!versionId) throw new BadRequestException('INTAKE_DOCUMENT_VERSION_REQUIRED');

      const { rows: replay } = await client.query(
        `SELECT decision, document_version_id, reason, resulting_status, resulting_row_version
           FROM supplier_intake_decisions
          WHERE org_id = $1 AND project_id = $2 AND obligation_id = $3 AND command_id = $4`,
        [ctx.orgId, projectId, obligationId, command.commandId],
      );
      if (replay.length) {
        if (replay[0].decision !== command.decision ||
            replay[0].document_version_id !== versionId ||
            (replay[0].reason ?? null) !== command.reason) {
          throw new BadRequestException('INTAKE_COMMAND_REPLAY_MISMATCH');
        }
        return {
          id: obligationId, projectId, decision: replay[0].decision,
          status: replay[0].resulting_status,
          documentVersionId: replay[0].document_version_id,
          notes: replay[0].reason, rowVersion: replay[0].resulting_row_version,
          idempotentReplay: true,
        };
      }

      if (existing.status === 'ACCEPTED') {
        if (command.decision === 'ACCEPT' && existing.document_version_id === versionId) {
          return {
            id: obligationId, projectId, decision: command.decision, status: 'ACCEPTED',
            documentVersionId: versionId, notes: null,
            rowVersion: existing.row_version, idempotentReplay: true,
          };
        }
        throw new BadRequestException('INTAKE_ALREADY_ACCEPTED');
      }
      if (!['PENDING', 'UPLOADED', 'OVERDUE'].includes(existing.status)) {
        throw new BadRequestException('INTAKE_INVALID_STATUS');
      }
      if (dto.expectedRowVersion !== undefined &&
          dto.expectedRowVersion !== existing.row_version) {
        throw new BadRequestException('INTAKE_ROW_VERSION_CONFLICT');
      }

      const { rows: evidence } = await client.query(
        `SELECT dv.id, dv.file_status, dv.review_status,
                so.status AS storage_status, so.sha256, so.provider_version_id,
                so.size_bytes, so.observed_size_bytes
           FROM document_versions dv
           JOIN documents d
             ON d.org_id = dv.org_id AND d.project_id = dv.project_id
            AND d.id = dv.document_id AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
           JOIN storage_objects so
             ON so.org_id = dv.org_id AND so.id = dv.object_id
           JOIN guest_grants g
             ON g.org_id = dv.org_id AND g.project_id = dv.project_id
            AND g.id = dv.uploaded_by_grant_id
          WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.id = $3
            AND d.doc_type_key = $4 AND g.party_id = $5
            AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
            AND dv.review_status NOT IN ('WITHDRAWN', 'REJECTED', 'SUPERSEDED')`,
        [ctx.orgId, projectId, versionId, existing.doc_type_key, existing.supplier_party_id],
      );
      if (!evidence.length) throw new BadRequestException('SUPPLIER_INTAKE_EVIDENCE_MISMATCH');
      const version = evidence[0];
      if (command.decision === 'ACCEPT' &&
          (version.file_status !== 'READY' || version.storage_status !== 'READY' ||
           typeof version.sha256 !== 'string' ||
           !/^[0-9a-f]{64}$/i.test(version.sha256) ||
           !isImmutableObjectVersionId(version.provider_version_id) ||
           version.observed_size_bytes == null ||
           String(version.observed_size_bytes) !== String(version.size_bytes))) {
        throw new BadRequestException('SUPPLIER_INTAKE_EVIDENCE_NOT_VERIFIED');
      }

      const { rows: lastDecisions } = await client.query(
        `SELECT decision, document_version_id, reason, resulting_row_version
           FROM supplier_intake_decisions
          WHERE org_id = $1 AND project_id = $2 AND obligation_id = $3
          ORDER BY resulting_row_version DESC LIMIT 1`,
        [ctx.orgId, projectId, obligationId],
      );
      if (existing.status === 'PENDING' && lastDecisions[0]?.decision === 'REJECT' &&
          lastDecisions[0].document_version_id === versionId) {
        if (command.decision === 'REJECT' && (lastDecisions[0].reason ?? null) === command.reason) {
          return {
            id: obligationId, projectId, decision: 'REJECT', status: 'PENDING',
            documentVersionId: versionId, notes: command.reason,
            rowVersion: existing.row_version, idempotentReplay: true,
          };
        }
        throw new BadRequestException('REJECTED_VERSION_REUPLOAD_REQUIRED');
      }

      const status = command.decision === 'REJECT' ? 'PENDING' : 'ACCEPTED';
      const { rows: changed } = await client.query(
        `UPDATE supplier_document_obligations
            SET status = $4, document_version_id = $5, row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $6
          RETURNING row_version`,
        [ctx.orgId, projectId, obligationId, status, versionId, existing.row_version],
      );
      if (changed.length !== 1) throw new BadRequestException('INTAKE_ROW_VERSION_CONFLICT');
      const rowVersion = changed[0].row_version;
      await client.query(
        `INSERT INTO supplier_intake_decisions
          (id, org_id, project_id, obligation_id, command_id, decision,
           document_version_id, reason, previous_status, resulting_status,
           resulting_row_version, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          uuidv7(), ctx.orgId, projectId, obligationId, command.commandId,
          command.decision, versionId, command.reason, existing.status, status,
          rowVersion, ctx.userId,
        ],
      );

      const eventType = command.decision === 'REJECT'
        ? 'SUPPLIER_INTAKE_REJECTED' : 'SUPPLIER_INTAKE_ACCEPTED';
      const payload = {
        orgId: ctx.orgId, projectId, obligationId, documentVersionId: versionId,
        decision: command.decision, rowVersion, actorUserId: ctx.userId,
        commandId: command.commandId, requestId: ctx.requestId,
      };
      await client.query(
        `INSERT INTO outbox_events
          (id, org_id, project_id, event_type, payload_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [uuidv7(), ctx.orgId, projectId, eventType, JSON.stringify(payload)],
      );
      await client.query(
        `INSERT INTO audit_events
          (id, org_id, project_id, actor_type, actor_user_id, action,
           entity_type, entity_id, before_json, after_json, ip, user_agent, request_id)
         VALUES ($1, $2, $3, 'USER', $4, $5, 'SUPPLIER_OBLIGATION', $6,
           $7::jsonb, $8::jsonb, $9, $10, $11)`,
        [
          uuidv7(), ctx.orgId, projectId, ctx.userId, eventType, obligationId,
          JSON.stringify({ status: existing.status, rowVersion: existing.row_version }),
          JSON.stringify({ status, documentVersionId: versionId, rowVersion }),
          (ctx as any).ip ?? null, (ctx as any).userAgent ?? null, ctx.requestId,
        ],
      );

      return {
        id: obligationId, projectId, decision: command.decision, status,
        documentVersionId: versionId, notes: command.reason, rowVersion,
        idempotentReplay: false,
      };
    });
  }

  /** Contractor-only, persisted reason/status projection for work-item recovery. */
  async getSupplierIntakeHistory(
    ctx: ExecutionContext, projectId: string, obligationId: string,
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      await this.assertIntakeDecisionAuthority(client, ctx, projectId, false);
      const { rows: obligations } = await client.query(
        `SELECT id, status, document_version_id, row_version
           FROM supplier_document_obligations
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, obligationId],
      );
      if (!obligations.length) throw new NotFoundException('OBLIGATION_NOT_FOUND');
      const { rows: decisions } = await client.query(
        `SELECT id, decision, document_version_id, reason, previous_status,
                resulting_status, resulting_row_version, decided_by, created_at
           FROM supplier_intake_decisions
          WHERE org_id = $1 AND project_id = $2 AND obligation_id = $3
          ORDER BY resulting_row_version DESC LIMIT 100`,
        [ctx.orgId, projectId, obligationId],
      );
      return {
        obligationId, projectId,
        status: obligations[0].status,
        documentVersionId: obligations[0].document_version_id,
        rowVersion: obligations[0].row_version,
        decisions: decisions.map((item: any) => ({
          id: item.id, decision: item.decision,
          documentVersionId: item.document_version_id, reason: item.reason,
          previousStatus: item.previous_status, resultingStatus: item.resulting_status,
          rowVersion: item.resulting_row_version,
          decidedBy: item.decided_by, decidedAt: item.created_at,
        })),
      };
    });
  }

}
