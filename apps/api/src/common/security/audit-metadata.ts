import { uuidv7 } from 'uuidv7';

/**
 * G01-021: untrusted request headers may contain full invitation URLs,
 * credentials or attacker-controlled control characters. Persist only fixed
 * browser/platform categories and an opaque request ID. Do not log or echo the
 * original header or any portion beyond the fixed labels.
 */
export function safeAuthenticationDeviceLabel(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) return 'Unknown device';
  const browser = /Firefox\//i.test(raw) ? 'Firefox'
    : /Edg\//i.test(raw) ? 'Edge'
    : /Chrome\//i.test(raw) ? 'Chrome'
    : /Safari\//i.test(raw) ? 'Safari' : 'Browser';
  const platform = /Android/i.test(raw) ? 'Android'
    : /iPhone|iPad|iPod/i.test(raw) ? 'iOS'
    : /Windows/i.test(raw) ? 'Windows'
    : /Macintosh|Mac OS/i.test(raw) ? 'macOS'
    : /Linux/i.test(raw) ? 'Linux' : 'Other';
  return `${browser} / ${platform}`;
}

export function safeAuthenticationRequestId(raw: unknown): string {
  return typeof raw === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw : uuidv7();
}
