import { IdentityController } from '../src/modules/identity/identity.controller';

describe('OTP request limit environment boundary', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });
  function setup() {
    const evalMock = jest.fn(async (_script: string, _keys: number, key: string) => key.startsWith('rl:') ? 100 : 'OK');
    const mail = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    return { evalMock, mail, controller: new IdentityController({} as any, { eval: evalMock } as any, {} as any, mail as any) };
  }
  it('allows repeated development requests even when an old limit was exceeded', async () => {
    process.env.NODE_ENV = 'development';
    const { controller, evalMock } = setup();
    for (let i = 0; i < 7; i++) {
      await expect(controller.requestOtp({ identifier: 'local@example.test' }, {} as any)).resolves.toHaveProperty('challengeId');
    }
    expect(evalMock.mock.calls).toHaveLength(7);
    expect(evalMock.mock.calls.every(call => call[2].startsWith('otp:alias:'))).toBe(true);
  });
  it.each(['production', 'staging', 'test', undefined])('enforces the limit for %s', async mode => {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    const { controller, mail } = setup();
    await expect(controller.requestOtp({ identifier: 'local@example.test' }, {} as any)).rejects.toMatchObject({ status: 429 });
    expect(mail.sendOtpEmail).not.toHaveBeenCalled();
  });
});
