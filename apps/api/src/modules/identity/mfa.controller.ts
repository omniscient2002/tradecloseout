import {
  BadRequestException, ConflictException, Controller, ForbiddenException,
  Get, Post, Body, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { Response } from 'express';
import { uuidv7 } from 'uuidv7';
import { SessionCsrfGuard, AuthenticatedRequest } from '../../common/guards/session-csrf.guard';
import { consumeAuthenticationBudget, deriveSessionCsrf, isProductionEnvironment } from './auth-security';
import {
  decryptFactor, encryptFactor, hashRecoveryCode, newRecoveryCodes,
  newTotpSecret, verifyTotp,
} from './mfa-crypto';

type AuthenticatedMfaRequest = AuthenticatedRequest & {
  auth: AuthenticatedRequest['auth'] & { mfaVerified?: boolean };
  userContext?: { actorType?: string };
};

type NewSession = {
  csrfToken: string; authGeneration: string;
  mfaVerified: true; rawSessionToken: string;
};

@Controller('api/v1/auth/mfa')
@UseGuards(SessionCsrfGuard)
export class MfaController {
  constructor(private readonly pool: Pool) {}

  private assertMember(req: AuthenticatedMfaRequest): void {
    if (req.userContext?.actorType === 'GUEST') {
      throw new ForbiddenException({ code: 'MFA_MEMBER_ONLY' });
    }
  }

  private async enforceMfaAttemptBudget(
    req: AuthenticatedMfaRequest, action: 'enroll' | 'verify' | 'recovery',
  ): Promise<void> {
    // Budget reservations are external to the factor transaction and survive
    // invalid codes or a rollback, across all API replicas.
    const max = action === 'recovery' ? 5 : 10;
    await consumeAuthenticationBudget(this.pool, `mfa:${action}:user`,
      req.auth.userId, max, 15 * 60);
    await consumeAuthenticationBudget(this.pool, `mfa:${action}:ip`,
      String(req.ip || 'unknown'), 30, 15 * 60);
  }

  private async transact<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_user', $1, true)", [userId]);
      const value = await fn(c);
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  private async rotateVerifiedSession(
    client: PoolClient, req: AuthenticatedMfaRequest, kind: string,
  ): Promise<NewSession> {
    const previousRawToken = req.cookies?.tc_session;
    if (typeof previousRawToken !== 'string' || !req.auth.authGeneration) {
      throw new UnauthorizedException({ code: 'SESSION_COOKIE_REQUIRED' });
    }
    const previousTokenHash = createHash('sha256').update(previousRawToken).digest('hex');
    const rawSessionToken = randomBytes(32).toString('hex');
    const authGeneration = uuidv7();
    const csrfToken = deriveSessionCsrf(rawSessionToken, authGeneration);
    const { rowCount } = await client.query(
      `UPDATE sessions
          SET token_hash = $1, csrf_token_hash = $2,
              auth_generation = $3, mfa_verified = true, mfa_verified_at = now(),
              authenticated_at = now()
        WHERE id = $4 AND user_id = $5 AND guest_grant_id IS NULL
          AND active_org_id = $6 AND auth_generation = $7 AND token_hash = $8
          AND revoked_at IS NULL AND expires_at > now()
          AND absolute_expires_at > now()`,
      [
        createHash('sha256').update(rawSessionToken).digest('hex'),
        createHash('sha256').update(csrfToken).digest('hex'),
        authGeneration, req.auth.sessionId, req.auth.userId,
        req.auth.activeOrgId, req.auth.authGeneration, previousTokenHash,
      ],
    );
    if (!rowCount) throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    await client.query(
      `INSERT INTO auth_security_events
        (id, actor_user_id, org_id, session_id, event_type, outcome)
       VALUES ($1, $2, $3, $4, $5, 'SUCCESS')`,
      [uuidv7(), req.auth.userId, req.auth.activeOrgId, req.auth.sessionId, kind],
    );
    return { rawSessionToken, authGeneration, csrfToken, mfaVerified: true };
  }

  private async assertCurrentMemberSession(
    client: PoolClient, req: AuthenticatedMfaRequest,
  ): Promise<void> {
    const rawToken = req.cookies?.tc_session;
    if (typeof rawToken !== 'string' || !req.auth.authGeneration) {
      throw new UnauthorizedException({ code: 'SESSION_COOKIE_REQUIRED' });
    }
    const { rows } = await client.query(
      `SELECT id FROM sessions WHERE id=$1 AND user_id=$2
        AND active_org_id=$3 AND auth_generation=$4 AND token_hash=$5
        AND guest_grant_id IS NULL AND revoked_at IS NULL
        AND expires_at>now() AND absolute_expires_at>now()
        FOR UPDATE`,
      [req.auth.sessionId, req.auth.userId, req.auth.activeOrgId,
        req.auth.authGeneration, createHash('sha256').update(rawToken).digest('hex')],
    );
    if (!rows.length) throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
  }

  private completeSession(res: Response, result: NewSession) {
    res.cookie('tc_session', result.rawSessionToken, {
      httpOnly: true, secure: isProductionEnvironment(), sameSite: 'lax',
      path: '/', maxAge: 90 * 24 * 3600 * 1000,
    });
    return { csrfToken: result.csrfToken, authGeneration: result.authGeneration, mfaVerified: true };
  }

  @Get('status')
  async status(@Req() req: AuthenticatedMfaRequest) {
    this.assertMember(req);
    const { rows } = await this.pool.query(
      `SELECT mfa_enabled_at IS NOT NULL AS enabled
        FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [req.auth.userId],
    );
    if (!rows.length) throw new UnauthorizedException('ACCOUNT_UNAVAILABLE');
    return { enrolled: Boolean(rows[0].enabled), verified: Boolean(req.auth.mfaVerified) };
  }

  @Post('enroll/start')
  async beginEnrollment(@Req() req: AuthenticatedMfaRequest) {
    this.assertMember(req);
    await this.enforceMfaAttemptBudget(req, 'enroll');
    const secret = newTotpSecret();
    await this.transact(req.auth.userId, async client => {
      const { rows } = await client.query(
        `SELECT id, mfa_enabled_at FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
        [req.auth.userId],
      );
      if (!rows.length) throw new UnauthorizedException('ACCOUNT_UNAVAILABLE');
      if (rows[0].mfa_enabled_at) throw new ConflictException({
        code: 'MFA_ALREADY_ENROLLED',
        detail: 'Use factor verification or an authenticated recovery procedure.',
      });
      await client.query(
        `UPDATE users SET mfa_totp_pending_secret=$2 WHERE id=$1`,
        [req.auth.userId, encryptFactor(secret)],
      );
    });
    // The secret is returned once over HTTPS. It must never be placed in logs
    // or an untrusted QR generator URL.
    return { manualSetupKey: secret, algorithm: 'SHA1', digits: 6, periodSeconds: 30 };
  }

  @Post('enroll/confirm')
  async confirmEnrollment(
    @Req() req: AuthenticatedMfaRequest,
    @Body() input: { code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertMember(req);
    if (typeof input?.code !== 'string' || !/^\d{6}$/.test(input.code)) {
      throw new BadRequestException({ code: 'MFA_CODE_INVALID' });
    }
    await this.enforceMfaAttemptBudget(req, 'verify');
    const result = await this.transact(req.auth.userId, async client => {
      const { rows } = await client.query(
        `SELECT mfa_totp_pending_secret, mfa_enabled_at, mfa_totp_last_step
           FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
        [req.auth.userId],
      );
      if (!rows.length || !rows[0].mfa_totp_pending_secret || rows[0].mfa_enabled_at) {
        throw new ConflictException({ code: 'MFA_ENROLLMENT_NOT_PENDING' });
      }
      const step = verifyTotp(
        decryptFactor(rows[0].mfa_totp_pending_secret), input.code!,
        Number(rows[0].mfa_totp_last_step),
      );
      if (step === null) throw new UnauthorizedException({ code: 'MFA_CODE_INVALID' });
      await client.query(
        `UPDATE users SET mfa_totp_secret=mfa_totp_pending_secret,
         mfa_totp_pending_secret=NULL, mfa_enabled_at=now(),
         mfa_totp_last_step=$2 WHERE id=$1`,
        [req.auth.userId, step],
      );
      await client.query(
        `DELETE FROM mfa_recovery_codes WHERE user_id=$1`,
        [req.auth.userId],
      );
      const recoveryCodes = newRecoveryCodes();
      for (const code of recoveryCodes) {
        await client.query(
          `INSERT INTO mfa_recovery_codes(id,user_id,code_hash)
            VALUES($1,$2,$3)`,
          [uuidv7(), req.auth.userId, hashRecoveryCode(code)],
        );
      }
      const session = await this.rotateVerifiedSession(client, req, 'MFA_ENROLLED');
      return { session, recoveryCodes };
    });
    return { ...this.completeSession(res, result.session), recoveryCodes: result.recoveryCodes };
  }

  @Post('verify')
  async verifyFactor(
    @Req() req: AuthenticatedMfaRequest,
    @Body() input: { code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertMember(req);
    if (typeof input?.code !== 'string' || !/^\d{6}$/.test(input.code)) {
      throw new BadRequestException({ code: 'MFA_CODE_INVALID' });
    }
    await this.enforceMfaAttemptBudget(req, 'verify');
    const session = await this.transact(req.auth.userId, async client => {
      const { rows } = await client.query(
        `SELECT mfa_totp_secret,mfa_totp_last_step,mfa_enabled_at
           FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
        [req.auth.userId],
      );
      if (!rows.length || !rows[0].mfa_enabled_at || !rows[0].mfa_totp_secret) {
        throw new ForbiddenException({ code: 'MFA_NOT_ENROLLED' });
      }
      const step = verifyTotp(
        decryptFactor(rows[0].mfa_totp_secret), input.code!,
        Number(rows[0].mfa_totp_last_step),
      );
      if (step === null) throw new UnauthorizedException({ code: 'MFA_CODE_INVALID_OR_REPLAYED' });
      await client.query(
        `UPDATE users SET mfa_totp_last_step=$2 WHERE id=$1`,
        [req.auth.userId, step],
      );
      return this.rotateVerifiedSession(client, req, 'MFA_VERIFIED');
    });
    return this.completeSession(res, session);
  }

  @Post('recovery')
  async recoverFactor(
    @Req() req: AuthenticatedMfaRequest,
    @Body() input: { recoveryCode?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertMember(req);
    if (typeof input?.recoveryCode !== 'string' || !/^[0-9A-Fa-f]{24}$/.test(input.recoveryCode)) {
      throw new BadRequestException({ code: 'RECOVERY_CODE_INVALID' });
    }
    await this.enforceMfaAttemptBudget(req, 'recovery');
    const session = await this.transact(req.auth.userId, async client => {
      const { rows } = await client.query(
        `SELECT id FROM mfa_recovery_codes
          WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL FOR UPDATE`,
        [req.auth.userId, hashRecoveryCode(input.recoveryCode!)],
      );
      if (!rows.length) throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID' });
      await client.query(
        `UPDATE mfa_recovery_codes SET consumed_at=now()
          WHERE id=$1 AND consumed_at IS NULL`,
        [rows[0].id],
      );
      return this.rotateVerifiedSession(client, req, 'MFA_RECOVERY_USED');
    });
    return this.completeSession(res, session);
  }

  /**
   * Disenrolling a privileged factor requires a NEW valid TOTP or a distinct
   * one-use recovery code in addition to the recent-MFA session state.
   * It revokes every device session and forces new OTP authentication.
   */
  @Post('reset')
  async resetEnrollment(
    @Req() req: AuthenticatedMfaRequest,
    @Body() input: { code?: string; recoveryCode?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertMember(req);
    if (!req.auth.mfaVerified) throw new ForbiddenException({ code: 'MFA_STEP_UP_REQUIRED' });
    const totpCode = typeof input?.code === 'string' && /^\d{6}$/.test(input.code)
      ? input.code : null;
    const backupCode = typeof input?.recoveryCode === 'string' &&
      /^[0-9A-Fa-f]{24}$/.test(input.recoveryCode) ? input.recoveryCode : null;
    if (Boolean(totpCode) === Boolean(backupCode)) {
      throw new BadRequestException({ code: 'MFA_FRESH_PROOF_REQUIRED' });
    }
    await this.enforceMfaAttemptBudget(req, backupCode ? 'recovery' : 'verify');
    const result = await this.transact(req.auth.userId, async client => {
      const { rows } = await client.query(
        `SELECT mfa_enabled_at, mfa_totp_secret, mfa_totp_last_step
           FROM users WHERE id=$1 AND status='ACTIVE' FOR UPDATE`,
        [req.auth.userId],
      );
      if (!rows.length || !rows[0].mfa_enabled_at) throw new ConflictException('MFA_NOT_ENROLLED');
      await this.assertCurrentMemberSession(client, req);
      if (totpCode) {
        const step = verifyTotp(
          decryptFactor(rows[0].mfa_totp_secret), totpCode,
          Number(rows[0].mfa_totp_last_step),
        );
        if (step === null) throw new UnauthorizedException({ code: 'MFA_FRESH_PROOF_INVALID' });
        await client.query(
          `UPDATE users SET mfa_totp_last_step=$2 WHERE id=$1`,
          [req.auth.userId, step],
        );
      } else {
        const { rows: recovery } = await client.query(
          `SELECT id FROM mfa_recovery_codes
           WHERE user_id=$1 AND code_hash=$2 AND consumed_at IS NULL FOR UPDATE`,
          [req.auth.userId, hashRecoveryCode(backupCode!)],
        );
        if (!recovery.length) throw new UnauthorizedException({ code: 'MFA_FRESH_PROOF_INVALID' });
        await client.query(
          `UPDATE mfa_recovery_codes SET consumed_at=now() WHERE id=$1`,
          [recovery[0].id],
        );
      }
      await client.query(
        `UPDATE users SET mfa_totp_secret=NULL, mfa_totp_pending_secret=NULL,
         mfa_enabled_at=NULL, mfa_totp_last_step=-1 WHERE id=$1`,
        [req.auth.userId],
      );
      await client.query(
        `DELETE FROM mfa_recovery_codes WHERE user_id=$1`,
        [req.auth.userId],
      );
      await client.query(
        `UPDATE sessions SET revoked_at=now(), mfa_verified=false,
         mfa_verified_at=NULL
         WHERE user_id=$1 AND revoked_at IS NULL`,
        [req.auth.userId],
      );
      await client.query(
        `INSERT INTO auth_security_events(id,actor_user_id,org_id,session_id,event_type,outcome)
          VALUES($1,$2,$3,$4,'MFA_RESET_ALL_SESSIONS_REVOKED','SUCCESS')`,
        [uuidv7(), req.auth.userId, req.auth.activeOrgId, req.auth.sessionId],
      );
      return { enrolled: false, mfaVerified: false, reauthenticationRequired: true };
    });
    res.clearCookie('tc_session', {
      httpOnly: true, secure: isProductionEnvironment(), sameSite: 'lax', path: '/',
    });
    return result;
  }
}
