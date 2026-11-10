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
         FROM pg_roles m WHERE m.rolname='tc_migrator') AS can_assume_migrator,
      (SELECT pg_has_role(current_user, m.oid, 'MEMBER')
         FROM pg_roles m WHERE m.rolname='tc_external_authority_reviewer')
        AS can_approve_external_authority
       FROM pg_roles r WHERE r.rolname=current_user`,
  );
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls ||
      role.can_assume_migrator || role.can_approve_external_authority ||
      ['postgres','tc_migrator','tc_external_authority_reviewer'].includes(String(role.role_name))) {
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
  details: {
    subject?: string; userId?: string; orgId?: string; sessionId?: string;
    reasonCode?: string; sourceIp?: string;
  } = {},
): Promise<void> {
  const key = process.env.AUTH_OTP_HMAC_KEY;
  if (isProductionEnvironment() && (!key || key.length < 32)) {
    throw new Error('AUTH_EVENT_HMAC_KEY_UNAVAILABLE');
  }
  const digest = (purpose: string, raw: string) =>
    (key ? createHmac('sha256', key) : createHash('sha256'))
      .update(`auth-event:${purpose}:v1:${raw}`).digest('hex');
  const subjectDigest = details.subject ? digest('subject',details.subject) : null;
  const sourceDigest = details.sourceIp ? digest('source',details.sourceIp) : null;
  // Only known application-generated reason codes reach the ledger; opaque
  // exception messages and incoming HTTP fields can never become reason text.
  const reasonCode = details.reasonCode && /^[A-Z][A-Z0-9_]{0,63}$/.test(details.reasonCode)
    ? details.reasonCode : null;
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(eventType)) {
    throw new Error('AUTH_EVENT_TYPE_INVALID');
  }
  await pool.query(
    `INSERT INTO auth_security_events
      (id, actor_user_id, org_id, session_id, event_type, outcome,
       subject_digest, reason_code, source_digest)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [details.userId || null, details.orgId || null, details.sessionId || null,
      eventType, outcome, subjectDigest, reasonCode, sourceDigest],
  );
}

/**
 * G01-R3: an authentication denial is never a permit to perform unbounded
 * logging. Each replica uses the SAME PostgreSQL reservation ledger under the
 * restricted tc_app role. Both source and global caps are atomic and the
 * append-only event is inserted in that SAME statement. Saturated sources
 * cannot consume further global slots. Different application processes therefore
 * share the same counters without relying on local memory or Redis availability.
 *
 * Caps per 60-second database-time window:
 *   anonymous/session denial: 10/source and 60/event-type globally;
 *   privileged MFA denial: 20/source and 120/event-type globally;
 *   already-throttled MFA: 1/source and 30/event-type globally.
 * This is bounded forensic sampling, NOT an auth rate limiter. Authentication
 * budgets, critical successful MFA/revocation events, and original denial
 * decisions do not depend on audit sampling.
 */
const AUTH_DENIAL_QUERY_TIMEOUT_MS = 750;
const AUTH_DENIAL_TOTAL_WAIT_MS = 1_000;
const AUTH_DENIAL_DIAGNOSTIC_WINDOW_MS = 60_000;
let lastAuthDenialDiagnosticAt = Number.NEGATIVE_INFINITY;

/** Fixed single-line diagnostics are capped to one per minute per replica. */
function reportAuthDenialPersistenceFailure(): void {
  const now = Date.now();
  if (now - lastAuthDenialDiagnosticAt < AUTH_DENIAL_DIAGNOSTIC_WINDOW_MS) return;
  lastAuthDenialDiagnosticAt = now;
  // No exception string, HTTP request data, raw source or credentials.
  console.error('AUTH_SECURITY_EVENT_PERSISTENCE_FAILURE');
}

/**
 * Persist the sampled denial independently after the protected operation's
 * rollback. Database query_timeout bounds each query (750 ms); a failed,
 * unavailable or timed-out event store is best-effort and NEVER authorizes the
 * denied request. During a full database outage there is no reliable shared
 * sampling coordinator: only the fixed, per-replica diagnostic cap applies.
 * The exact denial is rethrown by the MFA handler/session guard.
 */
