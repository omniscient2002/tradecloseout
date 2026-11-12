import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AuthenticatedRequest } from '../guards/session-csrf.guard';
import { hashRequestPayload } from '@tradecloseout/db';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorators/idempotency.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly pool: Pool,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse();

    if (req.method.toUpperCase() !== 'POST') {
      return next.handle();
    }

    const requiresIdempotency = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_IDEMPOTENCY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // PH1-G01-001: MFA enrollment returns one-time factor secrets and
    // confirmation returns recovery codes. Generic idempotency receipts store
    // plaintext response_json, so these commands must never reach that store.
    // Their controller-level account/session locking, proof consumption and
    // replay checks remain authoritative. A new enrollment-start request
    // replaces the pending enrollment rather than replaying its secret.
    const path = `${req.baseUrl || ''}${req.route?.path ?? req.path ?? ''}`;
    if (/\/auth\/mfa(?:\/|$)/.test(path)) {
      return next.handle();
    }

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      if (requiresIdempotency) {
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          title: 'Idempotency-Key header required',
          detail: 'State-changing POST requests must provide a valid Idempotency-Key header.',
        });
      }
      return next.handle();
    }

    if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        title: 'Invalid Idempotency-Key header',
        detail: 'The Idempotency-Key header must be a string of at most 128 characters.',
      });
    }

    const orgId = req.auth?.activeOrgId || (req as any).userContext?.orgId;
    if (!orgId) {
      return next.handle();
    }

    const endpoint = `${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const actorId = req.auth?.userId || (req as any).userContext?.userId || 'anonymous';
    const requestHash = hashRequestPayload({
      body: req.body,
      params: req.params,
      query: req.query,
      actorId,
    });
    const ttlHours = endpoint.includes('upload-intents') ? 168 : 24;
    const withTenantClient = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [orgId]);
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [actorId === 'anonymous' ? '' : actorId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    };

    // Concurrency-safe atomic claim (TC2-010)
    let claimed = false;
    let persistingReceipt = false;
    const keyId = uuidv7();

    try {
      const outcome = await withTenantClient(async (client) => {
        const inserted = await client.query(
          `INSERT INTO idempotency_keys
            (id, org_id, key, endpoint, request_hash, response_status, response_json, expires_at)
           VALUES ($1, $2, $3, $4, $5, 0, '{}'::jsonb, now() + ($6 || ' hours')::interval)
           ON CONFLICT (org_id, key, endpoint) DO UPDATE
             SET id = EXCLUDED.id, request_hash = EXCLUDED.request_hash,
                 response_status = 0, response_json = '{}'::jsonb, expires_at = EXCLUDED.expires_at
             WHERE idempotency_keys.expires_at <= now() AND idempotency_keys.response_status <> 0
           RETURNING id`,
          [keyId, orgId, idempotencyKey, endpoint, requestHash, String(ttlHours)],
        );
        if (inserted.rows.length) return { claimed: true as const };
        const { rows } = await client.query(
          `SELECT request_hash, response_status, response_json
             FROM idempotency_keys
            WHERE org_id = $1 AND key = $2 AND endpoint = $3
            LIMIT 1`,
          [orgId, idempotencyKey, endpoint],
        );
        return rows.length ? { claimed: false as const, existing: rows[0] } : { claimed: false as const };
      });
      if (!outcome.claimed) {
        const existing = outcome.existing;
        if (!existing) throw new Error('IDEMPOTENCY_CLAIM_LOST');
        if (existing.request_hash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            title: 'Idempotency key reused with different payload',
            detail: 'This Idempotency-Key was already used with a different request payload.',
          });
        }
        if (existing.response_status === 0) {
          throw new ConflictException({
            code: 'REQUEST_IN_PROGRESS',
            title: 'Request outcome is not yet available',
            detail: 'A request with this Idempotency-Key is still processing or needs reconciliation before it can be retried safely.',
          });
        }
        res.status(existing.response_status);
        return of(existing.response_json);
      }
      claimed = true;
    } catch (insertErr: any) {
      if (insertErr instanceof ConflictException) throw insertErr;
      // A receipt-store outage must never turn a protected command into an
      // unprotected command. Only a successful claim may reach the handler.
      throw new ConflictException({
        code: 'IDEMPOTENCY_STORE_UNAVAILABLE',
        title: 'Command receipt unavailable',
        detail: 'The command was not run because its retry-safety receipt could not be claimed.',
      });
    }

    return next.handle().pipe(
      mergeMap(async (responseBody: any) => {
        if (!claimed) return responseBody;
        const statusCode = res.statusCode || 200;
        if (statusCode >= 200 && statusCode < 300) {
          persistingReceipt = true;
          const saved = await withTenantClient((client) => client.query(
            `UPDATE idempotency_keys
                SET response_status = $1, response_json = $2
              WHERE org_id = $3 AND key = $4 AND endpoint = $5 AND response_status = 0`,
            [statusCode, JSON.stringify(responseBody ?? {}), orgId, idempotencyKey, endpoint],
          ));
          if (saved.rowCount !== 1) {
            throw new Error('IDEMPOTENCY_RECEIPT_WRITE_LOST');
          }
          persistingReceipt = false;
        } else {
          await withTenantClient((client) => client.query(
            `DELETE FROM idempotency_keys WHERE org_id = $1 AND key = $2 AND endpoint = $3`,
            [orgId, idempotencyKey, endpoint],
          ));
        }
        return responseBody;
      }),
      catchError((err) => {
        if (!claimed || persistingReceipt) return throwError(() => err);
        return from(withTenantClient((client) => client.query(
          `DELETE FROM idempotency_keys WHERE org_id = $1 AND key = $2 AND endpoint = $3 AND response_status = 0`,
          [orgId, idempotencyKey, endpoint],
        ))).pipe(
          catchError(() => of(undefined)),
          mergeMap(() => throwError(() => err)),
        );
      }),
    );
  }
}
