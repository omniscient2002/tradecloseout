import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackedScheduler } from '../src/tracked-scheduler';

type Name = 'slow' | 'audit' | 'reconcile';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('PH1-G24-006: overlapping minute ticks never run the same task concurrently', async () => {
  const first = deferred();
  const runner = new TrackedScheduler<Name>((_name, error) => { throw error; });
  let calls = 0;
  const task = () => {
    calls++;
    return first.promise;
  };
  const pending = runner.run('slow', task);
  await runner.run('slow', task);
  assert.equal(calls, 1);
  assert.equal(runner.isRunning('slow'), true);

  // A stalled job must not prevent a different scheduled task progressing.
  let completedAudit = 0;
  await runner.run('audit', async () => { completedAudit++; });
  assert.equal(completedAudit, 1);

  first.resolve();
  await pending;
  assert.equal(runner.isRunning('slow'), false);
  await runner.run('slow', async () => { calls++; });
  assert.equal(calls, 2);
});

test('PH1-G24-006: one failed task does not skip unrelated work and is retried', async () => {
  const seen: Array<{ task: Name; error: unknown }> = [];
  const runner = new TrackedScheduler<Name>((task, error) => { seen.push({ task, error }); });
  let auditCalls = 0;
  let reconciliationCalls = 0;
  const failure = new Error('synthetic SQL outage');
  await Promise.all([
    runner.run('audit', async () => { auditCalls++; throw failure; }),
    runner.run('reconcile', async () => { reconciliationCalls++; }),
  ]);
  assert.equal(auditCalls, 1);
  assert.equal(reconciliationCalls, 1);
  assert.deepEqual(seen, [{ task: 'audit', error: failure }]);

  await runner.run('audit', async () => { auditCalls++; });
  assert.equal(auditCalls, 2);
  assert.equal(seen.length, 1);
});

test('PH1-G24-006 / G24-010: shutdown drains work and rejects subsequent ticks', async () => {
  const finishing = deferred();
  const runner = new TrackedScheduler<Name>(() => undefined);
  const inFlight = runner.run('slow', async () => finishing.promise);
  runner.close();
  let done = false;
  const drain = runner.drain().then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false, 'DB/Redis teardown must wait for in-flight scheduler work');
  let started = false;
  await runner.run('audit', async () => { started = true; });
  assert.equal(started, false, 'closed runner must not accept new cycles');
  finishing.resolve();
  await Promise.all([drain, inFlight]);
  assert.equal(done, true);
  assert.equal(runner.isRunning('slow'), false);
});

test('PH1-G24-006: throwing diagnostic reporter cannot poison task release', async () => {
  const runner = new TrackedScheduler<Name>(() => { throw new Error('log unavailable'); });
  await runner.run('audit', async () => { throw new Error('work failed'); });
  assert.equal(runner.isRunning('audit'), false);
  let called = 0;
  await runner.run('audit', async () => { called++; });
  assert.equal(called, 1);
});
