import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackedScheduler } from '../src/tracked-scheduler';
import { drainBeforeClosingDependencies } from '../src/worker-drain';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('PH1-G24-010: outbox poll cannot overlap and drain waits before closing BullMQ/PG/Redis', async () => {
  const pollWaiting = deferred();
  const scheduleWaiting = deferred();
  const outbox = new TrackedScheduler<'outbox-poll'>(() => undefined);
  const scheduled = new TrackedScheduler<'daily'>(() => undefined);
  const stages: string[] = [];
  let pollRuns = 0;

  const poll = outbox.run('outbox-poll', async () => {
    pollRuns++;
    stages.push('poll-started');
    await pollWaiting.promise;
    stages.push('queue-add-finished');
  });
  await outbox.run('outbox-poll', async () => { pollRuns++; });
  assert.equal(pollRuns, 1, 'a second 2-second tick must not start another poll');
  const task = scheduled.run('daily', async () => {
    stages.push('schedule-started');
    await scheduleWaiting.promise;
    stages.push('scheduler-sql-finished');
  });

  const drain = drainBeforeClosingDependencies([outbox, scheduled], async () => {
    stages.push('worker-close');
    stages.push('queue-close');
    stages.push('pool-end');
    stages.push('redis-quit');
  });

  await Promise.resolve();
  assert.equal(stages.includes('queue-close'), false, 'do not close queue before queue.add completes');
  assert.equal(stages.includes('pool-end'), false, 'do not close pool while scheduler is active');
  assert.equal(stages.includes('redis-quit'), false, 'do not quit Redis while outbox is active');

  await outbox.run('outbox-poll', async () => { pollRuns++; });
  assert.equal(pollRuns, 1, 'polls admitted after shutdown must be ignored');
  pollWaiting.release();
  await poll;
  await Promise.resolve();
  assert.equal(stages.includes('queue-close'), false, 'scheduler still owns the pool');
  scheduleWaiting.release();
  await Promise.all([task, drain]);
  assert.deepEqual(stages, [
    'poll-started', 'schedule-started', 'queue-add-finished',
    'scheduler-sql-finished', 'worker-close', 'queue-close', 'pool-end', 'redis-quit',
  ]);
});

test('PH1-G24-010: failing tracked outbox work is released and cannot block shutdown', async () => {
  const failures: unknown[] = [];
  const outbox = new TrackedScheduler<'outbox-poll'>((_name, error) => { failures.push(error); });
  const fault = new Error('transient database failure');
  await outbox.run('outbox-poll', async () => { throw fault; });
  assert.deepEqual(failures, [fault]);
  let resourceClosed = false;
  await drainBeforeClosingDependencies([outbox], async () => { resourceClosed = true; });
  assert.equal(resourceClosed, true);
  assert.equal(outbox.isRunning('outbox-poll'), false);
});

test('PH1-G24-010: resource shutdown failures propagate rather than report clean success', async () => {
  const outbox = new TrackedScheduler<'outbox-poll'>(() => undefined);
  const fault = new Error('connection close failed');
  await assert.rejects(
    drainBeforeClosingDependencies([outbox], async () => { throw fault; }),
    error => error === fault,
  );
  await outbox.run('outbox-poll', async () => {
    assert.fail('shutdown-admission fence was bypassed');
  });
});
