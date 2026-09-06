interface QueuedTask {
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Runs preview rebuilds one at a time, keeping only the newest request.
 *
 * A drag or a stream of accepted commands asks for a rebuild faster than one
 * takes. Left unqueued, two rebuilds in flight would both read the scene as it
 * was before either started and the preview would end up showing whichever
 * finished last rather than the newest document. The first request starts
 * immediately; anything that arrives while it runs collapses to the last.
 *
 * The lab runs the same mechanism for the same reason
 * (`packages/tools/lab/src/runner/RebuildQueue.ts`). It is copied rather than
 * shared: the editor does not depend on the lab package.
 */
export class RebuildQueue {
  private pending: QueuedTask | null = null;
  private running = false;
  private idleWaiters: Array<() => void> = [];

  /**
   * Queues `task`, dropping any task still waiting. The returned promise
   * settles with this task's own outcome, or resolves if it was dropped before
   * it ran.
   */
  schedule(task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // A dropped caller resolves: it asked for a rebuild and gets one, just
      // built from newer values than it passed.
      this.pending?.resolve();
      this.pending = { run: task, resolve, reject };
      if (!this.running) void this.drain();
    });
  }

  /** Resolves once nothing is running or waiting. */
  get idle(): Promise<void> {
    if (!this.running && !this.pending) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try {
          await next.run();
          next.resolve();
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const waiter of waiters) waiter();
    }
  }
}
