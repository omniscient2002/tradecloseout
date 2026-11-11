import { UnauthorizedException } from '@nestjs/common';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';
import { requestIdFor } from '../src/common/security/audit-metadata';

describe('G01-R7 canonical request correlation across authentication failures', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  it.each([
    'OTP_123456_INVITE_abcdef0123456789abcdef0123456789',
    'a'.repeat(64), 'x'.repeat(10000), 'line\r\nbreak',
    null, ['otp-123456'], 123456, false, undefined,
  ])('never retains an invalid input in error telemetry (case %#)', raw => {
    for (const path of ['/api/v1/auth/otp/verify', '/api/v1/guest/token/otp/verify']) {
      const filter = new ProblemJsonExceptionFilter();
      const log = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
      const req = { path, headers: { 'x-request-id': raw as unknown } };
      const output: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const host: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => output }) };
      // No authenticated guard context exists on this path. The filter must
      // independently obtain the same safe ID as the earliest middleware.
      filter.catch(new Error('simulated store failure'), host);
      const id = output.json.mock.calls[0][0].requestId;
      expect(id).toMatch(uuid);
      expect(log.mock.calls[0][0]).toMatchObject({requestId:id});
      expect(output.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
      expect(req.headers['x-request-id']).toBe(id);
      expect(requestIdFor(req)).toBe(id);
      if (typeof raw === 'string') {
        expect(JSON.stringify([log.mock.calls, output.json.mock.calls, output.setHeader.mock.calls])).not.toContain(raw);
      }
      log.mockRestore();
    }
  });

  it('preserves safe UUID correlation and ignores later header mutation', () => {
    const id = '019a6f40-e041-7000-8000-000000000001';
    const req = { path: '/api/v1/auth/me', headers: { 'x-request-id': id } };
    expect(requestIdFor(req)).toBe(id);
    req.headers['x-request-id'] = 'OTP_123456';
    const filter = new ProblemJsonExceptionFilter();
    const output: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    filter.catch(new UnauthorizedException({ code: 'SESSION_EXPIRED' }), {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => output }),
    } as any);
    expect(output.status).toHaveBeenCalledWith(401);
    expect(output.json.mock.calls[0][0].requestId).toBe(id);
    expect(output.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });
});
