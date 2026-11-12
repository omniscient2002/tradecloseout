import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService } from '../../database/tenant-db.service';
import {
  decryptFactor, encryptFactor, hashRecoveryCode, hashRecoveryCodeCandidates,
  newRecoveryCodes, newTotpSecret, verifyTotp,
} from './mfa-crypto';

/**
 * Only pass a cookie-authenticated, SERVER-verified session ID and SHA-256
 * hash of its opaque token. Never pass the raw token or trust these fields
 * from a client DTO. The final HTTP MFA controller must additionally enforce
 * CSRF, distributed MFA attempt budgets and post-confirm session rotation.
 */
export interface MfaEnrollmentSession {
  userId: string;
  activeOrgId: string;
  sessionId: string;
  sessionTokenHash: string;
}
export interface MfaEnrollmentProposal {
  proposalId: string;
  manualSetupKey: string; // One-time secret, NEVER log or persist plaintext.
  expiresAt: string;
}

export function isMfaProposalId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export interface MfaConfirmedEnrollment {
  recoveryCodes: string[]; // Shown exactly once; never written to a receipt.
  newSessionToken: string; // Must become a Secure, HttpOnly session cookie.
  csrfToken: string; // Must replace the old CSRF token in the browser.
  confirmed: true;
}

const proposalDenied = (): never => {
  // Do not reveal whether an expired, superseded, cancelled or other user's
  // enrollment existed. Never echo a factor or session token in errors.
  throw new ConflictException({ code: 'MFA_ENROLLMENT_NOT_PENDING' });
};

/**
 * Provider-independent MFA enrollment persistence / verification contract.
 *
 * This store is intentionally not an HTTP route. The authenticated MFA
 * controller and privileged route enforcement must be integrated and accepted
 * before the enrollment workflow is available to end users.
 */
export class MfaEnrollmentStore {
  constructor(private readonly db: TenantDbService) {}

  private assertContext(ctx: MfaEnrollmentSession): void {
    if (!ctx || typeof ctx.userId !== 'string' || !ctx.userId ||
        typeof ctx.activeOrgId !== 'string' || !ctx.activeOrgId ||
        typeof ctx.sessionId !== 'string' || !ctx.sessionId ||
        typeof ctx.sessionTokenHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(ctx.sessionTokenHash)) {
      throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
    }
  }

  private async lockAccountAndSession(
    client: PoolClient,
    ctx: MfaEnrollmentSession,
  ): Promise<{ mfa_totp_secret: string | null; mfa_enabled_at: string | null; mfa_totp_last_step: string | number }> {
    // Same lock order for start/confirm/cancel: account -> session -> proposal.
    // A factor change and an offboarding event cannot race these writes.
    const { rows: accounts } = await client.query(
      `SELECT mfa_totp_secret,mfa_enabled_at,mfa_totp_last_step
         FROM users WHERE id=$1 AND status='ACTIVE' FOR NO KEY UPDATE`,
      [ctx.userId],
    );
    if (accounts.length !== 1) {
      throw new UnauthorizedException({ code: 'ACCOUNT_UNAVAILABLE' });
    }
    // The supplied org must be the authenticated session's current org,
    // not just a project ID copied into a client-supplied payload.
    await client.query(
      "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
      [ctx.activeOrgId],
    );
    const { rows: sessions } = await client.query(
      `SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND token_hash=$3
         AND active_org_id=$4 AND guest_grant_id IS NULL
         AND revoked_at IS NULL AND expires_at>now()
         FOR SHARE`,
      [ctx.sessionId, ctx.userId, ctx.sessionTokenHash, ctx.activeOrgId],
    );
    if (sessions.length !== 1) {
      throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
    }
    const { rows: orgs } = await client.query(
      "SELECT id FROM organisations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [ctx.activeOrgId],
    );
    if (orgs.length !== 1) {
      throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
    }
    const { rows: memberships } = await client.query(
      `SELECT id FROM memberships WHERE org_id=$1 AND user_id=$2
        AND status='ACTIVE' FOR SHARE`,
      [ctx.activeOrgId, ctx.userId],
    );
    if (memberships.length !== 1) {
      throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
    }
    return accounts[0];
  }