export async function recordDeniedAuthenticationEvent(
  pool: Pool, eventType: string,
  details: {userId?: string;orgId?: string;sessionId?: string;
    reasonCode: string;sourceIp?: string;subject?: string},
): Promise<void> {
  try {
    const secret = process.env.AUTH_OTP_HMAC_KEY;
    if (isProductionEnvironment() && (!secret || secret.length < 32)) {
      throw new Error('AUTH_EVENT_HMAC_KEY_UNAVAILABLE');
    }
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(eventType) ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(details.reasonCode)) {
      throw new Error('AUTH_DENIAL_EVENT_METADATA_INVALID');
    }
    const digest = (purpose: string, raw: string) =>
      (secret ? createHmac('sha256', secret) : createHash('sha256'))
        .update(`auth-event:${purpose}:v1:${raw}`).digest('hex');
    const isMfa = eventType.startsWith('MFA_');
    const throttled = details.reasonCode === 'RATE_LIMITED';
    const sourceLimit = throttled ? 1 : isMfa ? 20 : 10;
    const globalLimit = throttled ? 30 : isMfa ? 120 : 60;
    // A verified principal cannot switch IP to evade its per-actor cap.
    // Anonymous denials are keyed by the trusted remote IP, never the
    // user-supplied authorization header or an email/phone identifier.
    const source = details.userId
      ? `actor:${details.userId}` : `network:${details.sourceIp || 'unknown'}`;
    const sourceKey = 'audit-denied:source:' + digest('denial-budget',
      `${eventType}:${details.reasonCode}:${source}`);
    const globalKey = 'audit-denied:global:' + digest('denial-budget',
      `${eventType}:${details.reasonCode}`);
    const sourceDigest = details.sourceIp ? digest('source',details.sourceIp) : null;
    const subjectDigest = details.subject ? digest('subject',details.subject) : null;
    // DB clock defines the common window, and expired buckets are reused.
    // Conditional UPSERTs never increment a saturated counter or insert an
    // extra event. The event and both reservations succeed or roll back
    // together, even across simultaneous callers from different API nodes.
    const eventWrite = pool.query({
      text: `WITH tick AS (
        SELECT statement_timestamp() AS at
      ), global_saturated AS (
        -- Avoid creating source reservations once the global event budget
        -- has reached its cap (including an attacker rotating IP addresses).
        -- Final admission still uses atomic UPSERT under a row lock.
        SELECT 1 FROM auth_request_budgets
         WHERE budget_key=$3 AND count >= $4
           AND expires_at>statement_timestamp()
      ), source_slot AS (
        INSERT INTO auth_request_budgets (budget_key,count,expires_at)
        SELECT $1,1, date_trunc('minute',at)+interval '1 minute'
          FROM tick WHERE NOT EXISTS (SELECT 1 FROM global_saturated)
        ON CONFLICT (budget_key) DO UPDATE
          SET count=CASE WHEN auth_request_budgets.expires_at<=statement_timestamp()
                         THEN 1 ELSE auth_request_budgets.count+1 END,
              expires_at=CASE WHEN auth_request_budgets.expires_at<=statement_timestamp()
                              THEN date_trunc('minute',statement_timestamp())+interval '1 minute'
                              ELSE auth_request_budgets.expires_at END,
              updated_at=statement_timestamp()
          WHERE auth_request_budgets.expires_at<=statement_timestamp()
             OR auth_request_budgets.count<$2
        RETURNING budget_key
      ), global_slot AS (
        INSERT INTO auth_request_budgets (budget_key,count,expires_at)
        SELECT $3,1,date_trunc('minute',at)+interval '1 minute'
          FROM tick WHERE EXISTS (SELECT 1 FROM source_slot)
        ON CONFLICT (budget_key) DO UPDATE
          SET count=CASE WHEN auth_request_budgets.expires_at<=statement_timestamp()
                         THEN 1 ELSE auth_request_budgets.count+1 END,
              expires_at=CASE WHEN auth_request_budgets.expires_at<=statement_timestamp()
                              THEN date_trunc('minute',statement_timestamp())+interval '1 minute'
                              ELSE auth_request_budgets.expires_at END,
              updated_at=statement_timestamp()
          WHERE auth_request_budgets.expires_at<=statement_timestamp()
             OR auth_request_budgets.count<$4
        RETURNING budget_key
      )
      INSERT INTO auth_security_events
        (id,actor_user_id,org_id,session_id,event_type,outcome,
         subject_digest,reason_code,source_digest)
      SELECT gen_random_uuid(),$5,$6,$7,$8,'DENIED',$9,$10,$11
        FROM global_slot`,
      values: [sourceKey,sourceLimit,globalKey,globalLimit,
        details.userId || null,details.orgId || null,details.sessionId || null,
        eventType,subjectDigest,details.reasonCode,sourceDigest],
      query_timeout: AUTH_DENIAL_QUERY_TIMEOUT_MS,
    });
    // pool.query's query_timeout can start only after pool checkout. Bound
    // queueing as well; the pg query timeout still cancels an active query.
    // A late result is observed by Promise.race and cannot change a decision.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        eventWrite,
        new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>reject(new Error('AUTH_DENIAL_EVENT_STORE_TIMEOUT')),
            AUTH_DENIAL_TOTAL_WAIT_MS);
        }),
      ]);
    } finally {
      if(timer)clearTimeout(timer);
    }
  } catch {
    reportAuthDenialPersistenceFailure();
  }
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
