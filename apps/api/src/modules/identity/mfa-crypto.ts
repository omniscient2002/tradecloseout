import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isProductionEnvironment } from './auth-security';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey(): Buffer {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY;
  if (!raw && !isProductionEnvironment()) {
    // Deterministic local fixture key ONLY. Not accepted on staging/production.
    return createHash('sha256').update('tradecloseout-development-only-mfa-key').digest();
  }
  const key = Buffer.from(raw || '', 'base64');
  if (key.length !== 32) throw new Error('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
  return key;
}

function previousEncryptionKey(): Buffer | null {
  const previous = process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
  if (!previous) return null;
  const expires = process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
  if (!expires || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires) ||
      !Number.isFinite(Date.parse(expires))) {
    throw new Error('BOOT_AUTH_MFA_PREVIOUS_KEY_EXPIRED_OR_UNBOUNDED');
  }
  // An expired prior key is retired, not a reason to reject factors
  // encrypted with the current key or current-key recovery codes.
  if (Date.parse(expires) <= Date.now()) return null;
  const key = Buffer.from(previous, 'base64');
  if (key.length !== 32) throw new Error('BOOT_AUTH_MFA_PREVIOUS_ENCRYPTION_KEY_INVALID');
  return key;
}

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += B32[(value >>> (bits -= 5)) & 31];
    }
  }
  if (bits) result += B32[(value << (5 - bits)) & 31];
  return result;
}

function secretBytes(base32: string): Buffer {
  let value = 0, bits = 0;
  const bytes: number[] = [];
  for (const c of base32.replace(/=+$/, '').toUpperCase()) {
    const digit = B32.indexOf(c);
    if (digit < 0) throw new Error('MFA_SECRET_INVALID');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 255);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function encryptFactor(plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptFactor(envelope: string): string {
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  const decryptWithKey = (key: Buffer): string => {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')), decipher.final(),
    ]).toString('utf8');
  };
  // Always try the current key first. A malformed or retired fallback key
  // must not prevent authentication with valid current-key material.
  try {
    return decryptWithKey(encryptionKey());
  } catch {
    // The GCM tag may belong to a permitted previous rotation key.
  }
  const previous = previousEncryptionKey();
  if (previous) {
    try {
      return decryptWithKey(previous);
    } catch {
      // Never disclose key material or raw cryptographic errors.
    }
  }
  throw new Error('MFA_FACTOR_DECRYPT_FAILED');
}

export function verifyTotp(secret: string, input: string, lastUsedStep = -1): number | null {
  if (!/^\d{6}$/.test(input)) return null;
  const key = secretBytes(secret);
  const clock = Math.floor(Date.now() / 30_000);
  for (const step of [clock - 1, clock, clock + 1]) {
    if (step <= lastUsedStep) continue;
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', key).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    const code = String(binary).padStart(6, '0');
    if (timingSafeEqual(Buffer.from(input), Buffer.from(code))) return step;
  }
  return null;
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => randomBytes(12).toString('hex').toUpperCase());
}

function recoveryDigest(code: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update('mfa-recovery:v1:' + code.trim().toUpperCase()).digest('hex');
}

export function hashRecoveryCode(code: string): string {
  // New recovery codes always use the current key, never a previous one.
  return recoveryDigest(code, encryptionKey());
}

/** A rotation may accept old *unconsumed* codes only while explicitly configured. */
export function hashRecoveryCodeCandidates(code: string): string[] {
  const primary = encryptionKey();
  const previous = previousEncryptionKey();
  const values = [recoveryDigest(code,primary)];
  if (previous && !previous.equals(primary)) {
    values.push(recoveryDigest(code,previous));
  }
  return values;
}
