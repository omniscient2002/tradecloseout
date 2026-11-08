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
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AuthenticatedRequest, SessionCsrfGuard } from '../../common/guards/session-csrf.guard';
import { assertAuthenticationOrigin, assertAuthenticationIntent, AUTH_INTENT_COOKIE, consumeAuthenticationBudget, deriveSessionCsrf, recordAuthenticationEvent, isProductionEnvironment, setAuthenticationIntent } from './auth-security';

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
    @Res({ passthrough: true }) res?: Response,
  ) {
    assertAuthenticationOrigin(req);
    const supplied = body?.identifier ?? body?.phoneOrEmail;
    if (typeof supplied !== 'string' || supplied.length > 320) {
      throw new UnprocessableEntityException({ code: 'INVALID_IDENTIFIER', detail: 'A valid email or mobile number is required.' });
    }
    const rawId = supplied.trim().toLowerCase();
    const isPhone = /^\+91[6-9][0-9]{9}$/.test(rawId);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawId);

    if (!isPhone && !isEmail) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        title: 'Invalid email or Indian mobile number',
        detail: 'Provide a valid business email or +91 10-digit mobile number.',
      });
    }

    if (isProductionEnvironment()) {
      const ip = String(req?.ip || req?.socket?.remoteAddress || 'unknown');
      await consumeAuthenticationBudget(this.pool, 'otp:ip:hour', ip, 20, 3600);
      await consumeAuthenticationBudget(this.pool, 'otp:contact:hour', rawId, 5, 3600);
      await consumeAuthenticationBudget(this.pool, 'otp:global:hour', 'all', 6000, 3600);
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
    const otpScheme = isProductionEnvironment() ? 'HMAC_SHA256_V1' : 'SHA1_LEGACY_DEV';
    const otpHash = otpScheme === 'HMAC_SHA256_V1'
      ? createHmac('sha256', process.env.AUTH_OTP_HMAC_KEY!).update(`LOGIN:${challengeId}:${rawId}:${otp}`).digest('hex')
      : createHash('sha1').update(`${salt}:${otp}`).digest('hex');
    const authIntentHash = setAuthenticationIntent(res);
    const challengePayload = JSON.stringify({
      id: challengeId, identifier: rawId, salt, otpHash, otpScheme, authIntentHash, attempts: 0,
    });

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

    if (isProductionEnvironment()) {
      // The OTP's authoritative proof is now transactional with onboarding
      // in PostgreSQL. Redis remains only a rate-limit/legacy cache.
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [rawId]);
        await c.query(
          `UPDATE otp_challenges SET consumed_at = now()
            WHERE identifier = $1 AND purpose = 'LOGIN' AND consumed_at IS NULL`,
          [rawId],
        );
        await c.query(
          `INSERT INTO otp_challenges
            (id,channel,identifier,purpose,code_hash,expires_at,delivery_status,auth_intent_hash)
           VALUES($1,$2,$3,'LOGIN',$4,now()+interval '5 minutes','PENDING',$5)`,
          [challengeId,isPhone ? 'SMS' : 'EMAIL',rawId,otpHash,authIntentHash],
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally { c.release(); }
    }

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
        if (isProductionEnvironment()) {
          await this.pool.query(
            `UPDATE otp_challenges SET delivery_status='SENT'
              WHERE id=$1 AND delivery_status='PENDING' AND expires_at>now()`,
            [challengeId],
          );
        }
        await this.redis.del(smsFailKey);
        return {
          challengeId,
          channel: 'SMS',
          fallbackTriggered: false,
          expiresInSeconds: 300,
          debugOtp: isExplicitDebug ? otp : undefined,
        };
      } catch {
        if (isProductionEnvironment()) {
          await this.pool.query(
            `UPDATE otp_challenges SET delivery_status='FAILED'
              WHERE id=$1 AND delivery_status='PENDING'`, [challengeId],
          ).catch(() => {});
        }
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
      if (isProductionEnvironment()) {
        await this.pool.query(
          `UPDATE otp_challenges SET delivery_status='SENT'
            WHERE id=$1 AND delivery_status='PENDING' AND expires_at>now()`,
          [challengeId],
        );
      }
    } catch (err) {
      if (isProductionEnvironment()) {
        await this.pool.query(
          `UPDATE otp_challenges SET delivery_status='FAILED'
            WHERE id=$1 AND delivery_status='PENDING'`, [challengeId],
        ).catch(() => {});
      }
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
      invitationToken?: string;
    },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertAuthenticationOrigin(req);
    if (!body || typeof body !== 'object' ||
        (body.identifier != null && typeof body.identifier !== 'string') ||
        (body.challengeId != null && typeof body.challengeId !== 'string') ||
        (body.invitationToken != null && typeof body.invitationToken !== 'string') ||
        (body.otp != null && typeof body.otp !== 'string') ||
        (body.code != null && typeof body.code !== 'string')) {
      throw new UnprocessableEntityException({ code: 'INVALID_OTP_INPUT', detail: 'Invalid OTP verification request.' });
    }
    const invitationToken = body.invitationToken || null;
    if (invitationToken && !/^[0-9a-f]{64}$/i.test(invitationToken)) {
      throw new UnprocessableEntityException({ code: 'INVALID_INVITATION_TOKEN' });
    }
    let rawId = (body.identifier ?? '').trim().toLowerCase();
    const candidateCode = (body.otp ?? body.code ?? '').trim();
    const challengeParam = (body.challengeId ?? '').trim();
    if (!/^\d{6}$/.test(candidateCode) ||
        (challengeParam && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(challengeParam)) ||
        rawId.length > 320) {
      throw new UnprocessableEntityException({ code: 'INVALID_OTP_INPUT', detail: 'Verification requires a six-digit code and valid challenge ID.' });
    }

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

    if (isProductionEnvironment() && !challengeParam) {
      throw new UnprocessableEntityException({
        code: 'CHALLENGE_ID_REQUIRED',
        detail: 'Production OTP verification requires the original challenge ID.',
      });
    }
    // Verify the originating browser's nonce before accepting an OTP. A valid
    // code submitted in a different browser must never replace its session.
    if (challengeParam && !isProductionEnvironment()) {
      const preview = await this.redis.get(`otp:challenge:${challengeParam}`);
      let expectedIntent: string | null = null;
      try { expectedIntent = preview ? JSON.parse(preview)?.authIntentHash ?? null : null; }
      catch { /* malformed challenge is rejected by Redis atomic validation */ }
      assertAuthenticationIntent(req, expectedIntent);
    }
    // Production verifies the intent against the locked PostgreSQL challenge,
    // not the Redis preview or a missing expected hash.

    let verifyOutcome = 'EXPIRED';
    let authDbClient: PoolClient | null = null;
    if (isProductionEnvironment()) {
      // The PostgreSQL OTP row is authoritative in production. Lock the proof
      // and retain its transaction across identity lookup and session INSERT.
      // A database rollback therefore never consumes a valid OTP.
      const candidateClient = await this.pool.connect();
      try {
        await candidateClient.query('BEGIN');
        const { rows: challengeRows } = await candidateClient.query(
          `SELECT id, identifier, code_hash, attempts, auth_intent_hash
            FROM otp_challenges
            WHERE id=$1 AND purpose='LOGIN' AND consumed_at IS NULL
              AND delivery_status='SENT' AND expires_at>now()
            FOR UPDATE`,
          [challengeParam],
        );
        if (!challengeRows.length) {
          verifyOutcome = 'EXPIRED';
          await candidateClient.query('ROLLBACK');
          candidateClient.release();
        } else {
          const proof = challengeRows[0];
          assertAuthenticationIntent(req, proof.auth_intent_hash);
          const computed = createHmac('sha256', process.env.AUTH_OTP_HMAC_KEY!)
            .update(`LOGIN:${proof.id}:${proof.identifier}:${candidateCode}`).digest('hex');
          const actual = Buffer.from(proof.code_hash, 'hex');
          const expected = Buffer.from(computed, 'hex');
          if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            const attempts = Math.min(5, Number(proof.attempts || 0) + 1);
            await candidateClient.query(
              `UPDATE otp_challenges
                  SET attempts=$2,
                      consumed_at=CASE WHEN $2 >= 5 THEN now() ELSE consumed_at END
                WHERE id=$1`,
              [challengeParam, attempts],
            );
            await candidateClient.query('COMMIT');
            candidateClient.release();
            verifyOutcome = attempts >= 5 ? 'MAX' : 'INVALID';
          } else {
            rawId = String(proof.identifier);
            verifyOutcome = 'OK';
            authDbClient = candidateClient;
          }
        }
      } catch (err) {
        await candidateClient.query('ROLLBACK').catch(() => {});
        candidateClient.release();
        throw err;
      }
    } else {
      // Legacy in-memory/Redis fixture path is restricted to nonproduction.
      // It continues to exercise the historical tests without holding a DB
      // transaction across a nonauthoritative development proof.
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

       -- Production proofs use a server-secret HMAC, never an offline-searchable
       -- six-digit SHA-1/SHA-256 digest. Compare the server-computed keyed proof
       -- only after checking active challenge generation in this Lua operation.
       if ARGV[3] == '1' then
         if challenge.otpScheme ~= 'HMAC_SHA256_V1' or
            not challenge.otpHash or challenge.otpHash ~= ARGV[2] then
           return 'INVALID'
         end
       else
         if not challenge.salt or not challenge.otpHash then return 'EXPIRED' end
         if challenge.otpHash ~= redis.sha1hex(challenge.salt .. ':' .. ARGV[1]) then
           return 'INVALID'
         end
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
      '',
      isProductionEnvironment() ? '1' : '0',
    );

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

    }

    if (isProductionEnvironment() && verifyOutcome !== 'OK') {
      await recordAuthenticationEvent(this.pool, 'INTERNAL_OTP_VERIFICATION',
        verifyOutcome === 'MAX' ? 'THROTTLED' : 'DENIED',
        { subject: rawId || challengeParam });
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

    const client = authDbClient ?? await this.pool.connect();
    try {
      if (!authDbClient) await client.query('BEGIN');

      const idType = rawId.startsWith('+91') ? 'PHONE' : 'EMAIL';
      const { rows: existingIdentities } = await client.query(
        `SELECT user_id FROM user_identities WHERE type = $1 AND value = $2 LIMIT 1`,
        [idType, rawId],
      );

      // An invitation is claimed only after the server-derived OTP identity
      // has been verified. The RLS invitation claim policy requires a matching
      // 256-bit token hash; this query also verifies the intended destination.
      let invitation: { id: string; org_id: string; role: string } | null = null;
      if (invitationToken) {
        const invitationHash = createHash('sha256').update(invitationToken).digest('hex');
        await client.query("SELECT set_config('app.invitation_hash', $1, true)", [invitationHash]);
        const { rows } = await client.query(
          `SELECT i.id, i.org_id, i.role FROM invitations i
             JOIN organisations o ON o.id = i.org_id AND o.status = 'ACTIVE'
            WHERE i.token_hash = $1 AND i.status = 'PENDING'
              AND i.expires_at > now()
              AND (($3 = 'EMAIL' AND i.email = $2) OR
                   ($3 = 'PHONE' AND i.phone_e164 = $2))
            FOR UPDATE OF i`,
          [invitationHash, rawId, idType],
        );
        if (!rows.length) {
          throw new UnauthorizedException({ code: 'INVITATION_INVALID_OR_MISMATCHED' });
        }
        invitation = rows[0];
      }

      const acceptInvitation = async (subjectUserId: string) => {
        if (!invitation) return;
        await client.query(
          "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
          [invitation.org_id],
        );
        await client.query("SELECT set_config('app.current_user', $1, true)", [subjectUserId]);
        const { rows: existing } = await client.query(
          `SELECT id, status, role FROM memberships
            WHERE org_id = $1 AND user_id = $2 FOR UPDATE`,
          [invitation.org_id, subjectUserId],
        );
        if (existing.length && existing[0].status !== 'ACTIVE') {
          throw new UnauthorizedException({
            code: 'INVITATION_CANNOT_REACTIVATE_SUSPENDED_MEMBER',
          });
        }
        if (existing.length && existing[0].role !== invitation.role) {
          throw new UnauthorizedException({ code: 'INVITATION_CANNOT_CHANGE_EXISTING_MEMBER_ROLE' });
        }
        if (!existing.length) {
          await client.query(
            `INSERT INTO memberships(id,org_id,user_id,role,status,joined_at)
             VALUES($1,$2,$3,$4,'ACTIVE',now())`,
            [uuidv7(),invitation.org_id,subjectUserId,invitation.role],
          );
        }
        const { rowCount } = await client.query(
          `UPDATE invitations SET status='ACCEPTED'
            WHERE id=$1 AND org_id=$2 AND status='PENDING' AND expires_at>now()`,
          [invitation.id,invitation.org_id],
        );
        if (!rowCount) throw new UnauthorizedException({ code: 'INVITATION_ALREADY_CONSUMED' });
      };

      let userId: string;
      let activeOrgId: string;
      let currentRole = 'R-OWNER';
      let fullName = body.signupProfile?.fullName?.trim() || 'Principal Contractor';

      if (existingIdentities.length > 0) {
        userId = existingIdentities[0].user_id;
        const { rows: eligibleUsers } = await client.query(
          `SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE' FOR SHARE`,
          [userId],
        );
        if (!eligibleUsers.length) {
          throw new UnauthorizedException({ code: 'ACCOUNT_UNAVAILABLE', detail: 'This account is not eligible to sign in.' });
        }
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
        await client.query(
          `UPDATE user_identities SET verified_at = COALESCE(verified_at, now()) WHERE type = $1 AND value = $2`,
          [idType, rawId],
        );
        await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
        await acceptInvitation(userId);

        const { rows: memberships } = await client.query(
          `SELECT m.org_id, m.role FROM memberships m JOIN organisations o ON o.id = m.org_id
            WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
            ORDER BY m.joined_at DESC LIMIT 1`,
          [userId],
        );
        if (memberships.length === 0) {
          throw new UnauthorizedException({
            code: 'NO_ACTIVE_ORG',
            title: 'No active organisation membership',
            detail: 'Your account has no active organisation memberships.',
          });
        }
        activeOrgId = invitation?.org_id || memberships[0].org_id;
        currentRole = invitation?.role || memberships[0].role;

        const { rows: userRows } = await client.query(`SELECT name FROM users WHERE id = $1`, [userId]);
        if (userRows.length > 0 && userRows[0].name) {
          fullName = userRows[0].name;
        }
      } else if (invitation) {
        // Invited verified identity joins the intended existing organisation.
        // An invitation must not silently create an unrelated owner company.
        userId = uuidv7();
        activeOrgId = invitation.org_id;
        currentRole = invitation.role;
        const suppliedName = body.signupProfile?.fullName;
        fullName = typeof suppliedName === 'string' &&
          suppliedName.trim().length >= 2 && suppliedName.trim().length <= 120
          ? suppliedName.trim() : 'Invited team member';
        await client.query("SELECT set_config('app.current_user',$1,true)", [userId]);
        await client.query(
          `INSERT INTO users(id,name,status,last_login_at)
           VALUES($1,$2,'ACTIVE',now())`,
          [userId,fullName],
        );
        await client.query(
          `INSERT INTO user_identities(id,user_id,type,value,verified_at)
           VALUES($1,$2,$3,$4,now())`,
          [uuidv7(),userId,idType,rawId],
        );
        await acceptInvitation(userId);
      } else {
        // New Org + Owner Registration (WF-01 / FR-ORG-001)
        const profile = body.signupProfile;
        if (!profile || typeof profile.fullName !== 'string' ||
            typeof profile.orgName !== 'string' || typeof profile.state !== 'string' ||
            profile.fullName.trim().length < 2 || profile.fullName.trim().length > 120 ||
            profile.orgName.trim().length < 2 || profile.orgName.trim().length > 200 ||
            !/^[A-Z]{2}$/.test(profile.state.trim().toUpperCase())) {
          throw new UnprocessableEntityException({
            code: 'SIGNUP_PROFILE_REQUIRED',
            detail: 'New organisations require an explicit valid name, company name and Indian state.',
          });
        }
        fullName = profile.fullName.trim();
        const orgName = profile.orgName.trim();
        const state = profile.state.trim().toUpperCase();

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
      const authGeneration = uuidv7();
      const rawCsrfToken = deriveSessionCsrf(rawSessionToken, authGeneration);
      const sessionTokenHash = createHash('sha256').update(rawSessionToken).digest('hex');
      const csrfTokenHash = createHash('sha256').update(rawCsrfToken).digest('hex');
      const sessionId = uuidv7();

      await client.query(
        `INSERT INTO sessions
          (id, user_id, token_hash, csrf_token_hash, active_org_id, expires_at, ip, user_agent, auth_generation)
         VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', $6, $7, $8)`,
        [
          sessionId,
          userId,
          sessionTokenHash,
          csrfTokenHash,
          activeOrgId,
          req?.ip || '0.0.0.0',
          req?.headers?.['user-agent'] || 'unknown',
          authGeneration,
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

      if (authDbClient) {
        const { rowCount } = await client.query(
          `UPDATE otp_challenges SET consumed_at=now()
            WHERE id=$1 AND purpose='LOGIN'
              AND consumed_at IS NULL AND delivery_status='SENT' AND expires_at>now()`,
          [challengeParam],
        );
        if (!rowCount) throw new UnauthorizedException({ code: 'OTP_EXPIRED' });
      }

      await client.query(
        `INSERT INTO auth_security_events
          (id,actor_user_id,org_id,session_id,event_type,outcome)
         VALUES (gen_random_uuid(),$1,$2,$3,'INTERNAL_OTP_LOGIN','SUCCESS')`,
        [userId,activeOrgId,sessionId],
      );
      await client.query('COMMIT');

      const isProductionLike = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
      res.clearCookie(AUTH_INTENT_COOKIE, {
        httpOnly: true, secure: isProductionLike, sameSite: 'strict', path: '/',
      });
      res.cookie('tc_session', rawSessionToken, {
        httpOnly: true,
        secure: isProductionLike,
        sameSite: 'lax',
        path: '/',
        // Browser credential may persist 90 days, but server independently
        // enforces 30-day inactivity and a hard 90-day absolute expiry.
        maxAge: 90 * 24 * 60 * 60 * 1000,
      });

      return {
        userId,
        activeOrgId,
        csrfToken: rawCsrfToken,
        authGeneration,
        mfaRequired: currentRole === 'R-OWNER' || currentRole === 'R-ADMIN',
        mfaVerified: false,
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
  /**
   * Restore the generation-bound CSRF token from the HttpOnly session cookie.
   * This is a no-store same-origin authenticated GET; it does not disclose
   * the raw bearer token and does not mutate the server session.
   */
  @Get('session/bootstrap')
  @UseGuards(SessionCsrfGuard)
  async bootstrapSession(@Req() req: AuthenticatedRequest) {
    const raw = (req as any).cookies?.tc_session;
    if (typeof raw !== 'string' || raw.length < 32) {
      throw new UnauthorizedException({ code: 'SESSION_COOKIE_REQUIRED' });
    }
    const csrfToken = deriveSessionCsrf(raw, req.auth.authGeneration);
    const computedHash = createHash('sha256').update(csrfToken).digest('hex');
    // Legacy pre-generation sessions require reauthentication rather than
    // silently resetting an arbitrary old CSRF value.
    const { rows } = await this.pool.query(
      `SELECT csrf_token_hash FROM sessions
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [req.auth.sessionId],
    );
    if (!rows.length || rows[0].csrf_token_hash !== computedHash) {
      throw new UnauthorizedException({ code: 'SESSION_REAUTHENTICATION_REQUIRED' });
    }
    return { csrfToken, authGeneration: req.auth.authGeneration };
  }

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
      authGeneration: req.auth.authGeneration,
      mfaRequired: req.auth.orgRole === 'R-OWNER' || req.auth.orgRole === 'R-ADMIN',
      mfaVerified: req.auth.mfaVerified,
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
    @Res({ passthrough: true }) res?: Response,
  ) {
    if ((req as any).userContext?.actorType === 'GUEST') {
      throw new UnauthorizedException('GUEST_ORGANISATION_SWITCH_DENIED');
    }
    if (!body?.targetOrgId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.targetOrgId)) {
      throw new UnprocessableEntityException({ code: 'INVALID_TARGET_ORGANISATION' });
    }

    const client = await this.pool.connect();
    const authGeneration = uuidv7();
    const rawToken = (req as any).cookies?.tc_session;
    if (typeof rawToken !== 'string') throw new UnauthorizedException('SESSION_COOKIE_REQUIRED');
    if (isProductionEnvironment() && !res) throw new UnauthorizedException('SESSION_ROTATION_UNAVAILABLE');
    const rotatedToken = randomBytes(32).toString('hex');
    const csrfToken = deriveSessionCsrf(rotatedToken, authGeneration);
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
            SET active_org_id = $1, csrf_token_hash = $2, auth_generation = $5,
                token_hash = $6, mfa_verified=false, mfa_verified_at=NULL
          WHERE id = $3 AND user_id = $4 AND revoked_at IS NULL AND expires_at > now()
            AND token_hash=$7 AND auth_generation=$8`,
        [body.targetOrgId, createHash('sha256').update(csrfToken).digest('hex'),
          req.auth.sessionId, req.auth.userId, authGeneration,
          createHash('sha256').update(rotatedToken).digest('hex'),
          createHash('sha256').update(rawToken).digest('hex'), req.auth.authGeneration],
      );
      if (!rowCount) throw new UnauthorizedException('SESSION_EXPIRED');
      await client.query('COMMIT');
      res?.cookie('tc_session', rotatedToken, {
        httpOnly: true, secure: isProductionEnvironment(), sameSite: 'lax',
        path: '/', maxAge: 90 * 24 * 3600 * 1000,
      });
      return { activeOrgId: body.targetOrgId, csrfToken, authGeneration };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Current-device inventory never exposes bearer credentials or CSRF. */
  @Get('sessions')
  @UseGuards(SessionCsrfGuard)
  async listOwnSessions(@Req() req: AuthenticatedRequest) {
    const { rows } = await this.pool.query(
      `SELECT id, created_at, last_activity_at, expires_at,
              user_agent, (id = $2) AS is_current
         FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL
          AND expires_at > now() AND absolute_expires_at > now()
        ORDER BY created_at DESC LIMIT 100`,
      [req.auth.userId, req.auth.sessionId],
    );
    return { sessions: rows };
  }

  /**
   * Emergency revocation is intentionally available without a new MFA step.
   * Revocations and redacted events commit atomically.
   */
  @Post('sessions/revoke-all')
  @UseGuards(SessionCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllSessions(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    await this.pool.query(
      `WITH revoked AS (
         UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id, user_id, active_org_id
       )
       INSERT INTO auth_security_events
         (id, actor_user_id, org_id, session_id, event_type, outcome)
       SELECT gen_random_uuid(), user_id, active_org_id, id,
              'SESSION_REVOKED_ALL', 'SUCCESS' FROM revoked`,
      [req.auth.userId],
    );
    res.clearCookie('tc_session', {
      httpOnly: true,
      secure: isProductionEnvironment(),
      sameSite: 'lax',
      path: '/',
    });
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
        `WITH revoked AS (
           UPDATE sessions SET revoked_at = now()
           WHERE token_hash = $1 AND revoked_at IS NULL
           RETURNING id, user_id, active_org_id
         )
         INSERT INTO auth_security_events
           (id, actor_user_id, org_id, session_id, event_type, outcome)
         SELECT gen_random_uuid(), user_id, active_org_id, id,
                'SESSION_REVOKED', 'SUCCESS' FROM revoked`,
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
