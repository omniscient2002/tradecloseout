import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveFields } from '../src/tenant-tx';

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
