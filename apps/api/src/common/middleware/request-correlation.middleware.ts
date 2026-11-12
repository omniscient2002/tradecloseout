import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const ids = new WeakMap<object, string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Establish once, before authentication; never retain rejected caller input. */
export function requestCorrelationId(req: Pick<Request, 'headers'>): string {
  const existing = ids.get(req);
  if (existing) return existing;
  const supplied = req.headers['x-request-id'];
  const id = typeof supplied === 'string' && uuid.test(supplied)
    ? supplied.toLowerCase() : randomUUID();
  ids.set(req, id);
  req.headers['x-request-id'] = id;
  return id;
}

export function requestCorrelationMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Request-Id', requestCorrelationId(req));
  next();
}
