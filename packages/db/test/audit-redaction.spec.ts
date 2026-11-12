import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveFields, withTenantTransaction } from '../src/tenant-tx';
import type { Pool } from 'pg';

void test('PH1-G27-003: nested credentials are removed from audit metadata without mutating the input', () => {
  const source = {
    harmless: 'kept',
    event: {
      items: [
        { accessToken: 'access-secret', password: 'password-secret', safe: 7 },
        { 'set-cookie': 'session=secret', metadata: { recovery_codes: ['code-a'], qr_payload: 'otpauth://secret' } },
      ],
      api_key: 'api-secret',
      requestId: 'safe-id',
    },
  };
  const result = redactSensitiveFields(source);
  assert.deepEqual(result, {
    harmless: 'kept',
    event: {
      items: [
        { accessToken: '[REDACTED]', password: '[REDACTED]', safe: 7 },
        { 'set-cookie': '[REDACTED]', metadata: { recovery_codes: '[REDACTED]', qr_payload: '[REDACTED]' } },
      ],
      api_key: '[REDACTED]',
      requestId: 'safe-id',
    },
  });
  assert.equal(source.event.items[0].accessToken, 'access-secret');
  assert.equal(source.event.api_key, 'api-secret');
});

void test('PH1-G27-003: signed URLs and credential values are scrubbed without sensitive key names', () => {
  const source = {
    download: {
      url: 'https://files.example.test/object?X-Amz-Signature=secret-signature',
      nested: [
        { value: 'Bearer abcdefghijklmnopqrstuvwxyz1234' },
        { callback: 'otpauth://totp/tenant?secret=ABCDEF' },
        { harmlessUrl: 'https://example.test/public/manual.pdf' },
        { awsSecretAccessKey: 'private-credential', privateKey: 'private-key-data' },
      ],
    },
  };
  const result = redactSensitiveFields(source);
  const nested = (result.download as Record<string, unknown>).nested as Array<Record<string, unknown>>;
  assert.equal((result.download as Record<string, unknown>).url, '[REDACTED]');
  assert.equal(nested[0].value, '[REDACTED]');
  assert.equal(nested[1].callback, '[REDACTED]');
  assert.equal(nested[2].harmlessUrl, 'https://example.test/public/manual.pdf');
  assert.equal(nested[3].awsSecretAccessKey, '[REDACTED]');
  assert.equal(nested[3].privateKey, '[REDACTED]');
  assert(!JSON.stringify(result).includes('secret-signature'));
  assert(!JSON.stringify(result).includes('abcdefghijklmnopqrstuvwxyz1234'));
});

void test('PH1-G27-003: redaction terminates on circular structures and bounded nesting', () => {
  const circular: Record<string, unknown> = { name: 'safe' };
  circular.self = circular;
  const result = redactSensitiveFields(circular);
  assert.equal(result.name, 'safe');
  assert.equal(result.self, '[REDACTED:CIRCULAR_REFERENCE]');

  const deep: Record<string, unknown> = { leaf: 'safe' };
  let root: Record<string, unknown> = deep;
  for (let i = 0; i < 40; i++) root = { nested: root };
  const bounded = redactSensitiveFields(root);
  assert(!JSON.stringify(bounded).includes('safe'), 'unbounded metadata must not traverse through the depth limit');
});

void test('PH1-G27-003/004: forged envelope identity rejects and rolls back its transaction', async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const ctx = {
    orgId: 'trusted-org', userId: 'trusted-user', actorType: 'MEMBER' as const,
    ip: '127.0.0.1', userAgent: 'test-client', requestId: 'trusted-request',
  };
  await assert.rejects(withTenantTransaction(pool, ctx, async (_client, emit) => {
    emit({
      eventType: 'REDACTION_PROBE', entityType: 'PROJECT', entityId: 'trusted-entity',
      projectId: 'trusted-project',
      afterJson: { orgId: 'spoofed-org', actorUserId: 'spoofed-user' },
    });
    return null;
  }), /OUTBOX_RESERVED_FIELD/);
  assert.equal(statements.some(q => q.sql.includes('INSERT INTO outbox_events')), false);
  assert.equal(statements.some(q => q.sql.includes('INSERT INTO audit_events')), false);
  assert(statements.some(q => q.sql === 'ROLLBACK'));
  assert.equal(statements.some(q => q.sql === 'COMMIT'), false);
});

void test('PH1-G27-003/004: emitted V1 event preserves provenance, nested redaction and audit', async () => {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const ctx = {
    orgId: 'trusted-org', userId: 'trusted-user', actorType: 'MEMBER' as const,
    ip: '127.0.0.1', userAgent: 'test-client', requestId: 'trusted-request',
  };
  await withTenantTransaction(pool, ctx, async (_client, emit) => {
    emit({
      eventType: 'REDACTION_PROBE', entityType: 'PROJECT', entityId: 'trusted-entity',
      projectId: 'trusted-project',
      afterJson: {
        projectId: 'trusted-project',
        domain: { nested: [{ mfaSecret: 'top-secret', refresh_token: 'very-secret', ordinary: 'kept' }] },
      },
    });
    return null;
  });
  const outbox = statements.find(q => q.sql.includes('INSERT INTO outbox_events'));
  assert(outbox);
  const payload = JSON.parse(String(outbox.params[4]));
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.orgId, 'trusted-org');
  assert.equal(payload.actorUserId, 'trusted-user');
  assert.equal(payload.requestId, 'trusted-request');
  assert.equal(payload.projectId, 'trusted-project');
  assert.equal(payload.entityId, 'trusted-entity');
  assert.equal(payload.eventType, 'REDACTION_PROBE');
  assert.equal(payload.data.projectId, undefined);
  assert.equal(payload.data.domain.nested[0].mfaSecret, '[REDACTED]');
  assert.equal(payload.data.domain.nested[0].refresh_token, '[REDACTED]');
  assert.equal(payload.data.domain.nested[0].ordinary, 'kept');
  assert(!JSON.stringify(payload).includes('top-secret'));

  const audit = statements.find(q => q.sql.includes('INSERT INTO audit_events'));
  assert(audit);
  const after = JSON.parse(String(audit.params[9]));
  assert.equal(after.domain.nested[0].mfaSecret, '[REDACTED]');
  assert(statements.some(q => q.sql === 'COMMIT'));
});
