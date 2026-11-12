import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { withTenantTransaction } from '../src/tenant-tx';

const context = {
  orgId: 'test-org',
  userId: 'test-user',
  actorType: 'SYSTEM' as const,
  ip: '127.0.0.1',
  userAgent: 'transaction-test',
  requestId: 'test-request',
};

void test('PH1-G26-006: bounded transaction settings are local and clean rollback returns healthy client', async () => {
  const calls: string[] = [];
  const released: Array<boolean | undefined> = [];
  const failure = new Error('command failed');
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === 'SELECT broken') throw failure;
      return { rows: [] };
    },
    release: (destroy?: boolean) => released.push(destroy),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(
    withTenantTransaction(pool, context, async tx => { await tx.query('SELECT broken'); }),
    error => error === failure,
  );
  assert.deepEqual(calls, [
    'BEGIN',
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '60s'",
    "SET LOCAL idle_in_transaction_session_timeout = '60s'",
    "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
    "SELECT set_config('app.current_user', $1, true)",
    'SELECT broken',
    'ROLLBACK',
  ]);
  assert.deepEqual(released, [false], 'successful rollback can safely return the connection');
});

void test('PH1-G26-006: rollback failure preserves primary error and destroys poisoned client', async () => {
  const failure = new Error('original command failure');
  const cleanup = new Error('connection lost during rollback');
  const released: Array<boolean | undefined> = [];
  const client = {
    query: async (sql: string) => {
      if (sql === 'SELECT broken') throw failure;
      if (sql === 'ROLLBACK') throw cleanup;
      return { rows: [] };
    },
    release: (destroy?: boolean) => released.push(destroy),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(
    withTenantTransaction(pool, context, async tx => { await tx.query('SELECT broken'); }),
    error => error === failure,
  );
  assert.deepEqual(released, [true]);
});

void test('PH1-G26-006: ambiguous COMMIT failure discards client even if ROLLBACK succeeds', async () => {
  const failure = new Error('commit acknowledgement lost');
  const calls: string[] = [];
  const released: Array<boolean | undefined> = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === 'COMMIT') throw failure;
      return { rows: [] };
    },
    release: (destroy?: boolean) => released.push(destroy),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(withTenantTransaction(pool, context, async () => 'result'), error => error === failure);
  assert(calls.includes('ROLLBACK'), 'best-effort rollback still runs');
  assert.deepEqual(released, [true]);
});

void test('PH1-G26-006: failed BEGIN discards client without assuming a transaction exists', async () => {
  const failure = new Error('begin failed');
  const calls: string[] = [];
  const released: Array<boolean | undefined> = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql === 'BEGIN') throw failure;
      return { rows: [] };
    },
    release: (destroy?: boolean) => released.push(destroy),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(withTenantTransaction(pool, context, async () => 'result'), error => error === failure);
  assert.deepEqual(calls, ['BEGIN']);
  assert.deepEqual(released, [true]);
});
