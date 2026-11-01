import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AuthenticatedRequest } from '../guards/session-csrf.guard';
import { hashRequestPayload } from '@tradecloseout/db';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly pool: Pool) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse();

    if (req.method.toUpperCase() !== 'POST') {
      return next.handle();
    }

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        title: 'Idempotency-Key header required',
        detail: 'State-changing POST requests must provide a valid Idempotency-Key header.',
      });
    }

    const orgId = req.auth?.activeOrgId;
    if (!orgId) {
      return next.handle();
    }

    const endpoint = `${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const requestHash = hashRequestPayload(req.body);

    // Check existing idempotency record scoped to (org_id, key, endpoint)
    const { rows } = await this.pool.query(
      `SELECT request_hash, response_status, response_json
         FROM idempotency_keys
        WHERE org_id = $1 AND key = $2 AND endpoint = $3
          AND expires_at > now()
        LIMIT 1`,
      [orgId, idempotencyKey, endpoint],
    );

    if (rows.length > 0) {
      const existing = rows[0];
      if (existing.request_hash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          title: 'Idempotency key reused with different payload',
          detail: 'This Idempotency-Key was already used with a different request body.',
        });
      }
      res.status(existing.response_status);
      return of(existing.response_json);
    }

    return next.handle().pipe(
      tap(async (responseBody: any) => {
        const statusCode = res.statusCode || 200;
        if (statusCode >= 200 && statusCode < 300) {
          const ttlHours = endpoint.includes('upload-intents') ? 168 : 24; // 7 days for uploads, 24h default (10 §5)
          await this.pool.query(
            `INSERT INTO idempotency_keys
              (id, org_id, key, endpoint, request_hash, response_status, response_json, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' hours')::interval)
             ON CONFLICT (org_id, key, endpoint) DO NOTHING`,
            [
              uuidv7(),
              orgId,
              idempotencyKey,
              endpoint,
              requestHash,
              statusCode,
              JSON.stringify(responseBody ?? {}),
              String(ttlHours),
            ],
          );
        }
      }),
    );
  }
}
