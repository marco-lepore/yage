import { describe, expect, it } from "vitest";
import { RebuildQueue } from "./RebuildQueue.js";

/** Lets everything already queued on the microtask queue run. */
const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A task that only settles when the returned `release` is called. */
function gate(): { task: () => Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { task: () => promise, release };
}

describe("RebuildQueue", () => {
  it("never runs two tasks at once", async () => {
    const queue = new RebuildQueue();
    const order: string[] = [];
    let active = 0;

    const task = (name: string) => async (): Promise<void> => {
      active++;
      expect(active).toBe(1);
      await tick();
      order.push(name);
      active--;
    };

    await queue.schedule(task("a"));
    await queue.schedule(task("b"));

    expect(order).toEqual(["a", "b"]);
  });

  it("drops a task superseded while another is running", async () => {
    const queue = new RebuildQueue();
    const ran: string[] = [];
    const running = gate();

    const first = queue.schedule(async () => {
      ran.push("running");
      await running.task();
    });
    await tick();
    expect(ran).toEqual(["running"]);

    void queue.schedule(async () => {
      ran.push("superseded");
    });
    const last = queue.schedule(async () => {
      ran.push("latest");
    });

    running.release();
    await first;
    await last;

    expect(ran).toEqual(["running", "latest"]);
  });

  it("starts the first request at once and collapses the rest of a burst", async () => {
    const queue = new RebuildQueue();
    const ran: number[] = [];

    for (let i = 0; i < 5; i++) {
      void queue.schedule(async () => {
        ran.push(i);
      });
    }
    await queue.idle;

    expect(ran).toEqual([0, 4]);
  });

  it("settles each caller with its own task's outcome", async () => {
    const queue = new RebuildQueue();
    const running = gate();

    const busy = queue.schedule(() => running.task());
    await tick();

    const dropped = queue.schedule(() =>
      Promise.reject(new Error("never runs")),
    );
    const failing = queue.schedule(() => Promise.reject(new Error("boom")));

    running.release();

    await expect(busy).resolves.toBeUndefined();
    await expect(dropped).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow("boom");
  });

  it("keeps draining after a task throws", async () => {
    const queue = new RebuildQueue();
    const ran: string[] = [];

    const failing = queue.schedule(() => Promise.reject(new Error("boom")));
    await expect(failing).rejects.toThrow("boom");

    await queue.schedule(async () => {
      ran.push("after");
    });

    expect(ran).toEqual(["after"]);
  });

  it("idle resolves once everything scheduled has settled", async () => {
    const queue = new RebuildQueue();
    const running = gate();
    let done = false;

    const busy = queue.schedule(() => running.task());
    void queue.schedule(async () => {
      done = true;
    });

    running.release();
    await busy;
    await queue.idle;

    expect(done).toBe(true);
  });
});
