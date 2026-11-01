import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AuthenticatedRequest, SessionCsrfGuard } from '../../common/guards/session-csrf.guard';

export abstract class DltSmsGateway {
  abstract sendOtpSms(phoneE164: string, otp: string, templateId: string): Promise<{ delivered: boolean }>;
}

export abstract class TransactionalMailGateway {
  abstract sendMagicLinkEmail(email: string, magicUrl: string): Promise<void>;
}

@Controller('api/v1/auth')
export class IdentityController {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly smsGateway: DltSmsGateway,
    private readonly mailGateway: TransactionalMailGateway,
  ) {}

  /**
   * API-001: POST /api/v1/auth/otp/request
   * Sends a 6-digit OTP via DLT SMS or Email, falling back automatically to Email Magic Link
   * after 2 SMS failures (FR-IAM-002 / FR-INT-012 / RB-11).
   */
  @Post('otp/request')
  @HttpCode(HttpStatus.CREATED)
  async requestOtp(
    @Body() body: { identifier?: string; phoneOrEmail?: string; fallbackEmail?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const rawId = (body.identifier || body.phoneOrEmail || '').trim().toLowerCase();
    const isPhone = /^\+91[6-9][0-9]{9}$/.test(rawId);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawId);

    if (!isPhone && !isEmail) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        title: 'Invalid email or Indian mobile number',
        detail: 'Provide a valid business email or +91 10-digit mobile number.',
      });
    }

    // Rate limit: max 5 OTP requests / hour / identifier (10 §10)
    const rateKey = `rl:otp:req:${rawId}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 3600);
    if (count > 5) {
      throw new HttpExceptionWithRetry(429, 'RATE_LIMITED', 'Too many OTP requests. Try again later.', 300);
    }

    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(`${rawId}:${otp}`).digest('hex');

    await this.redis.set(
      `otp:challenge:${rawId}`,
      JSON.stringify({ otpHash, attempts: 0 }),
      'EX',
      300, // 5-minute expiry (10 §2.1)
    );

    const isNonProd = process.env.NODE_ENV !== 'production';

    if (isPhone) {
      const smsFailKey = `sms:fail:${rawId}`;
      try {
        const res = await this.smsGateway.sendOtpSms(rawId, otp, process.env.DLT_OTP_TEMPLATE_ID || '');
        if (!res.delivered) throw new Error('DLT_DELIVERY_FAILED');
        await this.redis.del(smsFailKey);
        return {
          challengeId: rawId,
          channel: 'SMS',
          fallbackTriggered: false,
          expiresInSeconds: 300,
          debugOtp: isNonProd ? otp : undefined,
        };
      } catch {
        const fails = await this.redis.incr(smsFailKey);
        await this.redis.expire(smsFailKey, 900);

        // Automatic fallback to email magic link after 2 failed SMS attempts (FR-IAM-002)
        if (fails >= 2 && body.fallbackEmail) {
          const magicToken = randomBytes(32).toString('hex');
          const magicHash = createHash('sha256').update(magicToken).digest('hex');
          await this.redis.set(
            `magic:link:${magicHash}`,
            JSON.stringify({ identifier: body.fallbackEmail.trim().toLowerCase() }),
            'EX',
            900, // 15-minute expiry (10 §2.1)
          );
          await this.mailGateway.sendMagicLinkEmail(
            body.fallbackEmail,
            `${process.env.PUBLIC_APP_URL}/auth/magic-link?token=${magicToken}`,
          );
          return {
            challengeId: rawId,
            channel: 'EMAIL_MAGIC_LINK_FALLBACK',
            fallbackTriggered: true,
            expiresInSeconds: 900,
            debugOtp: isNonProd ? otp : undefined,
          };
        }
        throw new UnprocessableEntityException({
          code: 'SMS_DELIVERY_FAILED',
          title: 'SMS delivery failed',
          detail: 'Could not deliver SMS OTP. Provide your business email to use a login link.',
        });
      }
    }

    // Email OTP / Magic Link
    await this.mailGateway.sendMagicLinkEmail(rawId, `Your TradeCloseout verification code is ${otp}`);
    return {
      challengeId: rawId,
      channel: 'EMAIL',
      fallbackTriggered: false,
      expiresInSeconds: 300,
      debugOtp: isNonProd ? otp : undefined,
    };
  }

  /**
   * API-002: POST /api/v1/auth/otp/verify
   * Verifies the 6-digit OTP and creates an opaque server-side session bound to active_org_id.
   */
  @Post('otp/verify')
  @HttpCode(HttpStatus.CREATED)
  async verifyOtp(
    @Body()
    body: {
      identifier?: string;
      challengeId?: string;
      otp?: string;
      code?: string;
      signupProfile?: { fullName: string; orgName: string; state: string };
    },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawId = (body.identifier || body.challengeId || '').trim().toLowerCase();
    const candidateCode = (body.otp || body.code || '').trim();

    const rawChallenge = await this.redis.get(`otp:challenge:${rawId}`);
    if (!rawChallenge) {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        title: 'Verification code expired',
        detail: 'Request a new verification code.',
      });
    }

    const challenge = JSON.parse(rawChallenge) as { otpHash: string; attempts: number };
    if (challenge.attempts >= 5) {
      await this.redis.del(`otp:challenge:${rawId}`);
      throw new UnauthorizedException({
        code: 'OTP_MAX_ATTEMPTS',
        title: 'Too many failed attempts',
        detail: 'Maximum verification attempts exceeded. Request a new code.',
      });
    }

    const candidateHash = createHash('sha256').update(`${rawId}:${candidateCode}`).digest('hex');
    const expectedBuf = Buffer.from(challenge.otpHash, 'hex');
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    if (expectedBuf.length !== candidateBuf.length || !timingSafeEqual(expectedBuf, candidateBuf)) {
      challenge.attempts += 1;
      await this.redis.set(`otp:challenge:${rawId}`, JSON.stringify(challenge), 'KEEPTTL');
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        title: 'Invalid verification code',
        detail: 'The verification code entered is incorrect.',
      });
    }

    // Single-use token: delete immediately on match (NFR-SEC-004)
    await this.redis.del(`otp:challenge:${rawId}`);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const idType = rawId.startsWith('+91') ? 'PHONE' : 'EMAIL';
      const { rows: existingIdentities } = await client.query(
        `SELECT user_id FROM user_identities WHERE type = $1 AND value = $2 LIMIT 1`,
        [idType, rawId],
      );

      let userId: string;
      let activeOrgId: string;
      let fullName = body.signupProfile?.fullName?.trim() || 'Principal Contractor';

      if (existingIdentities.length > 0) {
        userId = existingIdentities[0].user_id;
        await client.query(
          `UPDATE user_identities SET verified_at = COALESCE(verified_at, now()) WHERE type = $1 AND value = $2`,
          [idType, rawId],
        );
        await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);

        const { rows: memberships } = await client.query(
          `SELECT org_id FROM memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`,
          [userId],
        );
        if (memberships.length === 0) {
          throw new UnauthorizedException({
            code: 'NO_ACTIVE_ORG',
            title: 'No active organisation membership',
            detail: 'Your account has no active organisation memberships.',
          });
        }
        activeOrgId = memberships[0].org_id;

        const { rows: userRows } = await client.query(`SELECT name FROM users WHERE id = $1`, [userId]);
        if (userRows.length > 0 && userRows[0].name) {
          fullName = userRows[0].name;
        }
      } else {
        // New Org + Owner Registration (WF-01 / FR-ORG-001)
        const orgName = body.signupProfile?.orgName?.trim() || 'Apex MEP Engineers';
        const state = body.signupProfile?.state?.trim() || 'MH';

        userId = uuidv7();
        activeOrgId = uuidv7();

        await client.query(`SELECT set_config('app.current_org', $1, true)`, [activeOrgId]);
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

        await client.query(
          `INSERT INTO users (id, name, status, last_login_at) VALUES ($1, $2, 'ACTIVE', now())`,
          [userId, fullName],
        );
        await client.query(
          `INSERT INTO user_identities (id, user_id, type, value, verified_at)
           VALUES ($1, $2, $3, $4, now())`,
          [uuidv7(), userId, idType, rawId],
        );
        await client.query(
          `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
           VALUES ($1, $2, $2, 'PRIVATE_LIMITED', 'ACTIVE', 'IN', $3)`,
          [activeOrgId, orgName, state],
        );
        await client.query(`INSERT INTO org_profiles (org_id) VALUES ($1)`, [activeOrgId]);
        await client.query(
          `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
           VALUES ($1, $2, $3, 'R-OWNER', 'ACTIVE', now())`,
          [uuidv7(), activeOrgId, userId],
        );
      }

      await client.query(`SELECT set_config('app.current_org', $1, true)`, [activeOrgId]);
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

      // Issue opaque session token + CSRF token (10 §1 & FR-IAM-003: 30-day idle timeout)
      const rawSessionToken = randomBytes(32).toString('hex');
      const rawCsrfToken = randomBytes(24).toString('hex');
      const sessionTokenHash = createHash('sha256').update(rawSessionToken).digest('hex');
      const csrfTokenHash = createHash('sha256').update(rawCsrfToken).digest('hex');
      const sessionId = uuidv7();

      await client.query(
        `INSERT INTO sessions
          (id, user_id, token_hash, csrf_token_hash, active_org_id, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', $6, $7)`,
        [
          sessionId,
          userId,
          sessionTokenHash,
          csrfTokenHash,
          activeOrgId,
          req.ip || '0.0.0.0',
          req.headers['user-agent'] || 'unknown',
        ],
      );

      await client.query(
        `INSERT INTO security_events (id, org_id, actor_user_id, event_type, ip, user_agent, request_id)
         VALUES ($1, $2, $3, 'USER_SESSION_CREATED', $4, $5, $6)`,
        [
          uuidv7(),
          activeOrgId,
          userId,
          req.ip || '0.0.0.0',
          req.headers['user-agent'] || 'unknown',
          (req.headers['x-request-id'] as string) || 'req_auth',
        ],
      );

      await client.query('COMMIT');

      const isProd = process.env.NODE_ENV === 'production';
      res.cookie('tc_session', rawSessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return {
        userId,
        activeOrgId,
        csrfToken: rawCsrfToken,
        sessionToken: rawSessionToken,
        user: {
          id: userId,
          email: idType === 'EMAIL' ? rawId : undefined,
          phone: idType === 'PHONE' ? rawId : undefined,
          full_name: fullName,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * API-003: GET /api/v1/auth/me
   * Returns current identity and active organisation only (10 §2.1 Step 4).
   */
  @Get('me')
  @UseGuards(SessionCsrfGuard)
  async getMe(@Req() req: AuthenticatedRequest) {
    const { rows } = await this.pool.query(
      `SELECT id, legal_name, display_name, status, state
         FROM organisations
        WHERE id = $1 LIMIT 1`,
      [req.auth.activeOrgId],
    );

    return {
      userId: req.auth.userId,
      user_id: req.auth.userId,
      name: req.auth.userName,
      user_name: req.auth.userName,
      user: {
        id: req.auth.userId,
        name: req.auth.userName,
      },
      activeOrgId: req.auth.activeOrgId,
      active_org_id: req.auth.activeOrgId,
      activeOrg: rows[0] ?? null,
      orgRole: req.auth.orgRole,
      org_role: req.auth.orgRole,
    };
  }

  /**
   * GET /api/v1/auth/orgs
   * Lists organisations where user holds an active membership.
   */
  @Get('orgs')
  @UseGuards(SessionCsrfGuard)
  async getOrgs(@Req() req: AuthenticatedRequest) {
    const { rows } = await this.pool.query(
      `SELECT o.id, o.legal_name, o.display_name, m.role
         FROM memberships m
         JOIN organisations o ON o.id = m.org_id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE'`,
      [req.auth.userId],
    );
    return rows;
  }

  /**
   * POST /api/v1/auth/switch-org
   * Changes sessions.active_org_id server-side (05 §8 / 10 §2.1 Step 5 / AUD-014).
   */
  @Post('switch-org')
  @UseGuards(SessionCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchActiveOrg(
    @Body() body: { targetOrgId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const { rows } = await this.pool.query(
      `SELECT id FROM memberships
        WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE'
        LIMIT 1`,
      [body.targetOrgId, req.auth.userId],
    );

    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Organisation membership not found',
        detail: 'You do not have an active membership in the requested organisation.',
      });
    }

    await this.pool.query(
      `UPDATE sessions SET active_org_id = $1 WHERE id = $2`,
      [body.targetOrgId, req.auth.sessionId],
    );
  }

  /**
   * API-004: POST /api/v1/auth/logout
   * Revokes the current session immediately.
   */
  @Post('logout')
  @UseGuards(SessionCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = now() WHERE id = $1`,
      [req.auth.sessionId],
    );
    res.clearCookie('tc_session', { path: '/' });
  }
}

class HttpExceptionWithRetry extends UnauthorizedException {
  constructor(status: number, code: string, detail: string, retryAfterSeconds: number) {
    super({ status, code, title: 'Rate limit exceeded', detail, retryable: true, retryAfterSeconds });
  }
}
