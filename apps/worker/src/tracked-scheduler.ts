/**
 * Process-local scheduler safety. Redis period leases still own cross-process
 * exclusion; this layer prevents a slow task from overlapping itself within
 * one worker, without delaying unrelated tasks after an error.
 */
export class TrackedScheduler<Task extends string> {
  private readonly active = new Map<Task, Promise<void>>();
  private stopped = false;

  constructor(private readonly onFailure: (task: Task, error: unknown) => void) {}

  run(task: Task, execute: () => Promise<unknown>): Promise<void> {
    if (this.stopped || this.active.has(task)) return Promise.resolve();

    const running = (async () => {
      try {
        await execute();
      } catch (error) {
        try {
          this.onFailure(task, error);
        } catch {
          // Reporting must not reject the scheduler's tracking promise.
        }
      } finally {
        this.active.delete(task);
      }
    })();
    this.active.set(task, running);
    return running;
  }

  close(): void {
    this.stopped = true;
  }

  /** Allow active tasks to finish before database/Redis clients are closed. */
  async drain(): Promise<void> {
    this.close();
    await Promise.allSettled([...this.active.values()]);
  }

  isRunning(task: Task): boolean {
    return this.active.has(task);
  }
}
