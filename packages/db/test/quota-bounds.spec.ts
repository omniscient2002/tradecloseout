import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { consumePlanQuota } from '../src/tenant-tx';

type MockResult = { client: PoolClient; statements: Array<{ sql: string; values: unknown[] }> };
function mockCounter(value: string): MockResult {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes('SELECT value FROM usage_counters')) return { rows: [{ value }] };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { client, statements };
}

void test('PH1-G26-011: bounded usage counters preserve valid consumption and refunds', async () => {
  for (const [start, delta, ceiling, final] of [
    ['9', 1n, 10n, 10n],
    ['9', -9n, 10n, 0n],
    ['9223372036854775806', 1n, 9223372036854775807n, 9223372036854775807n],
  ] as const) {
    const { client, statements } = mockCounter(start);
    await consumePlanQuota(client, 'org', 'PACKAGES_MONTH', '2026-11', delta, ceiling);
    const update = statements.find(item => item.sql.includes('UPDATE usage_counters'));
    assert(update, 'counter must be updated after a valid locked read');
    assert.equal(update.values[3], delta.toString());
    assert.equal(BigInt(start) + delta, final);
  }
});

void test('PH1-G26-011: counter underflow, overflow and plan-limit violations deny without updating', async () => {
  for (const [start, delta, ceiling, code] of [
    ['0', -1n, 100n, 'PLAN_COUNTER_OUT_OF_RANGE'],
    ['9223372036854775807', 1n, 9223372036854775807n, 'PLAN_COUNTER_OUT_OF_RANGE'],
    ['9', 2n, 10n, 'PLAN_LIMIT_EXCEEDED'],
  ] as const) {
    const { client, statements } = mockCounter(start);
    await assert.rejects(
      consumePlanQuota(client, 'org', 'ACTIVE_PROJECTS', 'ALL_TIME', delta, ceiling),
      (error: unknown) => error instanceof Error &&
        (error.message.includes(code) || (error as { code?: string }).code === code),
    );
    assert(!statements.some(item => item.sql.includes('UPDATE usage_counters')), 'denial must not update counter');
  }
});

void test('PH1-G26-011: malformed limits or deltas fail before database writes', async () => {
  for (const [delta, ceiling] of [
    [1n, -1n],
    [9223372036854775808n, 9223372036854775807n],
    [-9223372036854775808n, 9223372036854775807n],
    [0n, 9223372036854775808n],
  ] as const) {
    const { client, statements } = mockCounter('0');
    await assert.rejects(
      consumePlanQuota(client, 'org', 'STORAGE_BYTES', 'ALL_TIME', delta, ceiling),
      /INVALID_PLAN_QUOTA_ARGUMENT/,
    );
    assert.equal(statements.length, 0);
  }
});
