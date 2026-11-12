import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { withSavepoint, withTenantTransaction } from '../src/tenant-tx';

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

void test('PH1-G26-006: savepoints use valid bounded non-colliding SQL identifiers', async () => {
  const sql: string[] = [];
  const client = { query: async (statement: string) => { sql.push(statement); return { rows: [] }; } };
  await withSavepoint(client as any, '123 bad-name;DROP TABLE users', async () => 'ok');
  await withSavepoint(client as any, 'x'.repeat(90) + 'a', async () => 'ok');
  await withSavepoint(client as any, 'x'.repeat(90) + 'b', async () => 'ok');
  const names = sql.filter(x => x.startsWith('SAVEPOINT ')).map(x => x.slice('SAVEPOINT '.length));
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3, 'long names must retain distinct digest suffixes');
  for (const name of names) {
    assert.match(name, /^sp_[A-Za-z0-9_]+$/);
    assert(name.length <= 63, 'PostgreSQL must not truncate this identifier');
  }
  assert.equal(sql.filter(x => x.startsWith('RELEASE SAVEPOINT ')).length, 3);
});

void test('PH1-G26-006: failed savepoint cleanup preserves the primary SQL failure', async () => {
  const failure = new Error('original query failed');
  const cleanupFailure = new Error('savepoint rollback failed');
  const sql: string[] = [];
  const client = {
    query: async (statement: string) => {
      sql.push(statement);
      if (statement.startsWith('ROLLBACK TO SAVEPOINT ')) throw cleanupFailure;
      return { rows: [] };
    },
  };
  await assert.rejects(withSavepoint(client as any, 'nested', async () => {
    throw failure;
  }), err => err === failure);
  assert(sql[0].startsWith('SAVEPOINT '));
  assert(sql[1].startsWith('ROLLBACK TO SAVEPOINT '));
});

void test('PH1-G26-006: successful savepoint rollback releases it and rethrows original error', async () => {
  const failure = new Error('constraint violation');
  const sql: string[] = [];
  const client = { query: async (statement: string) => { sql.push(statement); return { rows: [] }; } };
  await assert.rejects(withSavepoint(client as any, 'nested', async () => { throw failure; }), err => err === failure);
  assert.equal(sql.length, 3);
  assert(sql[0].startsWith('SAVEPOINT '));
  assert(sql[1].startsWith('ROLLBACK TO SAVEPOINT '));
  assert(sql[2].startsWith('RELEASE SAVEPOINT '));
});
