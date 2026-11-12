import { HttpException, HttpStatus } from '@nestjs/common';
import { ProblemJsonExceptionFilter } from '../src/common/filters/problem-json.filter';
import { HealthController } from '../src/modules/health/health.controller';

describe('PH1-G27-005: non-auth error privacy', () => {
  const makeResponse = () => ({
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  });

  it('hides provider exception message/stack in non-auth logs and HTTP bodies', () => {
    const filter = new ProblemJsonExceptionFilter();
    const log = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
    const res = makeResponse();
    const host: any = { switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ path: '/api/v1/projects', headers: {} }),
    }) };
    filter.catch(new Error('postgres-secret-canary provider-token-canary'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('canary');
    expect(JSON.stringify(log.mock.calls)).not.toContain('canary');
    log.mockRestore();
  });

  it('does not return arbitrary 503 dependency exception details', () => {
    const filter = new ProblemJsonExceptionFilter();
    const res = makeResponse();
    filter.catch(new HttpException({
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: 'S3 secret-canary: X-Amz-Signature=token-canary',
    }, HttpStatus.SERVICE_UNAVAILABLE), { switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ path: '/api/v1/projects', headers: {} }),
    }) } as any);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('canary');
  });

  it('never exposes database connection errors from public health', async () => {
    const db = { queryGlobal: jest.fn(async () => {
      throw new Error('password=health-db-secret-canary');
    }) };
    const health = new HealthController(db as any);
    const res = makeResponse();
    await health.health(res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('canary');
  });
});
