import { ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { HttpException, HttpStatus } from '@nestjs/common';
import { isIP } from 'node:net';

export const isProductionEnvironment = () =>
  process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

const parseConfiguredUrl = (value: string, errorCode: string): URL => {
  try {
    return new URL(value);
  } catch {
    // Node URL errors may include the raw input, which can contain secrets.
    throw new Error(errorCode);
  }
};

const requiredOrigin = (value: string): string => {
  const url = parseConfiguredUrl(value, 'BOOT_AUTH_ORIGIN_INVALID');
  if (!['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) {
    throw new Error('BOOT_AUTH_ORIGIN_INVALID');
  }
  return url.origin;
};

const isTrustedProxyEntry = (entry: string): boolean => {
  if (entry === 'direct') return true;
  const parts = entry.split('/');
  if (parts.length > 2 || !parts[0]) return false;
  const family = isIP(parts[0]);
  if (!family) return false;
  if (parts.length === 1) return true;
  const limit = family === 4 ? 32 : 128;
  if (!/^\d+$/.test(parts[1])) return false;
  const bits = Number(parts[1]);
  return Number.isInteger(bits) && bits >= 1 && bits <= limit;
};

/**
 * Fail closed on an unknown NODE_ENV and every security-critical authentication
 * dependency. Never log actual credentials in startup failures.
 */
export function validateAuthenticationConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!['development', 'test', 'staging', 'production'].includes(env.NODE_ENV || '')) {
    throw new Error('BOOT_AUTH_ENV_INVALID: NODE_ENV must be explicit');
  }
  if (!['production', 'staging'].includes(env.NODE_ENV || '')) return;
  const missing = [
    'APP_DATABASE_URL', 'REDIS_URL', 'AUTH_OTP_HMAC_KEY', 'AUTH_CSRF_KEY', 'AUTH_MFA_ENCRYPTION_KEY', 'AUTH_TRUSTED_PROXY_CIDRS', 'FRONTEND_URL',
    'DLT_SMS_URL', 'DLT_SMS_API_KEY', 'DLT_SENDER_ID',
    'DLT_ENTITY_ID', 'DLT_OTP_TEMPLATE_ID',
    'MAIL_GATEWAY_URL', 'MAIL_FROM_ADDRESS',
  ].filter(k => !env[k]);
  if (missing.length) throw new Error(`BOOT_AUTH_CONFIG_MISSING: ${missing.join(', ')}`);
  if (!env.MAIL_API_KEY && !env.SENDGRID_API_KEY) {
    throw new Error('BOOT_AUTH_MAIL_CREDENTIAL_MISSING');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.MAIL_FROM_ADDRESS || '')) {
    throw new Error('BOOT_AUTH_MAIL_SENDER_INVALID');
  }
  if ((env.AUTH_OTP_HMAC_KEY || '').length < 32 || (env.AUTH_CSRF_KEY || '').length < 32) {
    throw new Error('BOOT_AUTH_KEY_TOO_SHORT');
  }
  // Reject invalid endpoints with a stable code, never logging credential URLs.
  for (const key of ['DLT_SMS_URL', 'MAIL_GATEWAY_URL']) {
    const endpoint = parseConfiguredUrl(env[key]!, `BOOT_AUTH_URL_INVALID: ${key}`);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
      throw new Error(`BOOT_AUTH_HTTPS_REQUIRED: ${key}`);
    }
  }
  const origin = requiredOrigin(env.FRONTEND_URL!);
  if (!origin.startsWith('https:')) {
    throw new Error('BOOT_AUTH_HTTPS_REQUIRED: FRONTEND_URL');
  }
  if (env.PUBLIC_APP_URL) {
    const publicOrigin = requiredOrigin(env.PUBLIC_APP_URL);
    if (!publicOrigin.startsWith('https:')) {
      throw new Error('BOOT_AUTH_HTTPS_REQUIRED: PUBLIC_APP_URL');
    }
  }
  const db = parseConfiguredUrl(env.APP_DATABASE_URL!, 'BOOT_AUTH_DATABASE_URL_INVALID');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname ||
      !db.username || ['postgres', 'tc_migrator'].includes(db.username) ||
      db.password.length < 12) {
    throw new Error('BOOT_AUTH_DATABASE_ROLE_INVALID');
  }
  if (Buffer.from(env.AUTH_MFA_ENCRYPTION_KEY || '', 'base64').length !== 32) {
    throw new Error('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
  }
  if (env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS &&
      (Buffer.from(env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS,'base64').length !== 32 ||
       env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS === env.AUTH_MFA_ENCRYPTION_KEY)) {
    throw new Error('BOOT_AUTH_MFA_PREVIOUS_ENCRYPTION_KEY_INVALID');
  }
  if (env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS) {
    const expires = env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT || '';
    const validTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires);
    const deadline = validTimestamp ? Date.parse(expires) : NaN;
    if (!Number.isFinite(deadline) || deadline <= Date.now() ||
        deadline > Date.now() + 30 * 24 * 60 * 60 * 1000) {
      throw new Error('BOOT_AUTH_MFA_PREVIOUS_KEY_EXPIRED_OR_UNBOUNDED');
    }
  }
  const proxies = (env.AUTH_TRUSTED_PROXY_CIDRS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!proxies.length || proxies.some(x =>
      !isTrustedProxyEntry(x) || ['0.0.0.0/0', '::/0'].includes(x))) {
    throw new Error('BOOT_AUTH_PROXY_SCOPE_INVALID');
  }
  if (env.ENABLE_DEBUG_OTP === 'true' || env.ENABLE_OUTBOX_DELIVERY === 'true') {
    throw new Error('BOOT_AUTH_DEBUG_MODE_DISABLED');
  }
}

