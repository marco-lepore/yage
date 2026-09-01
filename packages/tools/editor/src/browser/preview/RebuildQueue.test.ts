import { describe, expect, it } from "vitest";
import { RebuildQueue } from "./RebuildQueue.js";

/** A task that finishes when the returned `finish` is called. */
function controllable(log: string[], label: string) {
  let finish = (): void => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    task: async () => {
      log.push(`start:${label}`);
      await done;
      log.push(`end:${label}`);
    },
    finish: () => finish(),
  };
}

describe("RebuildQueue", () => {
  it("runs one task at a time", async () => {
    const queue = new RebuildQueue();
    const log: string[] = [];
    const first = controllable(log, "first");
    const second = controllable(log, "second");

    const firstRun = queue.schedule(first.task);
    const secondRun = queue.schedule(second.task);
    expect(log).toEqual(["start:first"]);

    first.finish();
    await firstRun;
    second.finish();
    await secondRun;

    expect(log).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
  });

  it("keeps only the newest waiting task", async () => {
    const queue = new RebuildQueue();
    const log: string[] = [];
    const running = controllable(log, "running");
    const superseded = controllable(log, "superseded");
    const newest = controllable(log, "newest");

    void queue.schedule(running.task);
    const supersededRun = queue.schedule(superseded.task);
    void queue.schedule(newest.task);

    // The dropped caller resolves: it asked for a rebuild and gets one, built
    // from newer values than it passed.
    await supersededRun;

    running.finish();
    newest.finish();
    await queue.idle;

    expect(log).toEqual([
      "start:running",
      "end:running",
      "start:newest",
      "end:newest",
    ]);
  });

  it("rejects the caller whose own task threw and keeps running", async () => {
    const queue = new RebuildQueue();
    const failing = queue.schedule(() =>
      Promise.reject(new Error("rebuild failed")),
    );
    await expect(failing).rejects.toThrow("rebuild failed");

    let ran = false;
    await queue.schedule(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });

  it("is idle before anything is scheduled", async () => {
    await expect(new RebuildQueue().idle).resolves.toBeUndefined();
  });
});
