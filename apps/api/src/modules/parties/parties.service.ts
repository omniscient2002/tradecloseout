// apps/api/src/modules/parties/parties.service.ts
// Guest grant OTP, SMS pumping protection & rate limits (API-028A/B, RT-014, CB-007, CB-011)

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { TenantDbService } from '../../database/tenant-db.service';

@Injectable()
export class PartiesService {
  constructor(private readonly db: TenantDbService) {}

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
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
      return grant;
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
