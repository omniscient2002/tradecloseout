import { HttpException, HttpStatus } from '@nestjs/common';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';

describe('PH1-G27-005 problem response and logging secrecy', () => {
  const secret = 'postgres://operator:plaintext-secret@internal-db/private';
  const filter = new ProblemJsonExceptionFilter();

  const capture = (exception: unknown, inputRequestId: unknown = '98a0ca31-385c-4077-a762-a4b4cadf0774') => {
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const req: any = { headers: { 'x-request-id': inputRequestId } };
    const host: any = { switchToHttp: () => ({
      getRequest: () => req, getResponse: () => res,
    }) };
    filter.catch(exception, host);
    return { body: res.json.mock.calls[0][0], res };
  };

  it('does not log or respond with unhandled exception messages or stack secrets', () => {
    const spy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    try {
      const exception = new Error(secret);
      exception.stack = `Error: ${secret}\n at secretInternalOperation`;
      const { body, res } = capture(exception);
      expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', requestId: '98a0ca31-385c-4077-a762-a4b4cadf0774' });
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    } finally { spy.mockRestore(); }
  });

  it('does not reflect caller-injected request IDs into headers, bodies or logs', () => {
    const spy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    try {
      const { body, res } = capture(new Error('oops'), `bad\r\nX-Secret: ${secret}`);
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.requestId).not.toContain(secret);
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', body.requestId);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    } finally { spy.mockRestore(); }
  });

  it('does not expose body or field errors from a server-side HttpException', () => {
    const { body, res } = capture(new HttpException({
      code: 'SQL_FAILURE', title: secret, detail: secret,
      message: [secret], fieldErrors: [{ field: secret, message: secret }],
    }, HttpStatus.SERVICE_UNAVAILABLE));
    expect(body).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
    expect(body.fieldErrors).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('preserves ordinary controlled client-validation response contracts', () => {
    const { body } = capture(new HttpException({
      code: 'VALIDATION_FAILED', detail: 'Invalid project state',
    }, HttpStatus.BAD_REQUEST));
    expect(body).toMatchObject({
      status: 400, code: 'VALIDATION_FAILED', detail: 'Invalid project state', retryable: false,
    });
  });

  it('never returns the underlying plan-limit exception string', () => {
    const exception = Object.assign(new Error(secret), { code: 'PLAN_LIMIT_EXCEEDED' });
    const { body } = capture(exception);
    expect(body).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', status: 409 });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
