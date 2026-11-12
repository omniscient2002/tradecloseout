import { TrackedScheduler } from './tracked-scheduler';

/**
 * Stop admission on all tracked worker loops before closing any resources.
 * Draining the outbox poller before BullMQ queues is essential: an in-flight
 * queue.add must not race queue.close or pool.end during SIGTERM.
 *
 * This guarantees orderly completion for settled work only. A permanently
 * stalled provider/Redis/SQL operation still needs a supervised shutdown
 * deadline and durable claim recovery; it must not be misreported as drained.
 */
export async function drainBeforeClosingDependencies(
  activities: readonly Pick<TrackedScheduler<string>, 'close' | 'drain'>[],
  closeDependencies: () => Promise<void>,
): Promise<void> {
  for (const activity of activities) activity.close();
  await Promise.all(activities.map(activity => activity.drain()));
  await closeDependencies();
}
