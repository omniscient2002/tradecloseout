import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  auth: {
    sessionId: string;
    userId: string;
    userName: string;
    activeOrgId: string;
    orgRole: string;
    requestId: string;
    ip: string;
    userAgent: string;
    authGeneration: string;
    mfaVerified: boolean;
  };
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class SessionCsrfGuard implements CanActivate {
  constructor(private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawSessionToken =
      req.cookies?.['tc_session'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!rawSessionToken || typeof rawSessionToken !== 'string') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        title: 'Authentication required',
        detail: 'No active session cookie found.',
      });
    }

    const tokenHash = createHash('sha256').update(rawSessionToken).digest('hex');

    // 1. Lookup session on global tables (sessions, users, organisations)
    const { rows: sessionRows } = await this.pool.query(
      `SELECT s.id AS session_id,
              s.user_id,
              s.active_org_id,
              s.csrf_token_hash,
              s.expires_at,
              s.absolute_expires_at,
              s.last_activity_at,
              s.guest_grant_id,
              s.auth_generation,
              s.mfa_verified,
              s.mfa_verified_at,
              u.name AS user_name,
              u.status AS user_status,
              o.status AS org_status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organisations o ON o.id = s.active_org_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
        LIMIT 1`,
      [tokenHash],
    );

    if (sessionRows.length === 0) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        title: 'Session invalid or revoked',
        detail: 'Please sign in again.',
      });
    }

    const session = sessionRows[0];

    let orgRole = 'R-OWNER';
    let membershipStatus = 'ACTIVE';
    let guestCapabilities: string[] | undefined = undefined;
    let guestScope: any = undefined;
    let guestProjectId: string | undefined = undefined;
    let guestAuthorityVerified = false;

    if (session.guest_grant_id) {
      const client = await this.pool.connect();
      let gRows: any[];
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [session.active_org_id]);
        const result = await client.query(
          `SELECT project_id, role, capabilities, scope_json, status, expires_at,
                  principal_user_id, independent_authority_verified_at
             FROM guest_grants
            WHERE id = $1 AND org_id = $2
            LIMIT 1`,
          [session.guest_grant_id, session.active_org_id],
        );
        gRows = result.rows;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      if (
        gRows.length === 0 ||
        gRows[0].status !== 'ACTIVE' ||
        new Date(gRows[0].expires_at).getTime() <= Date.now()
      ) {
        throw new UnauthorizedException({
          code: 'GUEST_GRANT_EXPIRED',
          title: 'Guest link expired or revoked',
          detail: 'Your external guest grant is no longer active.',
        });
      }
      if (!gRows[0].principal_user_id || gRows[0].principal_user_id !== session.user_id) {
        throw new UnauthorizedException({
          code: 'GUEST_PRINCIPAL_INVALID',
          detail: 'An external guest must sign in using its own verified principal.',
        });
      }
      guestAuthorityVerified = Boolean(gRows[0].independent_authority_verified_at);
      orgRole = 'GUEST';
      guestCapabilities = gRows[0].capabilities;
      guestScope = gRows[0].scope_json;
      guestProjectId = gRows[0].project_id;
    } else {
      // 2. Query memberships with tenant RLS context set (FR-IAM-007, AUD-014)
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [session.active_org_id]);
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [session.user_id]);

        const { rows: mRows } = await client.query(
          `SELECT role AS org_role, status AS membership_status
             FROM memberships
            WHERE org_id = $1 AND user_id = $2
            LIMIT 1`,
          [session.active_org_id, session.user_id],
        );
        await client.query('COMMIT');

        if (mRows.length === 0) {
          throw new UnauthorizedException({
            code: 'SESSION_EXPIRED',
            title: 'Session invalid or membership revoked',
            detail: 'No active membership found in target organisation.',
          });
        }

        orgRole = mRows[0].org_role;
        membershipStatus = mRows[0].membership_status;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (
      new Date(session.expires_at).getTime() <= Date.now() ||
      new Date(session.absolute_expires_at).getTime() <= Date.now() ||
      (!session.guest_grant_id &&
        new Date(session.last_activity_at).getTime() <= Date.now() - 30 * 24 * 3600 * 1000) ||
      session.user_status !== 'ACTIVE' ||
      membershipStatus !== 'ACTIVE' ||
      session.org_status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        title: 'Session expired or membership suspended',
        detail: 'Your session has expired or your organisation access has changed.',
      });
    }

    // A shared HttpOnly cookie can change in another tab. Require a generation
    // pinned to the UI's last verified auth context for every mutating request
    // in production; stale form/tenant state may NOT be silently submitted.
    if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
      const suppliedGeneration = req.headers['x-auth-generation'];
      const currentGeneration = String(session.auth_generation);
      if ((typeof suppliedGeneration === 'string' && suppliedGeneration !== currentGeneration) ||
          ((process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
           req.cookies?.tc_session && typeof suppliedGeneration !== 'string')) {
        throw new ConflictException({
          code: 'AUTH_CONTEXT_CHANGED',
          detail: 'Authentication or organisation context changed; refresh before changing data.',
        });
      }
    }

    // Enforce CSRF token on all state-changing cookie requests (10 §2.2)
    if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || typeof csrfHeader !== 'string') {
        throw new ForbiddenException({
          code: 'CSRF_TOKEN_MISSING',
          title: 'CSRF token required',
          detail: 'Unsafe cookie-authenticated requests require the X-CSRF-Token header.',
        });
      }
      const providedCsrfHash = createHash('sha256').update(csrfHeader).digest('hex');
      const expectedBuf = Buffer.from(session.csrf_token_hash, 'hex');
      const providedBuf = Buffer.from(providedCsrfHash, 'hex');

      if (
        expectedBuf.length !== providedBuf.length ||
        !timingSafeEqual(expectedBuf, providedBuf)
      ) {
        throw new ForbiddenException({
          code: 'CSRF_TOKEN_INVALID',
          title: 'Invalid CSRF token',
          detail: 'CSRF token verification failed.',
        });
      }
    }

    // Owners/Admins must complete a recent, server-verified second factor
    // before performing privileged mutations. Enrollment, MFA verification
    // and emergency revocation remain reachable when a factor is not yet set.
    const needsPrivilegedMfa = (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
      !session.guest_grant_id &&
      (orgRole === 'R-OWNER' || orgRole === 'R-ADMIN') &&
      // An owner may read basic login/bootstrap information before MFA, but
      // tenant project or billing reads are privileged as well as writes.
      !String(req.path || '').startsWith('/api/v1/auth/');
    if (needsPrivilegedMfa &&
        (!session.mfa_verified || !session.mfa_verified_at ||
         new Date(session.mfa_verified_at).getTime() < Date.now() - 12 * 3600_000)) {
      throw new ForbiddenException({
        code: 'MFA_STEP_UP_REQUIRED',
        detail: 'Complete multi-factor verification before privileged changes.',
      });
    }

    // AUD-014 Invariant: Path :orgId is NEVER authoritative; mismatch returns 404 (not 403)
    // Resolve alias 'current' to the authenticated session active organisation
    if (req.params?.orgId === 'current' && session.active_org_id) {
      req.params.orgId = session.active_org_id;
    }

    const pathOrgId = req.params?.orgId;
    if (pathOrgId && pathOrgId !== session.active_org_id) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Resource not found',
        detail: 'The requested organisation resource was not found in your active scope.',
      });
    }

    let projectRole: string | undefined = undefined;
    const targetProjectId =
      req.params?.projectId ||
      (req.path?.startsWith('/api/v1/projects/') ? req.params?.id : undefined);

    if (targetProjectId && session.user_id && session.active_org_id && !session.guest_grant_id) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [session.active_org_id]);
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [session.user_id]);
        const pmRes = await client.query(
          `SELECT pm.role
             FROM project_members pm
             JOIN projects p ON p.id = pm.project_id AND p.org_id = pm.org_id
            WHERE pm.org_id = $1 AND pm.project_id = $2 AND pm.user_id = $3
              AND pm.status = 'ACTIVE'
            LIMIT 1`,
          [session.active_org_id, targetProjectId, session.user_id],
        );
        projectRole = pmRes.rows[0]?.role;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new ForbiddenException({
          code: 'PROJECT_AUTHORITY_LOOKUP_FAILED',
          title: 'Project access could not be verified',
          detail: 'The request was denied because active project membership could not be established.',
        });
      } finally {
        client.release();
      }
    }

    const authData = {
      sessionId: session.session_id,
      userId: session.user_id,
      userName: session.user_name,
      activeOrgId: session.active_org_id,
      orgRole: orgRole,
      projectRole: projectRole,
      requestId: (req.headers['x-request-id'] as string) || 'req_unknown',
      ip: req.ip || '0.0.0.0',
      userAgent: (req.headers['user-agent'] as string) || 'unknown',
      authGeneration: String(session.auth_generation),
      mfaVerified: Boolean(session.mfa_verified && session.mfa_verified_at &&
        new Date(session.mfa_verified_at).getTime() >= Date.now() - 12 * 3600_000),
    };

    req.auth = authData;

    (req as any).user = {
      userId: session.user_id,
      name: session.user_name,
      orgId: session.active_org_id,
      orgRole: orgRole,
      projectRole: projectRole,
      guestCapabilities: guestCapabilities,
      guestScope: guestScope,
      guestGrantId: session.guest_grant_id,
      guestProjectId: guestProjectId,
      guestAuthorityVerified,
      docControllerOrgWideDownload: false,
    };

    (req as any).userContext = {
      orgId: session.active_org_id,
      userId: session.user_id,
      actorType: session.guest_grant_id ? 'GUEST' : 'USER',
      requestId: authData.requestId,
      orgRole,
      projectRole,
      guestGrantId: session.guest_grant_id || undefined,
      guestAuthorityVerified,
      guestProjectId: guestProjectId,
      guestScope,
      guestCapabilities,
    };

    // Sliding expiry is earned ONLY after authentication, CSRF, current
    // generation, MFA and resource-scope checks have all succeeded. Previously,
    // a failed request with a stolen cookie could keep the session alive.
    // Optimistic token+generation predicates prevent an old-tab GET from
    // renewing a different session after a credential rotation.
    if (!session.guest_grant_id &&
        new Date(session.last_activity_at).getTime() < Date.now() - 5 * 60_000) {
      const { rowCount } = await this.pool.query(
        `UPDATE sessions
            SET last_activity_at = now(),
                expires_at = LEAST(now() + interval '30 days', absolute_expires_at)
          WHERE id = $1 AND token_hash = $2 AND auth_generation = $3
            AND revoked_at IS NULL AND expires_at > now()
            AND absolute_expires_at > now()
            AND last_activity_at > now() - interval '30 days'`,
        [session.session_id, tokenHash, String(session.auth_generation)],
      );
      if (!rowCount) throw new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    }

    return true;
  }
}
