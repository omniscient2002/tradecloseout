import {
  reconcileStorageQuotaOnFileStatusChange, redactSensitiveFields, withTenantTransaction,
} from '@tradecloseout/db/tenant-tx';

describe('Phase 1 audit/outbox tenant and secret boundaries', () => {
  it('PH1-G27-003: recursively redacts common secret aliases and signed URLs', () => {
    const raw = {
      action: 'ISSUED',
      nested: {
        authToken: 'canary-auth',
        manualSetupKey: 'canary-factor',
        recoveryCodes: ['canary-recovery'],
        credentials: [{ apiKey: 'canary-provider' }],
        detail: 'safe business detail',
      },
      proof: [{ otp: '123456', original: 'safe' }],
      link: 'https://files.example.test/path?X-Amz-Signature=canary',
      publicUrl: 'https://files.example.test/path',
    };
    const scrubbed = redactSensitiveFields(raw) as any;
    expect(JSON.stringify(scrubbed)).not.toMatch(
      /canary-auth|canary-factor|canary-recovery|canary-provider|123456|X-Amz-Signature/,
    );
    expect(scrubbed.nested.detail).toBe('safe business detail');
    expect(scrubbed.publicUrl).toBe(raw.publicUrl);
    expect(scrubbed.proof[0].original).toBe('safe');
  });

  it('PH1-G27-004: caller payload cannot override trusted outbox identity fields', async () => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) };
    const result = await withTenantTransaction(pool as any, {
      orgId: 'trusted-org', userId: 'trusted-actor', actorType: 'SYSTEM',
      ip: '127.0.0.1', userAgent: 'fixture', requestId: 'trusted-request',
    }, async (_client, emit) => {
      emit({
        eventType: 'TEST_EVENT', entityType: 'DOCUMENT', entityId: 'trusted-document',
        afterJson: {
          orgId: 'forged-org', actorUserId: 'forged-actor',
          entityId: 'forged-document', requestId: 'forged-request',
          authToken: 'canary-token',
        },
      });
      return 'committed';
    });
    expect(result).toBe('committed');
    const outbox = statements.find((entry) => entry.sql.includes('INSERT INTO outbox_events'));
    expect(outbox).toBeDefined();
    const envelope = JSON.parse(outbox!.params[4] as string);
    expect(envelope).toMatchObject({
      orgId: 'trusted-org', actorUserId: 'trusted-actor',
      entityId: 'trusted-document', requestId: 'trusted-request',
      authToken: '[REDACTED]',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('PH1-G26-002: quota write binds bigint arithmetic, not text', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };
    await reconcileStorageQuotaOnFileStatusChange(
      client as any, 'tenant-a', 1234n, 'MARKED_READY',
    );
    const update = calls.find((x) => x.sql.includes('UPDATE usage_counters'));
    expect(update?.sql).toContain('::bigint');
    expect(update?.sql).not.toContain('::text');
    expect(update?.params).toEqual(['tenant-a', '1234']);
  });
});
