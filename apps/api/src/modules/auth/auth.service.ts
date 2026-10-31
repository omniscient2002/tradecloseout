// apps/api/src/modules/auth/auth.service.ts
// Auth & Session Management (API-001..009B, RT-002)

import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { TenantDbService } from '../../database/tenant-db.service';

export interface OtpRequestDto {
  channel: 'SMS' | 'EMAIL';
  identifier: string;
  purpose: 'LOGIN' | 'GUEST_ACCESS' | 'ORG_DELETE';
}

export interface OtpVerifyDto {
  identifier: string;
  code: string;
  purpose: 'LOGIN' | 'GUEST_ACCESS' | 'ORG_DELETE';
}

@Injectable()
export class AuthService {
  constructor(private readonly db: TenantDbService) {}

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * API-001 POST /auth/otp/request
   */
  async requestOtp(dto: OtpRequestDto): Promise<{ challengeId: string; expiresAt: Date; fallbackChannel?: string }> {
    const rawCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = this.hashSecret(rawCode);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const challengeId = uuidv7();

    await this.db.queryGlobal(
      `INSERT INTO otp_challenges (id, channel, identifier, purpose, code_hash, attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6)`,
      [challengeId, dto.channel, dto.identifier, dto.purpose, codeHash, expiresAt],
    );

    return { challengeId, expiresAt };
  }

  /**
   * API-002 POST /auth/otp/verify
   */
  async verifyOtp(dto: OtpVerifyDto): Promise<{
    sessionToken: string;
    csrfToken: string;
    user: any;
    activeOrgId: string | null;
  }> {
    const challenges = await this.db.queryGlobal<any>(
      `SELECT * FROM otp_challenges
       WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [dto.identifier, dto.purpose],
    );

    if (!challenges.length) {
      throw new UnauthorizedException('INVALID_OR_EXPIRED_CHALLENGE');
    }

    const challenge = challenges[0];
    const incomingHash = this.hashSecret(dto.code);

    if (challenge.code_hash !== incomingHash) {
      await this.db.queryGlobal(
        `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
        [challenge.id],
      );
      throw new UnauthorizedException('INVALID_OTP_CODE');
    }

    // Mark challenge consumed
    await this.db.queryGlobal(
      `UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`,
      [challenge.id],
    );

    // Upsert User
    const channelType = dto.identifier.includes('@') ? 'EMAIL' : 'PHONE';
    let users = await this.db.queryGlobal<any>(
      `SELECT u.* FROM users u
       JOIN user_identities ui ON ui.user_id = u.id
       WHERE ui.type = $1 AND ui.value = $2 LIMIT 1`,
      [channelType, dto.identifier],
    );

    let userId: string;
    let userRecord: any;

    if (!users.length) {
      userId = uuidv7();
      const defaultName = dto.identifier.split('@')[0];
      await this.db.queryGlobal(
        `INSERT INTO users (id, name, email_display, phone_display, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [userId, defaultName, channelType === 'EMAIL' ? dto.identifier : null, channelType === 'PHONE' ? dto.identifier : null],
      );

      await this.db.queryGlobal(
        `INSERT INTO user_identities (id, user_id, type, value, verified_at)
         VALUES ($1, $2, $3, $4, now())`,
        [uuidv7(), userId, channelType, dto.identifier],
      );

      userRecord = { id: userId, name: defaultName, status: 'ACTIVE' };
    } else {
      userId = users[0].id;
      userRecord = users[0];
    }

    // Resolve Active Org (RT-002: nullable for pre-onboarding)
    const memberships = await this.db.queryGlobal<any>(
      `SELECT org_id FROM memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY joined_at DESC LIMIT 1`,
      [userId],
    );

    const activeOrgId = memberships.length > 0 ? memberships[0].org_id : null;

    // Create Session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashSecret(sessionToken);
    const csrfHash = this.hashSecret(csrfToken);
    const sessionId = uuidv7();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.db.queryGlobal(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, active_org_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, userId, tokenHash, csrfHash, activeOrgId, expiresAt],
    );

    return {
      sessionToken,
      csrfToken,
      user: userRecord,
      activeOrgId,
    };
  }

  /**
   * API-009A GET /auth/orgs
   */
  async getUserOrgs(userId: string): Promise<any[]> {
    return this.db.queryGlobal<any>(
      `SELECT o.id as "orgId", o.display_name as "displayName", o.legal_name as "legalName", m.role
       FROM memberships m
       JOIN organisations o ON o.id = m.org_id
       WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'`,
      [userId],
    );
  }

  /**
   * API-009B POST /auth/switch-org
   */
  async switchOrg(userId: string, sessionId: string, targetOrgId: string): Promise<{ activeOrgId: string; csrfToken: string }> {
    const membership = await this.db.queryGlobal<any>(
      `SELECT * FROM memberships WHERE user_id = $1 AND org_id = $2 AND status = 'ACTIVE'`,
      [userId, targetOrgId],
    );

    if (!membership.length) {
      throw new ForbiddenException('NOT_A_MEMBER_OF_ORGANISATION');
    }

    const newCsrf = crypto.randomBytes(32).toString('hex');
    const newCsrfHash = this.hashSecret(newCsrf);

    await this.db.queryGlobal(
      `UPDATE sessions SET active_org_id = $1, csrf_token_hash = $2 WHERE id = $3`,
      [targetOrgId, newCsrfHash, sessionId],
    );

    return { activeOrgId: targetOrgId, csrfToken: newCsrf };
  }

  /**
   * Session verification by token
   */
  async getSessionByToken(token: string): Promise<any | null> {
    const tokenHash = this.hashSecret(token);
    const sessions = await this.db.queryGlobal<any>(
      `SELECT s.*, u.name as user_name, u.email_display, u.phone_display,
              m.role as org_role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.org_id = s.active_org_id AND m.user_id = s.user_id AND m.status = 'ACTIVE'
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1`,
      [tokenHash],
    );

    return sessions.length ? sessions[0] : null;
  }
}
