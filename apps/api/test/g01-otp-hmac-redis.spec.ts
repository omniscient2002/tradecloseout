import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { IdentityController } from '../src/modules/identity/identity.controller';

jest.setTimeout(60000);

describe('PH1-G01: OTP HMAC protects low entropy challenges in real Redis', () => {
  const savedKey = process.env.AUTH_OTP_HMAC_KEY;
  const savedDebug = process.env.ENABLE_DEBUG_OTP;
  const savedNodeEnv = process.env.NODE_ENV;
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true, maxRetriesPerRequest: 1,
  });
  const sms = { sendOtpSms: jest.fn() };
  const mail = { sendOtpEmail: jest.fn(), sendMagicLinkEmail: jest.fn() };
  const loginSentinel = new Error('expected database boundary reached');

  beforeAll(async () => {
    await redis.connect();
    process.env.AUTH_OTP_HMAC_KEY = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEBUG_OTP = 'true';
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.AUTH_OTP_HMAC_KEY;
    else process.env.AUTH_OTP_HMAC_KEY = savedKey;
    if (savedDebug === undefined) delete process.env.ENABLE_DEBUG_OTP;
    else process.env.ENABLE_DEBUG_OTP = savedDebug;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    await redis.quit();
  });

  const controller = new IdentityController(
    { connect: jest.fn(async () => { throw loginSentinel; }) } as any,
    redis as any, sms as any, mail as any,
  );
  const request = { headers: {}, cookies: {} } as any;
  const response = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

  async function cleanup(identifier: string, challengeId?: string) {
    const active = await redis.get(`otp:alias:${identifier}`);
    if (active) await redis.del(`otp:challenge:${active}`, `otp:attempts:${active}`);
    if (challengeId) await redis.del(`otp:challenge:${challengeId}`, `otp:attempts:${challengeId}`);
    await redis.del(`otp:alias:${identifier}`, `otp:challenge:${identifier}`, `rl:otp:req:${identifier}`);
  }

  it('never saves plaintext OTP or crackable SHA1 digest, and consumes a valid HMAC challenge once', async () => {
    const identifier = `otp-hmac-${randomBytes(8).toString('hex')}@example.com`;
    let challengeId: string | undefined;
    try {
      const issued = await controller.requestOtp({ identifier }, request) as any;
      challengeId = issued.challengeId;
      expect(issued.debugOtp).toMatch(/^[0-9]{6}$/);
      const raw = await redis.get(`otp:challenge:${challengeId}`);
      expect(raw).toBeTruthy();
      const challenge = JSON.parse(raw!);
      expect(challenge).toMatchObject({ id: challengeId, identifier });
      expect(challenge.otpMac).toMatch(/^[a-f0-9]{64}$/);
      expect(challenge.otpHash).toBeUndefined();
      expect(raw).not.toContain(issued.debugOtp);
      const bad = issued.debugOtp === '000000' ? '111111' : '000000';
      await expect(controller.verifyOtp({ identifier, challengeId, code: bad }, request, response))
        .rejects.toMatchObject({ status: 401 });
      await expect(controller.verifyOtp({ identifier, challengeId, code: issued.debugOtp }, request, response))
        .rejects.toBe(loginSentinel);
      expect(await redis.get(`otp:challenge:${challengeId}`)).toBeNull();
      await expect(controller.verifyOtp({ identifier, challengeId, code: issued.debugOtp }, request, response))
        .rejects.toMatchObject({ status: 401 });
    } finally {
      await cleanup(identifier, challengeId);
    }
  });

  it('invalidates old challenges when the HMAC key is rotated; new challenges verify', async () => {
    const identifier = `otp-rotate-${randomBytes(8).toString('hex')}@example.com`;
    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      const first = await controller.requestOtp({ identifier }, request) as any;
      firstId = first.challengeId;
      process.env.AUTH_OTP_HMAC_KEY = randomBytes(32).toString('hex');
      await expect(controller.verifyOtp({ identifier, challengeId: firstId, code: first.debugOtp }, request, response))
        .rejects.toMatchObject({ status: 401 });
      const second = await controller.requestOtp({ identifier }, request) as any;
      secondId = second.challengeId;
      await expect(controller.verifyOtp({ identifier, challengeId: secondId, code: second.debugOtp }, request, response))
        .rejects.toBe(loginSentinel);
    } finally {
      await cleanup(identifier, firstId);
      if (secondId) await redis.del(`otp:challenge:${secondId}`);
    }
  });

  it('fails closed if the server HMAC key is not configured', async () => {
    const identifier = `otp-missing-${randomBytes(8).toString('hex')}@example.com`;
    const prior = process.env.AUTH_OTP_HMAC_KEY;
    delete process.env.AUTH_OTP_HMAC_KEY;
    try {
      await expect(controller.requestOtp({ identifier }, request)).rejects.toThrow('AUTH_OTP_HMAC_KEY_NOT_CONFIGURED');
      expect(await redis.get(`otp:alias:${identifier}`)).toBeNull();
    } finally {
      process.env.AUTH_OTP_HMAC_KEY = prior;
      await cleanup(identifier);
    }
  });
});
