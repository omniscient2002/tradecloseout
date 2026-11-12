import { LiveSessionAuthorityChangedError } from '@tradecloseout/db';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';

describe('PH1-G01-004: session authority denial HTTP contract', () => {
  it('maps a concurrent revocation to a deterministic non-leaking HTTP 403', () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { headers: { 'x-request-id': 'auth-fence-regression' } };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };
    const filter = new ProblemJsonExceptionFilter();
    filter.catch(new LiveSessionAuthorityChangedError(), host as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/problem+json');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 403,
      code: 'AUTH_SESSION_CONTEXT_CHANGED',
      requestId: 'auth-fence-regression',
      retryable: false,
    }));
    const body = response.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toMatch(/suspended|revoked|account|membership|secret|tenant.*status/i);
  });
});
