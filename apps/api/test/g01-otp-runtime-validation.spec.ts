import { UnprocessableEntityException } from '@nestjs/common';
import { IdentityController } from '../src/modules/identity/identity.controller';

describe('G01 runtime OTP validation', () => {
  const redis = { eval: jest.fn() };
  const pool = { connect: jest.fn() };
  const sms = { sendOtpSms: jest.fn() };
  const mail = { sendOtpEmail: jest.fn(), sendMagicLinkEmail: jest.fn() };
  const controller = new IdentityController(pool as any, redis as any, sms as any, mail as any);
  const req = { headers: {}, cookies: {} } as any;
  const res = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [{ identifier: { unexpected: true } }, 'object identifier'],
    [{ identifier: 123 }, 'numeric identifier'],
    [{ identifier: 'owner@example.com', phoneOrEmail: 'other@example.com' }, 'conflicting aliases'],
    [{ identifier: ['owner@example.com'] }, 'array identifier'],
  ])('rejects %s without issuing a challenge (%s)', async (body) => {
    await expect(controller.requestOtp(body as any, req)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(sms.sendOtpSms).not.toHaveBeenCalled();
    expect(mail.sendOtpEmail).not.toHaveBeenCalled();
  });

  it.each([
    [{ identifier: { arbitrary: true }, code: '123456' }, 'object identifier'],
    [{ identifier: 'owner@example.com', code: 123456 }, 'numeric code'],
    [{ identifier: 'owner@example.com', code: '123' }, 'short code'],
    [{ identifier: 'owner@example.com', code: '123456', otp: '654321' }, 'conflicting code aliases'],
    [{ challengeId: { hostile: true }, code: '123456' }, 'object challenge'],
    [{ challengeId: 'not-a-uuid', code: '123456' }, 'malformed challenge'],
    [{ identifier: 'owner@example.com', code: '123456', signupProfile: { fullName: 42 } }, 'invalid signup profile'],
  ])('rejects %s before consuming a challenge (%s)', async (body) => {
    await expect(controller.verifyOtp(body as any, req, res)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
