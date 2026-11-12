import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AuthenticatedRequest } from '../guards/session-csrf.guard';
import { hashRequestPayload } from '@tradecloseout/db';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorators/idempotency.decorator';
import { OMIT_GENERIC_IDEMPOTENCY_RECEIPT } from '../decorators/no-generic-idempotency-receipt.decorator';

/**
 * A general-purpose receipt is not an approved credential vault. Catch nested
 * secret material even when a controller has not opted out explicitly. Fail
 * closed on cyclic/deep responses because JSON serialisation is not reliable.
 */
export function containsCredentialReceiptData(value: unknown): boolean {
  const seen = new WeakSet<object>();
  const secretKey = /(?:password|passphrase|secret|credential|authorization|api.?key|token|otp|totp|mfa|recoverycode|csrf|cookie|privatekey|manualsetupkey|qrcode|qrpayload|magiclink|signedurl|presignedurl|uploadurl|downloadurl|sessionkey)/i;
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 32) return true;
    if (typeof node === 'string') {
      // Credential data can hide under innocent keys such as "value", "href",
      // "text" or "payload". Block known one-time factor and bearer formats,
      // not just fields whose names happen to look sensitive.
      return /[?&](?:X-Amz-Signature|X-Goog-Signature|signature|access_token|token|api_key|client_secret)=/i.test(node) ||
        /otpauth:\/\//i.test(node) ||
        /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----/i.test(node) ||
        /(?:^|[\s"'=:])(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{12,}={0,2}(?=$|[\s"'&])/i.test(node) ||
        /(?:^|[\s"'=:])(?:sk-(?:live|test)-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,})(?=$|[\s"'&])/i.test(node);
    }
    if (node === null || typeof node !== 'object') return false;
    if (seen.has(node)) return true;
    seen.add(node);
    try {
      if (Array.isArray(node)) return node.some(item => visit(item, depth + 1));
      return Object.entries(node).some(([key, child]) =>
        secretKey.test(key.replace(/[^A-Za-z0-9]/g, '')) || visit(child, depth + 1),
      );
    } finally {
      seen.delete(node);
    }
  };
  return visit(value, 0);
}

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

    // Generic receipts are readable by receipt-replay consumers and must
    // never become an at-rest store for OTP, session, MFA or recovery material.
    const omitGenericReceipt = this.reflector.getAllAndOverride<boolean>(
      OMIT_GENERIC_IDEMPOTENCY_RECEIPT,
      [context.getHandler(), context.getClass()],
    );
    if (omitGenericReceipt) {
      if (requiresIdempotency) {
        throw new ConflictException({
          code: 'AUTH_RECEIPT_CONTRACT_REQUIRED',
          detail: 'This operation requires a dedicated protected retry contract.',
        });
      }
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
      let began = false;
      let commitAttempted = false;
      let discardConnection = false;
      try {
        await client.query('BEGIN');
        began = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
        await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [orgId]);
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [actorId === 'anonymous' ? '' : actorId]);
        const result = await work(client);
        commitAttempted = true;
        await client.query('COMMIT');
        return result;
      } catch (err) {
        discardConnection = !began || commitAttempted;
        if (began) {
          try { await client.query('ROLLBACK'); }
          catch { discardConnection = true; }
        }
        throw err;
      } finally {
        client.release(discardConnection);
      }
    };

    // Concurrency-safe atomic claim (TC2-010)
    let claimed = false;
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
          // Inspect the actual serialized receipt as well as the source body.
          // Nest responses may contain custom toJSON() methods or getters whose
          // serialized fields are not visible to Object.entries(responseBody).
          // Never scan one shape and then persist a different, unchecked one.
          let receiptJson: string;
          try {
            const encoded = JSON.stringify(responseBody ?? {});
            if (typeof encoded !== 'string') throw new Error('NON_JSON_RESPONSE');
            receiptJson = encoded;
          } catch {
            throw new ConflictException({
              code: 'IDEMPOTENCY_RECEIPT_NOT_SERIALIZABLE',
              detail: 'The command requires a dedicated outcome recovery contract.',
            });
          }
          if (containsCredentialReceiptData(responseBody) ||
              containsCredentialReceiptData(JSON.parse(receiptJson))) {
            // Leave the claim unresolved so a retry cannot re-run a possibly
            // committed operation. A privileged reconciliation path must
            // resolve the outcome; never write plaintext or invent an ACK.
            throw new ConflictException({
              code: 'SENSITIVE_RESPONSE_RECEIPT_BLOCKED',
              detail: 'A protected operation requires a dedicated retry and recovery contract.',
            });
          }
          const saved = await withTenantClient((client) => client.query(
            `UPDATE idempotency_keys
                SET response_status = $1, response_json = $2
              WHERE org_id = $3 AND key = $4 AND endpoint = $5 AND response_status = 0`,
            [statusCode, receiptJson, orgId, idempotencyKey, endpoint],
          ));
          if (saved.rowCount !== 1) {
            throw new Error('IDEMPOTENCY_RECEIPT_WRITE_LOST');
          }
        }
        // A handler error or non-success response cannot prove its business
        // transaction rolled back. Keep the claim unresolved until an explicit
        // outcome-reconciliation contract can establish that safely. In
        // particular, never re-admit a command after a lost COMMIT acknowledgement.
        return responseBody;
      }),
    );
  }
}
