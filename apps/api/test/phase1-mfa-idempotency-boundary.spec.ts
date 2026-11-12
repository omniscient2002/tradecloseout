import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';

describe('PH1-G01-001: MFA secret responses are excluded from generic receipts', () => {
  it.each(['/enroll/start', '/enroll/confirm', '/recovery', '/verify', '/reset'])(
    'never queries idempotency_keys for %s, even when the browser sends a key',
    async (suffix) => {
      const pool = {
        connect: jest.fn(() => {
          throw new Error('MFA_SECRET_REACHED_GENERIC_RECEIPT_STORAGE');
        }),
      };
      const reflector = { getAllAndOverride: jest.fn(() => false) };
      const interceptor = new IdempotencyInterceptor(pool as any, reflector as any);
      const next = { handle: jest.fn(() => of({ manualSetupKey: 'secret-canary' })) };
      const request = {
        method: 'POST',
        baseUrl: '/api/v1/auth/mfa',
        route: { path: suffix },
        headers: { 'idempotency-key': 'fixture-unique-request-id' },
        auth: { activeOrgId: 'fixture-org-id', userId: 'fixture-user-id' },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({ statusCode: 201 }),
        }),
        getHandler: () => () => null,
        getClass: () => class {},
      };
      const observable = await interceptor.intercept(context as any, next as any);
      await expect(firstValueFrom(observable)).resolves.toEqual({
        manualSetupKey: 'secret-canary',
      });
      expect(pool.connect).not.toHaveBeenCalled();
      expect(next.handle).toHaveBeenCalledTimes(1);
    },
  );
});
