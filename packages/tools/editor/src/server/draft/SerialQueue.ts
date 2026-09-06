/**
 * Runs tasks one at a time, in call order.
 *
 * A draft transition reads state, compares revisions, applies, and writes — and
 * awaits inside that sequence. Without a queue a second request would interleave
 * at any of those awaits and compare against state that has already moved. One
 * queue per level keeps that impossible while letting different levels progress
 * independently.
 *
 * A task that rejects does not stop the queue: the next task still runs, and the
 * rejection reaches its own caller.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