/**
 * Validate privileges on the actual connected PostgreSQL session. A safe-looking
 * APP_DATABASE_URL is insufficient when the effective database role is superuser,
 * BYPASSRLS, or can SET ROLE tc_migrator.
 */
export async function assertRuntimeDatabasePrivileges(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls,
      (SELECT pg_has_role(current_user, m.oid, 'MEMBER')
         FROM pg_roles m WHERE m.rolname='tc_migrator') AS can_assume_migrator
       FROM pg_roles r WHERE r.rolname=current_user`,
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls ||
      role.can_assume_migrator ||
      ['postgres','tc_migrator'].includes(String(role.role_name))) {
    throw new Error('BOOT_AUTH_RUNTIME_ROLE_PRIVILEGED');
  }
}

/**
 * Origin and Fetch Metadata defense for cookie/session-creating routes.
 * CORS is not a login-CSRF defense: a browser may submit a cross-site request
 * even if it cannot read the response.
 */
export function assertAuthenticationOrigin(req: Pick<Request, 'headers'>): void {
  const origin = req.headers?.origin;
  const fetchSite = req.headers?.['sec-fetch-site'];
  if (fetchSite === 'cross-site') {
    throw new ForbiddenException({ code: 'LOGIN_CSRF_DENIED', detail: 'Cross-site login is not accepted.' });
  }
  const allowed = [process.env.FRONTEND_URL, process.env.PUBLIC_APP_URL]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => {
      try { return requiredOrigin(x); } catch { return ''; }
    }).filter((allowedOrigin) => Boolean(allowedOrigin) &&
      (!isProductionEnvironment() || allowedOrigin.startsWith('https:')));
  if (typeof origin === 'string') {
    if (!allowed.includes(origin)) {
      throw new ForbiddenException({ code: 'LOGIN_ORIGIN_DENIED', detail: 'Login requires an approved application origin.' });
    }
  } else if (isProductionEnvironment()) {
    throw new ForbiddenException({ code: 'LOGIN_ORIGIN_REQUIRED', detail: 'Login requires an origin-bound browser request.' });
  }
}

/**
 * Shared rate budgets live in Postgres, so Redis loss or multiple API nodes
 * cannot silently allow unbounded OTP sends. Keys are pseudonymized with
 * an external secret in production; raw contacts/IPs are not retained.
 */
export async function consumeAuthenticationBudget(
  pool: Pool, category: string, rawKey: string, limit: number, ttlSeconds: number,
): Promise<void> {
  const keySecret = process.env.AUTH_OTP_HMAC_KEY;
  const digest = keySecret
    ? createHmac('sha256', keySecret).update(`${category}:${rawKey}`).digest('hex')
    : createHash('sha256').update(`${category}:${rawKey}`).digest('hex');
  const budgetKey = `${category}:${digest}`;
  const { rows } = await pool.query(
    `INSERT INTO auth_request_budgets (budget_key, count, expires_at)
      VALUES ($1, 1, now() + ($2::int * interval '1 second'))
      ON CONFLICT (budget_key) DO UPDATE
         SET count = CASE
              WHEN auth_request_budgets.expires_at <= now() THEN 1
              ELSE auth_request_budgets.count + 1
            END,
             expires_at = CASE
              WHEN auth_request_budgets.expires_at <= now()
                THEN now() + ($2::int * interval '1 second')
              ELSE auth_request_budgets.expires_at
            END,
             updated_at = now()
      RETURNING count`,
    [budgetKey, ttlSeconds],
  );
  const observedCount = rows.length ? Number(rows[0].count) : Number.POSITIVE_INFINITY;
  if (observedCount > limit) {
    // Security-event writes are deliberately sampled under sustained abuse;
    // missing telemetry must not disable the already enforced budget.
    if (observedCount === limit + 1 || observedCount % 100 === 0) {
      await recordAuthenticationEvent(
        pool, 'AUTH_REQUEST_RATE_LIMITED', 'THROTTLED',
        { subject: `${category}:${rawKey}` },
      ).catch(() => {});
    }
    throw new HttpException({
      code: 'RATE_LIMITED',
      detail: 'Too many authentication attempts. Please retry later.',
      retryAfterSeconds: ttlSeconds,
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Deterministic but secret-derived CSRF for the CURRENT opaque cookie/session
 * generation. No raw CSRF secret is persisted in database or localStorage.
 * Same-origin bootstrap may safely restore this token after storage loss.
 */
export function deriveSessionCsrf(rawSessionToken: string, generation: string): string {
  const secret = process.env.AUTH_CSRF_KEY;
  if (isProductionEnvironment() && (!secret || secret.length < 32)) {
    throw new Error('AUTH_CSRF_KEY_UNAVAILABLE');
  }
  return createHmac('sha256', secret || 'development-only-csrf-key-not-for-production')
    .update(`csrf:v1:${generation}:${rawSessionToken}`).digest('hex');
}

/**
 * Durable, redacted authentication outcomes. Never retain an email, phone,
 * proof, raw bearer/OTP, guest invitation token or request headers.
 */
export async function recordAuthenticationEvent(
  pool: Pool,
  eventType: string,
  outcome: 'SUCCESS' | 'DENIED' | 'THROTTLED' | 'ERROR',
  details: { subject?: string; userId?: string; orgId?: string; sessionId?: string } = {},
): Promise<void> {
  const key = process.env.AUTH_OTP_HMAC_KEY;
  const subjectDigest = details.subject
    ? (key ? createHmac('sha256', key) : createHash('sha256'))
        .update('auth-event:v1:' + details.subject).digest('hex')
    : null;
  await pool.query(
    `INSERT INTO auth_security_events
      (id, actor_user_id, org_id, session_id, event_type, outcome, subject_digest)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
    [details.userId || null, details.orgId || null, details.sessionId || null,
      eventType, outcome, subjectDigest],
  );
}

