import { createCipheriv, randomBytes } from 'node:crypto';
import {
  decryptFactor, encryptFactor, hashRecoveryCode, hashRecoveryCodeCandidates,
  newRecoveryCodes, newTotpSecret, verifyTotp,
} from '../src/modules/identity/mfa-crypto';

const active = randomBytes(32).toString('base64');
const retired = randomBytes(32).toString('base64');
const epoch = Date.parse('2026-11-12T00:00:00.000Z');
const deadline = '2026-11-12T00:01:00.000Z';
const previousEnv = {
  NODE_ENV: process.env.NODE_ENV,
  AUTH_MFA_ENCRYPTION_KEY: process.env.AUTH_MFA_ENCRYPTION_KEY,
  AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS,
  AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT: process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT,
};

function legacyEnvelope(secret: string, key: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

describe('PH1-G01-002: MFA key retirement and recovery compatibility', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(epoch);
    process.env.NODE_ENV = 'test';
    process.env.AUTH_MFA_ENCRYPTION_KEY = active;
    process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS = retired;
    process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT = deadline;
  });
  afterEach(() => {
    nowSpy.mockRestore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('continues verifying current v2 factors and codes across an expired previous-key boundary', () => {
    const factor = encryptFactor('CURRENT-FACTOR');
    expect(factor).toMatch(/^v2:[a-f0-9]{24}:/);
    const currentRecovery = hashRecoveryCode('CURRENT-RECOVERY');
    const oldRecovery = hashRecoveryCodeCandidates('RETIRED-RECOVERY')[1];
    expect(oldRecovery).toBeDefined();

    nowSpy.mockReturnValue(Date.parse(deadline));
    expect(decryptFactor(factor)).toBe('CURRENT-FACTOR');
    expect(hashRecoveryCodeCandidates('CURRENT-RECOVERY')).toEqual([currentRecovery]);
    expect(hashRecoveryCodeCandidates('RETIRED-RECOVERY')).not.toContain(oldRecovery);
  });

  it('retains legacy v1 compatibility only while previous key remains eligible', () => {
    const legacyOld = legacyEnvelope('OLD-FACTOR', retired);
    const legacyCurrent = legacyEnvelope('CURRENT-LEGACY', active);
    const v2Old = (() => {
      const oldKey = process.env.AUTH_MFA_ENCRYPTION_KEY!;
      process.env.AUTH_MFA_ENCRYPTION_KEY = retired;
      try { return encryptFactor('V2-RETIRED'); }
      finally { process.env.AUTH_MFA_ENCRYPTION_KEY = oldKey; }
    })();
    expect(decryptFactor(legacyOld)).toBe('OLD-FACTOR');
    expect(decryptFactor(legacyCurrent)).toBe('CURRENT-LEGACY');
    expect(decryptFactor(v2Old)).toBe('V2-RETIRED');

    nowSpy.mockReturnValue(Date.parse(deadline));
    expect(decryptFactor(legacyCurrent)).toBe('CURRENT-LEGACY');
    expect(() => decryptFactor(legacyOld)).toThrow('MFA_FACTOR_DECRYPT_FAILED');
    expect(() => decryptFactor(v2Old)).toThrow('MFA_FACTOR_DECRYPT_FAILED');
  });

  it('does not let invalid, missing or expired previous-key configuration disable valid current material', () => {
    const currentFactor = encryptFactor('NEW');
    const currentHash = hashRecoveryCode('NEW-CODE');
    for (const expiry of [
      '2026-11-11T23:59:00.000Z', 'not-a-date', undefined,
    ]) {
      if (expiry === undefined) delete process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
      else process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT = expiry;
      process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS = 'definitely-not-valid-base64';
      expect(decryptFactor(currentFactor)).toBe('NEW');
      expect(hashRecoveryCodeCandidates('NEW-CODE')).toEqual([currentHash]);
    }
  });

  it('rejects tampered, malformed and missing-key envelopes without leaking factors or key data', () => {
    const factor = encryptFactor('HIGHLY-SENSITIVE-SETUP-SECRET');
    const parts = factor.split(':');
    const tampered = [...parts];
    tampered[3] = randomBytes(16).toString('base64');
    expect(() => decryptFactor(tampered.join(':'))).toThrow('MFA_FACTOR_DECRYPT_FAILED');
    expect(() => decryptFactor('v2:no-valid-key-id:xxx:yyy:zzz')).toThrow('MFA_FACTOR_ENVELOPE_INVALID');
    delete process.env.AUTH_MFA_ENCRYPTION_KEY_PREVIOUS;
    delete process.env.AUTH_MFA_PREVIOUS_KEY_EXPIRES_AT;
    expect(() => decryptFactor(legacyEnvelope('OLD', retired))).toThrow('MFA_FACTOR_DECRYPT_FAILED');
    expect(() => decryptFactor(factor)).not.toThrow();
  });

  it('enforces production key configuration and TOTP replay-step rejection', () => {
    const generated = newTotpSecret();
    const codes = newRecoveryCodes();
    expect(generated).toMatch(/^[A-Z2-7]{32}$/);
    expect(new Set(codes).size).toBe(8);
    expect(verifyTotp(generated, 'not-otp')).toBeNull();
    expect(verifyTotp(generated, '123456', Number.MAX_SAFE_INTEGER)).toBeNull();

    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    expect(() => encryptFactor('SECRET')).toThrow('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
    expect(() => hashRecoveryCode('BACKUP')).toThrow('BOOT_AUTH_MFA_ENCRYPTION_KEY_INVALID');
  });
});
