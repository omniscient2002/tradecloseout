import { HttpStatus } from '@nestjs/common';
import { HealthController } from '../src/modules/health/health.controller';

describe('PH1-G27-005 public health failure boundary', () => {
  const secret = 'postgres://admin:very-secret@internal-db/private';

  function response() {
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  it.each(['health', 'apiHealth'] as const)(
    '%s returns a no-store, dependency-safe 503 on SQL failure',
    async (method) => {
      const db = { queryGlobal: jest.fn().mockRejectedValue(new Error(secret)) };
      const controller = new HealthController(db as any);
      const res = response();
      await controller[method](res);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      const body = res.json.mock.calls[0][0];
      expect(body).toMatchObject({ status: 'degraded', database: 'disconnected' });
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(body)).not.toContain('internal-db');
    },
  );

  it('fails closed when the dependency responds with no rows', async () => {
    const controller = new HealthController({ queryGlobal: jest.fn().mockResolvedValue([]) } as any);
    const res = response();
    await controller.health(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      status: 'degraded', database: 'disconnected',
    });
  });

  it('returns a no-store 200 only when the dependency probe succeeds', async () => {
    const controller = new HealthController({ queryGlobal: jest.fn().mockResolvedValue([{ alive: 1 }]) } as any);
    const res = response();
    await controller.apiHealth(res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.json.mock.calls[0][0]).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
