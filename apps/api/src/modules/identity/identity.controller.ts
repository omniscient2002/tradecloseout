import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
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
  abstract sendOtpEmail(email: string, otp: string, purpose: string): Promise<void>;
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
   * Sends a 6-digit OTP through the configured delivery adapter.
   */
  @Post('otp/request')
  @HttpCode(HttpStatus.CREATED)
  async requestOtp(
    @Body() body: { identifier?: string; phoneOrEmail?: string },
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

    // Rate limit: max 5 OTP requests / hour / identifier (10 §10), atomic Lua increment and expiry
    const isProductionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const isExplicitDebug = process.env.ENABLE_DEBUG_OTP === 'true' && !isProductionLike;
    const rateKey = `rl:otp:req:${rawId}`;
    const count = Number(await this.redis.eval(
      `local c = redis.call('INCR', KEYS[1])
       if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return c`,
      1,
      rateKey,
      3600,
    ));
    if (count > 5 || !Number.isFinite(count)) {
      throw new HttpExceptionWithRetry(429, 'RATE_LIMITED', 'Too many OTP requests. Try again later.', 300);
    }

    const challengeId = uuidv7();
    const otp = String(randomInt(100000, 999999));
    const salt = randomBytes(16).toString('hex');
    const otpHash = createHash('sha1').update(`${salt}:${otp}`).digest('hex');
    const challengePayload = JSON.stringify({ id: challengeId, identifier: rawId, salt, otpHash, attempts: 0 });

    // Atomic issuance & supersession (V01, N02): Atomically delete old generation and register new challenge
    await this.redis.eval(
      `local oldId = redis.call('GET', KEYS[1])
       if oldId and oldId ~= '' then
         redis.call('DEL', 'otp:challenge:' .. oldId)
         redis.call('DEL', 'otp:attempts:' .. oldId)
       end
       redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
       redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
       redis.call('SET', 'otp:challenge:' .. ARGV[4], ARGV[1], 'EX', ARGV[3])
       return 'OK'`,
      2,
      `otp:alias:${rawId}`,
      `otp:challenge:${challengeId}`,
      challengeId,
      challengePayload,
      300,
      rawId,
    );

    if (isExplicitDebug) {
      return {
        challengeId,
        channel: 'DEBUG',
        fallbackTriggered: false,
        expiresInSeconds: 300,
        debugOtp: otp,
      };
    }

    if (isPhone) {
      const smsFailKey = `sms:fail:${rawId}`;
      try {
        const res = await this.smsGateway.sendOtpSms(rawId, otp, process.env.DLT_OTP_TEMPLATE_ID || '');
        if (!res.delivered) throw new Error('DLT_DELIVERY_FAILED');
        await this.redis.del(smsFailKey);
        return {
          challengeId,
          channel: 'SMS',
          fallbackTriggered: false,
          expiresInSeconds: 300,
          debugOtp: isExplicitDebug ? otp : undefined,
        };
      } catch {
        // Atomic generation-safe cleanup (PA10): only delete alias/raw challenge if it still points to this challengeId
        const cleanupScript = `
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            redis.call('DEL', KEYS[1])
            redis.call('DEL', KEYS[2])
          end
          redis.call('DEL', KEYS[3])
          return 1
        `;
        await this.redis.eval(
          cleanupScript,
          3,
          `otp:alias:${rawId}`,
          `otp:challenge:${rawId}`,
          `otp:challenge:${challengeId}`,
          challengeId,
        );
        const fails = await this.redis.incr(smsFailKey);
        await this.redis.expire(smsFailKey, 900);

        throw new UnprocessableEntityException({
          code: 'SMS_DELIVERY_FAILED',
          title: 'SMS delivery failed',
          detail: fails >= 2
            ? 'Could not deliver SMS OTP. Request a new code using your verified email address.'
            : 'Could not deliver SMS OTP. Try again or use your verified email address.',
        });
      }
    }

    // Email OTP / Magic Link
    try {
      await this.mailGateway.sendOtpEmail(rawId, otp, 'SIGN_IN');
    } catch (err) {
      // Atomic generation-safe cleanup (PA10): only delete alias/raw challenge if it still points to this challengeId
      const cleanupScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          redis.call('DEL', KEYS[1])
          redis.call('DEL', KEYS[2])
        end
        redis.call('DEL', KEYS[3])
        return 1
      `;
      await this.redis.eval(
        cleanupScript,
        3,
        `otp:alias:${rawId}`,
        `otp:challenge:${rawId}`,
        `otp:challenge:${challengeId}`,
        challengeId,
      );
      throw err;
    }
    return {
      challengeId,
      channel: 'EMAIL',
      fallbackTriggered: false,
      expiresInSeconds: 300,
      debugOtp: isExplicitDebug ? otp : undefined,
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
    let rawId = (body.identifier || '').trim().toLowerCase();
    const candidateCode = (body.otp || body.code || '').trim();
    const challengeParam = (body.challengeId || '').trim();

    const inputKey = challengeParam
      ? `otp:challenge:${challengeParam}`
      : (rawId ? `otp:challenge:${rawId}` : '');
    const aliasKey = rawId ? `otp:alias:${rawId}` : '';

    if (!inputKey && !aliasKey) {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        message: 'OTP_EXPIRED',
        title: 'Verification code expired',
        detail: 'Request a new verification code.',
      });
    }

    const candidateHash = rawId ? createHash('sha256').update(`${rawId}:${candidateCode}`).digest('hex') : '';

    const rawResult = await this.redis.eval(
      `local raw = redis.call('GET', KEYS[1])
       local realChallengeId = nil
       local challengeJson = nil

       if raw then
         if string.sub(raw, 1, 1) == '{' then
           challengeJson = raw
         else
           realChallengeId = raw
           challengeJson = redis.call('GET', 'otp:challenge:' .. realChallengeId)
         end
       elseif KEYS[2] ~= '' then
         local aliasTarget = redis.call('GET', KEYS[2])
         if aliasTarget then
           realChallengeId = aliasTarget
           challengeJson = redis.call('GET', 'otp:challenge:' .. realChallengeId)
         end
       end

       if not challengeJson or string.sub(challengeJson, 1, 1) ~= '{' then
         return 'EXPIRED'
       end

       local ok, challenge = pcall(cjson.decode, challengeJson)
       if not ok or type(challenge) ~= 'table' or not challenge.identifier then
         return 'EXPIRED'
       end

       realChallengeId = challenge.id or realChallengeId

       -- Generation Binding (V01): Reject obsolete or superseded challenges
       local currentActiveId = redis.call('GET', 'otp:alias:' .. challenge.identifier)
       if not currentActiveId or currentActiveId ~= realChallengeId then
         return 'EXPIRED'
       end

       local attemptsKey = 'otp:attempts:' .. (realChallengeId or 'default')
       local challengeKey = 'otp:challenge:' .. (realChallengeId or 'default')

       local attempts = redis.call('INCR', attemptsKey)
       if attempts == 1 then
         redis.call('EXPIRE', attemptsKey, 300)
       end

       if attempts > 5 then
         redis.call('DEL', challengeKey)
         redis.call('DEL', attemptsKey)
         if currentActiveId == realChallengeId then
           redis.call('DEL', 'otp:alias:' .. challenge.identifier)
           redis.call('DEL', 'otp:challenge:' .. challenge.identifier)
         end
         return 'MAX'
       end

       -- Hash-only validation (V01): Compute SHA-1 over salt:candidateCode
       if not challenge.salt or not challenge.otpHash then
         return 'EXPIRED'
       end

       local computedHash = redis.sha1hex(challenge.salt .. ':' .. ARGV[1])
       if challenge.otpHash ~= computedHash then
         return 'INVALID'
       end

       -- Success: Atomically consume authoritative challenge, shared attempts, and clean alias only if current
       redis.call('DEL', challengeKey)
       redis.call('DEL', attemptsKey)
       local activeId = redis.call('GET', 'otp:alias:' .. challenge.identifier)
       if activeId == realChallengeId then
         redis.call('DEL', 'otp:alias:' .. challenge.identifier)
         redis.call('DEL', 'otp:challenge:' .. challenge.identifier)
       end
       return cjson.encode({ status = 'OK', identifier = challenge.identifier })`,
      2,
      inputKey || aliasKey,
      aliasKey || inputKey,
      candidateCode,
    );

    let verifyOutcome = 'EXPIRED';
    if (typeof rawResult === 'string') {
      try {
        const parsed = JSON.parse(rawResult);
        if (parsed && parsed.status === 'OK') {
          verifyOutcome = 'OK';
          if (parsed.identifier) rawId = parsed.identifier;
        } else {
          verifyOutcome = rawResult;
        }
      } catch {
        verifyOutcome = rawResult;
      }
    }

    if (verifyOutcome === 'EXPIRED') {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        message: 'OTP_EXPIRED',
        title: 'Verification code expired',
        detail: 'Request a new verification code.',
      });
    }
    if (verifyOutcome === 'MAX') {
      throw new UnauthorizedException({
        code: 'OTP_MAX_ATTEMPTS',
        message: 'OTP_MAX_ATTEMPTS',
        title: 'Too many failed attempts',
        detail: 'Maximum verification attempts exceeded. Request a new code.',
      });
    }

    if (verifyOutcome !== 'OK') {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'OTP_INVALID',
        title: 'Invalid verification code',
        detail: 'The verification code entered is incorrect.',
      });
    }

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
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
        await client.query(
          `UPDATE user_identities SET verified_at = COALESCE(verified_at, now()) WHERE type = $1 AND value = $2`,
          [idType, rawId],
        );
        await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);

        const { rows: memberships } = await client.query(
          `SELECT org_id FROM memberships WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY joined_at DESC LIMIT 1`,
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
          req?.ip || '0.0.0.0',
          req?.headers?.['user-agent'] || 'unknown',
        ],
      );

      await client.query(
        `INSERT INTO security_events (id, org_id, actor_user_id, event_type, ip, user_agent, request_id)
         VALUES ($1, $2, $3, 'USER_SESSION_CREATED', $4, $5, $6)`,
        [
          uuidv7(),
          activeOrgId,
          userId,
          req?.ip || '0.0.0.0',
          req?.headers?.['user-agent'] || 'unknown',
          (req?.headers?.['x-request-id'] as string) || 'req_auth',
        ],
      );

      await client.query('COMMIT');

      const isProductionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
      res.cookie('tc_session', rawSessionToken, {
        httpOnly: true,
        secure: isProductionLike,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return {
        userId,
        activeOrgId,
        csrfToken: rawCsrfToken,
        sessionToken: isProductionLike ? undefined : rawSessionToken,
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
    if ((req as any).userContext?.actorType === 'GUEST' || !req.auth?.userId) {
      return [];
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_user', $1, true),
                set_config('app.current_org', $2, true)`,
        [req.auth.userId, req.auth.activeOrgId || '00000000-0000-0000-0000-000000000000'],
      );
      const { rows } = await client.query(
        `SELECT o.id, o.legal_name, o.display_name, m.role
           FROM memberships m
           JOIN organisations o ON o.id = m.org_id
          WHERE m.user_id = $1 AND m.status = 'ACTIVE'`,
        [req.auth.userId],
      );
      await client.query('COMMIT');
      return rows;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/auth/switch-org
   * Changes sessions.active_org_id server-side (05 §8 / 10 §2.1 Step 5 / AUD-014).
   */
  @Post('switch-org')
  @UseGuards(SessionCsrfGuard)
  @HttpCode(HttpStatus.OK)
  async switchActiveOrg(
    @Body() body: { targetOrgId: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if ((req as any).userContext?.actorType === 'GUEST') {
      throw new UnauthorizedException('GUEST_ORGANISATION_SWITCH_DENIED');
    }
    if (!body?.targetOrgId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.targetOrgId)) {
      throw new UnprocessableEntityException({ code: 'INVALID_TARGET_ORGANISATION' });
    }

    const client = await this.pool.connect();
    const csrfToken = randomBytes(32).toString('hex');
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_org', $1, true),
                set_config('app.current_org_id', $1, true),
                set_config('app.current_user', $2, true)`,
        [body.targetOrgId, req.auth.userId],
      );
      const { rows: memberships } = await client.query(
        `SELECT m.id FROM memberships m
          JOIN organisations o ON o.id = m.org_id AND o.status = 'ACTIVE'
          WHERE m.org_id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE'
          LIMIT 1`,
        [body.targetOrgId, req.auth.userId],
      );
      if (!memberships.length) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          title: 'Organisation membership not found',
          detail: 'You do not have an active membership in the requested organisation.',
        });
      }

      const { rowCount } = await client.query(
        `UPDATE sessions
            SET active_org_id = $1, csrf_token_hash = $2
          WHERE id = $3 AND user_id = $4 AND revoked_at IS NULL AND expires_at > now()`,
        [body.targetOrgId, createHash('sha256').update(csrfToken).digest('hex'), req.auth.sessionId, req.auth.userId],
      );
      if (!rowCount) throw new UnauthorizedException('SESSION_EXPIRED');
      await client.query('COMMIT');
      return { activeOrgId: body.targetOrgId, csrfToken };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * API-004: POST /api/v1/auth/logout
   * Revokes the current session immediately and clears HttpOnly cookie.
   */
  @Post('logout')
  @UseGuards(SessionCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const rawSessionToken =
      req.cookies?.['tc_session'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (rawSessionToken && typeof rawSessionToken === 'string') {
      const tokenHash = createHash('sha256').update(rawSessionToken).digest('hex');
      await this.pool.query(
        `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash],
      );
    }
    res.clearCookie('tc_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      path: '/',
    });
    return undefined;
  }

}

class HttpExceptionWithRetry extends HttpException {
  constructor(status: number, code: string, detail: string, retryAfterSeconds: number) {
    super(
      { status, code, title: 'Rate limit exceeded', detail, retryable: true, retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
