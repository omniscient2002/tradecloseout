import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { NoGenericIdempotencyReceipt, OMIT_GENERIC_IDEMPOTENCY_RECEIPT } from '../src/common/decorators/no-generic-idempotency-receipt.decorator';
import { RequireIdempotency } from '../src/common/decorators/idempotency.decorator';
import { IdentityController } from '../src/modules/identity/identity.controller';

@NoGenericIdempotencyReceipt()
class SecretController {
  handle() { return null; }
  @RequireIdempotency()
  requiresDedicatedReceipt() { return null; }
}

describe('G01 secret-bearing idempotency contract', () => {
  const request = {
    method: 'POST',
    headers: { 'idempotency-key': 'would-be-plaintext-receipt' },
    baseUrl: '/api/v1/auth',
    route: { path: '/otp/verify' },
    body: { otp: 'hidden' },
    params: {},
    query: {},
    auth: { activeOrgId: 'org-1', userId: 'user-1' },
  };
  const makeContext = (handler: Function) => ({
    getHandler: () => handler,
    getClass: () => SecretController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode: 201 }),
    }),
  }) as any;

  it('exempts all identity controller routes from generic receipt capture', () => {
    const reflector = new Reflector();
    expect(reflector.getAllAndOverride(OMIT_GENERIC_IDEMPOTENCY_RECEIPT, [
      IdentityController.prototype.verifyOtp, IdentityController,
    ])).toBe(true);
    expect(reflector.getAllAndOverride(OMIT_GENERIC_IDEMPOTENCY_RECEIPT, [
      IdentityController.prototype.switchActiveOrg, IdentityController,
    ])).toBe(true);
  });

  it('returns an authentication response without claiming or persisting a generic receipt', async () => {
    const pool = { connect: jest.fn() };
    const interceptor = new IdempotencyInterceptor(pool as any, new Reflector());
    const next = { handle: jest.fn(() => of({ csrfToken: 'secret', recoveryCodes: ['one-time'] })) };
    const response = await interceptor.intercept(makeContext(SecretController.prototype.handle), next as any);
    expect(await firstValueFrom(response)).toEqual({ csrfToken: 'secret', recoveryCodes: ['one-time'] });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects conflicting receipt requirements before invoking a secret-bearing command', async () => {
    const pool = { connect: jest.fn() };
    const interceptor = new IdempotencyInterceptor(pool as any, new Reflector());
    const next = { handle: jest.fn() };
    await expect(interceptor.intercept(makeContext(SecretController.prototype.requiresDedicatedReceipt), next as any))
      .rejects.toBeInstanceOf(ConflictException);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(next.handle).not.toHaveBeenCalled();
  });
});
