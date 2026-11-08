import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

export const isProductionEnvironment = () =>
  process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

const requiredOrigin = (value: string): string => {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('BOOT_AUTH_ORIGIN_INVALID');
  }
  return url.origin;
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
    'APP_DATABASE_URL', 'REDIS_URL', 'AUTH_OTP_HMAC_KEY', 'FRONTEND_URL',
    'DLT_SMS_URL', 'DLT_SMS_API_KEY', 'MAIL_GATEWAY_URL',
  ].filter(k => !env[k]);
  if (missing.length) throw new Error(`BOOT_AUTH_CONFIG_MISSING: ${missing.join(', ')}`);
  if ((env.AUTH_OTP_HMAC_KEY || '').length < 32) throw new Error('BOOT_AUTH_KEY_TOO_SHORT');
  for (const key of ['FRONTEND_URL', 'DLT_SMS_URL', 'MAIL_GATEWAY_URL']) {
    if (new URL(env[key]!).protocol !== 'https:') {
      throw new Error(`BOOT_AUTH_HTTPS_REQUIRED: ${key}`);
    }
  }
  const db = new URL(env.APP_DATABASE_URL!);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname ||
      !db.username || ['postgres', 'tc_migrator'].includes(db.username) ||
      db.password.length < 12) {
    throw new Error('BOOT_AUTH_DATABASE_ROLE_INVALID');
  }
  requiredOrigin(env.FRONTEND_URL!);
  if (env.ENABLE_DEBUG_OTP === 'true' || env.ENABLE_OUTBOX_DELIVERY === 'true') {
    throw new Error('BOOT_AUTH_DEBUG_MODE_DISABLED');
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
    }).filter(Boolean);
  if (typeof origin === 'string') {
    if (!allowed.includes(origin)) {
      throw new ForbiddenException({ code: 'LOGIN_ORIGIN_DENIED', detail: 'Login requires an approved application origin.' });
    }
  } else if (isProductionEnvironment()) {
    throw new ForbiddenException({ code: 'LOGIN_ORIGIN_REQUIRED', detail: 'Login requires an origin-bound browser request.' });
  }
}