export const AUTH_INTENT_COOKIE = 'tc_auth_intent';

export function hashAuthIntent(token: string): string {
  const secret = process.env.AUTH_OTP_HMAC_KEY;
  if (isProductionEnvironment() && (!secret || secret.length < 32)) {
    throw new Error('AUTH_INTENT_SECRET_UNAVAILABLE');
  }
  return (secret ? createHmac('sha256', secret) : createHash('sha256'))
    .update(`login-intent:v1:${token}`).digest('hex');
}

/** Issue a five-minute browser-bound nonce at OTP request, not at verification. */
export function setAuthenticationIntent(
  res?: Response,
  req?: { cookies?: Record<string, unknown> },
): string | null {
  if (!res) {
    if (isProductionEnvironment()) throw new Error('AUTH_INTENT_RESPONSE_UNAVAILABLE');
    return null;
  }
  // Parallel login tabs share the browser's pre-auth cookie. Reusing an
  // existing 5-minute intent avoids invalidating tab A when tab B asks for a
  // separate OTP, without making the proof transferable to another browser.
  const existing = req?.cookies?.[AUTH_INTENT_COOKIE];
  if (typeof existing === 'string' && /^[0-9a-f]{64}$/i.test(existing)) {
    return hashAuthIntent(existing);
  }
  const nonce = randomBytes(32).toString('hex');
  res.cookie(AUTH_INTENT_COOKIE, nonce, {
    httpOnly: true, secure: isProductionEnvironment(), sameSite: 'strict',
    path: '/', maxAge: 5 * 60 * 1000,
  });
  return hashAuthIntent(nonce);
}

export function assertAuthenticationIntent(req: any, expectedHash: string | null | undefined): void {
  const receivedToken = req?.cookies?.[AUTH_INTENT_COOKIE];
  if (isProductionEnvironment() && (!expectedHash || typeof receivedToken !== 'string')) {
    throw new ForbiddenException({ code: 'LOGIN_INTENT_MISSING' });
  }
  if (!expectedHash) return; // older test fixtures only; never accepted in production
  if (typeof receivedToken !== 'string' || receivedToken.length > 128) {
    throw new ForbiddenException({ code: 'LOGIN_INTENT_MISSING' });
  }
  const provided = Buffer.from(hashAuthIntent(receivedToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new ForbiddenException({ code: 'LOGIN_INTENT_MISMATCH' });
  }
}
