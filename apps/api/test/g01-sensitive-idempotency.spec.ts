import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor, containsCredentialReceiptData } from '../src/common/interceptors/idempotency.interceptor';
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

  it('detects nested credentials and signed URLs but permits harmless response metadata', () => {
    expect(containsCredentialReceiptData({ nested: [{ manualSetupKey: 'super-secret' }] })).toBe(true);
    expect(containsCredentialReceiptData({ recovery_codes: ['sensitive'] })).toBe(true);
    expect(containsCredentialReceiptData({ uploadUrl: 'https://example.invalid/upload' })).toBe(true);
    expect(containsCredentialReceiptData({ href: 'https://example.invalid/?X-Amz-Signature=abc' })).toBe(true);
    expect(containsCredentialReceiptData({ id: 'safe', items: [{ status: 'READY', count: 3 }] })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(containsCredentialReceiptData(cyclic)).toBe(true);
  });

  it('leaves a generic receipt unresolved rather than storing secret response content', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO idempotency_keys')) return { rows: [{ id: 'claimed' }] };
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    const interceptor = new IdempotencyInterceptor(pool as any, new Reflector());
    class OrdinaryController {
      action() { return null; }
    }
    const context = {
      getClass: () => OrdinaryController,
      getHandler: () => OrdinaryController.prototype.action,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
      }),
    };
    const next = { handle: jest.fn(() => of({ data: { recoveryCodes: ['sensitive'] } })) };
    const response = await interceptor.intercept(context as any, next as any);
    await expect(firstValueFrom(response)).rejects.toMatchObject({
      response: { code: 'SENSITIVE_RESPONSE_RECEIPT_BLOCKED' },
    });
    expect(queries.some(sql => sql.includes('INSERT INTO idempotency_keys'))).toBe(true);
    expect(queries.some(sql => sql.includes('UPDATE idempotency_keys'))).toBe(false);
    expect(queries.some(sql => sql.includes('DELETE FROM idempotency_keys'))).toBe(false);
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
