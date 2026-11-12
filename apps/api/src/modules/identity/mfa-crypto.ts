import {
  createCipheriv, createDecipheriv, createHmac, createHash,
  randomBytes, timingSafeEqual,
} from 'node:crypto';

/**
 * MFA encryption is an explicit key-ring contract. v2 envelopes carry a
 * non-reversible ID derived from a 256-bit encryption key. Legacy v1 envelopes
 * (pre-key-ID) are supported for migration only while the old key is valid.
 *
 * An expired PREVIOUS key must never prevent current-key decryption or
 * recovery-code verification, even when that expired configuration remains
 * present during rollout. Conversely the old key must never be accepted after
 * its configured retirement deadline.
 *
 * This is a standalone crypto unit. Route enrollment and session-policy
 * enforcement require their separately reviewed DB/controller integration.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_BYTES = 32;

const isProductionLike = () =>
  process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

function decodeConfiguredKey(raw: string | undefined, errorCode: string): Buffer {
  // Reject noncanonical and partially parsed base64. Buffer.from alone
  // silently ignores illegal characters, which is unsafe for key material.
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error(errorCode);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== raw) {
    throw new Error(errorCode);
  }
  return key;
}

function primaryKey(): Buffer {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY;
  if (!raw && !isProductionLike()) {
    // Only a non-production fixture. Production must supply its own 256-bit
    // key and must never silently fall back to a deterministic secret.
    return createHash('sha256')
      .update('tradecloseout-development-only-mfa-key')
      .digest();
  }
  return decodeConfiguredKey(raw, 'BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

function activePreviousKey(): Buffer | null {
  const raw = process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
  if (!raw) return null;
  const expires = process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
  // A missing, invalid or expired deadline DISABLES the previous key. It must
  // not disable the current key, nor prolong the retirement window.
  if (!expires || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires)) {
    return null;
  }
  const until = Date.parse(expires);
  if (!Number.isFinite(until) || until <= Date.now()) return null;
  return decodeConfiguredKey(raw, 'BOOT_AUTH_MFA_PREVIOUS_ENCRYPTION_KEY_INVALID');
}

function decodePart(raw: string, size?: number): Buffer {
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.toString('base64') !== raw || (size !== undefined && bytes.length !== size)) {
    throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  }
  return bytes;
}

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) result += B32[(value >>> (bits -= 5)) & 31];
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
  const key = primaryKey();
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v2', keyId(key), nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptFactor(envelope: string): string {
  if (typeof envelope !== 'string') throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  const parts = envelope.split(':');
  const legacy = parts[0] === 'v1' && parts.length === 4;
  const current = parts[0] === 'v2' && parts.length === 5;
  if (!legacy && !current) throw new Error('MFA_FACTOR_ENVELOPE_INVALID');

  const offset = current ? 1 : 0;
  if (current && !/^[0-9a-f]{24}$/.test(parts[1])) {
    throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  }
  let nonce: Buffer, tag: Buffer, encrypted: Buffer;
  try {
    nonce = decodePart(parts[offset + 1], 12);
    tag = decodePart(parts[offset + 2], 16);
    encrypted = decodePart(parts[offset + 3]);
  } catch {
    throw new Error('MFA_FACTOR_ENVELOPE_INVALID');
  }

  // Try the active key FIRST. Only obtain the previous key if it might be
  // needed. A configured but expired previous key is not consulted.
  const active = primaryKey();
  const storedKeyId = current ? parts[1] : undefined;
  if (!storedKeyId || storedKeyId === keyId(active)) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', active, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // Legacy v1 data may be encrypted under the previous key.
    }
  }
  const previous = activePreviousKey();
  if (previous && !previous.equals(active) &&
      (!storedKeyId || storedKeyId === keyId(previous))) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', previous, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key or corrupted envelope: never expose crypto details.
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
  return recoveryDigest(code, primaryKey());
}

export function hashRecoveryCodeCandidates(code: string): string[] {
  const primary = primaryKey();
  const values = [recoveryDigest(code, primary)];
  // Expired/invalid previous configuration is not able to break the current
  // credential path. Old hashes are accepted only inside the approved window.
  const previous = activePreviousKey();
  if (previous && !previous.equals(primary)) values.push(recoveryDigest(code, previous));
  return values;
}
