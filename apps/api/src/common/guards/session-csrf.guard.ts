import {
  CanActivate,
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

    // 2. Query memberships with tenant RLS context set (FR-IAM-007, AUD-014)
    const client = await this.pool.connect();
    let orgRole = 'R-OWNER';
    let membershipStatus = 'ACTIVE';
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_org', $1, true)`, [session.active_org_id]);
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

    if (
      new Date(session.expires_at).getTime() <= Date.now() ||
      session.user_status !== 'ACTIVE' ||
      membershipStatus !== 'ACTIVE' ||
      session.org_status === 'DELETED'
    ) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        title: 'Session expired or membership suspended',
        detail: 'Your session has expired or your organisation access has changed.',
      });
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

    // AUD-014 Invariant: Path :orgId is NEVER authoritative; mismatch returns 404 (not 403)
    const pathOrgId = req.params?.orgId;
    if (pathOrgId && pathOrgId !== session.active_org_id) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Resource not found',
        detail: 'The requested organisation resource was not found in your active scope.',
      });
    }

    const authData = {
      sessionId: session.session_id,
      userId: session.user_id,
      userName: session.user_name,
      activeOrgId: session.active_org_id,
      orgRole: orgRole,
      requestId: (req.headers['x-request-id'] as string) || 'req_unknown',
      ip: req.ip || '0.0.0.0',
      userAgent: (req.headers['user-agent'] as string) || 'unknown',
    };

    req.auth = authData;

    (req as any).user = {
      userId: session.user_id,
      name: session.user_name,
      orgId: session.active_org_id,
      orgRole: orgRole,
      docControllerOrgWideDownload: false,
    };

    (req as any).userContext = {
      orgId: session.active_org_id,
      userId: session.user_id,
      actorType: 'USER',
      requestId: authData.requestId,
    };

    return true;
  }
}