  private async rotateCurrentSession(
    client: PoolClient,
    ctx: MfaEnrollmentSession,
    revokeOtherDevices = false,
  ): Promise<{ newSessionToken: string; csrfToken: string }> {
    const newSessionToken = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(24).toString('hex');
    const replaced = await client.query(
      `UPDATE sessions
          SET token_hash=$4, csrf_token_hash=$5, mfa_verified=true
        WHERE id=$1 AND user_id=$2 AND token_hash=$3 AND active_org_id=$6
          AND guest_grant_id IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      [
        ctx.sessionId, ctx.userId, ctx.sessionTokenHash,
        createHash('sha256').update(newSessionToken).digest('hex'),
        createHash('sha256').update(csrfToken).digest('hex'),
        ctx.activeOrgId,
      ],
    );
    if (replaced.rowCount !== 1) {
      throw new UnauthorizedException({ code: 'SESSION_CONTEXT_CHANGED' });
    }
    // First enrollment invalidates old devices. Subsequent MFA verification
    // must NOT unexpectedly log out unrelated devices.
    if (revokeOtherDevices) {
      await client.query(
        `UPDATE sessions SET revoked_at=now(), mfa_verified=false
          WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
        [ctx.userId, ctx.sessionId],
      );
    }
    return { newSessionToken, csrfToken };
  }

  async begin(ctx: MfaEnrollmentSession): Promise<MfaEnrollmentProposal> {
    this.assertContext(ctx);
    return this.db.withUserContext(ctx.userId, async client => {
      const account = await this.lockAccountAndSession(client, ctx);
      if (account.mfa_enabled_at || account.mfa_totp_secret) {
        throw new ConflictException({ code: 'MFA_ALREADY_ENROLLED' });
      }
      const secret = newTotpSecret();
      const encryptedSecret = encryptFactor(secret);
      // Replace ALL previous pending proposals in the same account lock. The
      // unique PENDING index adds a database-level fail-closed backstop.
      await client.query(
        `UPDATE mfa_enrollment_proposals
            SET status='REPLACED', encrypted_secret=NULL, completed_at=now()
          WHERE user_id=$1 AND status='PENDING'`,
        [ctx.userId],
      );
      const proposalId = uuidv7();
      const { rows } = await client.query(
        `INSERT INTO mfa_enrollment_proposals
          (id,user_id,session_id,session_token_hash,encrypted_secret,expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')
         RETURNING expires_at`,
        [proposalId, ctx.userId, ctx.sessionId,
          ctx.sessionTokenHash, encryptedSecret],
      );
      if (rows.length !== 1) throw new Error('MFA_ENROLLMENT_WRITE_LOST');
      return {
        proposalId,
        manualSetupKey: secret,
        expiresAt: new Date(rows[0].expires_at).toISOString(),
      };
    });
  }

  async confirm(
    ctx: MfaEnrollmentSession,
    proposalId: string,
    code: string,
  ): Promise<MfaConfirmedEnrollment> {
    this.assertContext(ctx);
    if (!/^[0-9]{6}$/.test(code) || !isMfaProposalId(proposalId)) {
      throw new ForbiddenException({ code: 'MFA_CODE_INVALID' });
    }
    return this.db.withUserContext(ctx.userId, async client => {
      const account = await this.lockAccountAndSession(client, ctx);
      if (account.mfa_enabled_at || account.mfa_totp_secret) {
        throw new ConflictException({ code: 'MFA_ALREADY_ENROLLED' });
      }
      const { rows } = await client.query(
        `SELECT encrypted_secret FROM mfa_enrollment_proposals
          WHERE id=$1 AND user_id=$2 AND session_id=$3
            AND session_token_hash=$4
            AND status='PENDING' AND expires_at>now()
          FOR UPDATE`,
        [proposalId, ctx.userId, ctx.sessionId, ctx.sessionTokenHash],
      );
      if (rows.length !== 1 || typeof rows[0].encrypted_secret !== 'string') {
        proposalDenied();
      }
      const plaintext = decryptFactor(rows[0].encrypted_secret);
      const step = verifyTotp(plaintext, code, Number(account.mfa_totp_last_step));
      if (step === null) throw new UnauthorizedException({ code: 'MFA_CODE_INVALID_OR_REPLAYED' });

      const update = await client.query(
        `UPDATE users SET mfa_totp_secret=$2, mfa_enabled_at=now(),
                mfa_totp_last_step=$3
          WHERE id=$1 AND mfa_totp_secret IS NULL AND mfa_enabled_at IS NULL`,
        [ctx.userId, encryptFactor(plaintext), step],
      );
      if (update.rowCount !== 1) proposalDenied();
      const recoveryCodes = newRecoveryCodes();
      for (const code of recoveryCodes) {
        await client.query(
          `INSERT INTO mfa_recovery_codes(id,user_id,code_hash)
           VALUES($1,$2,$3)`,
          [uuidv7(), ctx.userId, hashRecoveryCode(code)],
        );
      }
      const marked = await client.query(
        `UPDATE mfa_enrollment_proposals
            SET status='CONFIRMED', encrypted_secret=NULL, completed_at=now()
          WHERE id=$1 AND user_id=$2 AND status='PENDING'`,
        [proposalId, ctx.userId],
      );
      if (marked.rowCount !== 1) proposalDenied();

      // Rotate token and CSRF in the SAME transaction as factor activation.
      // The HTTP integration must atomically set the returned HttpOnly cookie
      // and deliver the new CSRF token, without generic idempotency receipts.
      const newSession = await this.rotateCurrentSession(client, ctx, true);
      return { confirmed: true as const, recoveryCodes, ...newSession };
    });
  }

  /**
   * Verify an already-enrolled factor. The successful TOTP step is committed
   * before rotation, so the same factor code cannot be replayed on any device.
   * Successful old-key decrypts are re-encrypted with the current key.
   *
   * Caller MUST reserve a durable distributed attempt budget BEFORE invoking
   * this low-level operation; it intentionally exposes no HTTP route.
   */
  async verifyFactor(ctx: MfaEnrollmentSession, code: string): Promise<{
    newSessionToken: string; csrfToken: string; mfaVerified: true;
  }> {
    this.assertContext(ctx);
    if (!/^[0-9]{6}$/.test(code)) {
      throw new ForbiddenException({ code: 'MFA_CODE_INVALID' });
    }
    return this.db.withUserContext(ctx.userId, async client => {
      const account = await this.lockAccountAndSession(client, ctx);
      if (!account.mfa_enabled_at || !account.mfa_totp_secret) {
        throw new ConflictException({ code: 'MFA_NOT_ENROLLED' });
      }
      const plaintext = decryptFactor(account.mfa_totp_secret);
      const step = verifyTotp(plaintext, code, Number(account.mfa_totp_last_step));
      if (step === null) {
        throw new UnauthorizedException({ code: 'MFA_CODE_INVALID_OR_REPLAYED' });
      }
      const update = await client.query(
        `UPDATE users
            SET mfa_totp_secret=$2, mfa_totp_last_step=$3
          WHERE id=$1 AND mfa_enabled_at IS NOT NULL`,
        [ctx.userId, encryptFactor(plaintext), step],
      );
      if (update.rowCount !== 1) throw new UnauthorizedException({ code: 'ACCOUNT_UNAVAILABLE' });
      const creds = await this.rotateCurrentSession(client, ctx);
      return { ...creds, mfaVerified: true as const };
    });
  }

  /**
   * Consume a single recovery code once under row locks, then rotate the
   * authenticated session. Expired old-key HMACs are never considered.
   * Rate limiting and emergency-recovery supervision are separate gates.
   */
  async useRecoveryCode(ctx: MfaEnrollmentSession, code: string): Promise<{
    newSessionToken: string; csrfToken: string; mfaVerified: true;
  }> {
    this.assertContext(ctx);
    if (typeof code !== 'string' || !/^[0-9A-Fa-f]{24}$/.test(code)) {
      throw new ForbiddenException({ code: 'RECOVERY_CODE_INVALID' });
    }
    return this.db.withUserContext(ctx.userId, async client => {
      const account = await this.lockAccountAndSession(client, ctx);
      if (!account.mfa_enabled_at || !account.mfa_totp_secret) {
        throw new ConflictException({ code: 'MFA_NOT_ENROLLED' });
      }
      const digests = hashRecoveryCodeCandidates(code);
      const { rows } = await client.query(
        `SELECT id FROM mfa_recovery_codes
           WHERE user_id=$1 AND code_hash=ANY($2::text[])
             AND consumed_at IS NULL FOR UPDATE`,
        [ctx.userId, digests],
      );
      if (rows.length !== 1) {
        throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID' });
      }
      const result = await client.query(
        `UPDATE mfa_recovery_codes SET consumed_at=now()
           WHERE id=$1 AND consumed_at IS NULL`,
        [rows[0].id],
      );
      if (result.rowCount !== 1) {
        throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID' });
      }
      const creds = await this.rotateCurrentSession(client, ctx);
      return { ...creds, mfaVerified: true as const };
    });
  }

  async cancel(ctx: MfaEnrollmentSession, proposalId: string): Promise<void> {
    this.assertContext(ctx);
    if (!isMfaProposalId(proposalId)) proposalDenied();
    return this.db.withUserContext(ctx.userId, async client => {
      await this.lockAccountAndSession(client, ctx);
      const update = await client.query(
        `UPDATE mfa_enrollment_proposals
            SET status='CANCELLED', encrypted_secret=NULL, completed_at=now()
          WHERE id=$1 AND user_id=$2 AND session_id=$3
            AND session_token_hash=$4 AND status='PENDING'`,
        [proposalId, ctx.userId, ctx.sessionId, ctx.sessionTokenHash],
      );
      if (update.rowCount !== 1) proposalDenied();
    });
  }
}
