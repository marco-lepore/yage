interface QueuedTask {
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Runs scene rebuilds one at a time, keeping only the newest request.
 *
 * A slider drag fires a rebuild per input event. Left unqueued, two rebuilds in
 * flight would both read an empty scene stack and push instead of replace, and
 * the scene would work through every value the slider passed over instead of
 * the one it landed on. The first request starts immediately; anything that
 * arrives while it runs collapses to the last.
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
