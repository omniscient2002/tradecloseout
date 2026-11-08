import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isProductionEnvironment } from './auth-security';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey(): Buffer {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY;
  if (!raw && !isProductionEnvironment()) {
    // Deterministic local fixture key ONLY. Not accepted on staging/production.
    return Buffer.from('tradecloseout-dev-mfa-encryption!', 'utf8');
  }
  const key = Buffer.from(raw || '', 'base64');
  if (key.length !== 32) throw new Error('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
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
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
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

export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', encryptionKey()).update('mfa-recovery:v1:' + code.trim().toUpperCase()).digest('hex');
}
