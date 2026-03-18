import { describe, it, expect, vi } from "vitest";
import { Sequence } from "./Sequence.js";
import { Process } from "./Process.js";

describe("Sequence", () => {
  it("runs steps in order", () => {
    const order: number[] = [];
    const proc = new Sequence()
      .call(() => order.push(1))
      .call(() => order.push(2))
      .call(() => order.push(3))
      ._build();

    proc._update(16); // step 1
    proc._update(16); // step 2
    proc._update(16); // step 3
    expect(order).toEqual([1, 2, 3]);
    expect(proc.completed).toBe(true);
  });

  it("wait() delays for specified ms", () => {
    const called = vi.fn();
    const proc = new Sequence().wait(100).call(called)._build();

    proc._update(50); // wait process created, 50ms elapsed
    expect(called).not.toHaveBeenCalled();
    proc._update(50); // wait hits 100ms, completes. stepIndex advances.
    expect(called).not.toHaveBeenCalled();
    proc._update(0); // call process created and runs
    expect(called).toHaveBeenCalledOnce();
  });

  it("then() with Process factory", () => {
    let value = 0;
    const proc = new Sequence()
      .then(
        () =>
          new Process({
            duration: 100,
            update: (_dt, elapsed) => {
              value = elapsed;
            },
          }),
      )
      ._build();

    proc._update(50);
    expect(value).toBe(50);
    expect(proc.completed).toBe(false);
    proc._update(50); // inner process reaches 100ms, completes; sequence has 1 step → done
    expect(proc.completed).toBe(true);
  });

  it("then() with Process instance", () => {
    let value = 0;
    const inner = new Process({
      update: () => {
        value++;
        return true;
      },
    });
    const proc = new Sequence().then(inner)._build();
    proc._update(16);
    expect(value).toBe(1);
  });

  it("parallel() runs multiple processes simultaneously", () => {
    let a = 0;
    let b = 0;
    const proc = new Sequence()
      .parallel(
        () =>
          new Process({
            duration: 100,
            update: () => {
              a++;
            },
          }),
        () =>
          new Process({
            duration: 50,
            update: () => {
              b++;
            },
          }),
      )
      ._build();

    proc._update(50);
    // Both should have been updated
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // b completes at 50ms, but parallel waits for a (100ms)
    proc._update(50);
    proc._update(0); // check for completion
    expect(proc.completed).toBe(true);
  });

  it("start() returns a process", () => {
    const proc = new Sequence().call(() => {}).start();
    expect(proc).toBeInstanceOf(Process);
  });

  it("empty sequence completes immediately", () => {
    const proc = new Sequence()._build();
    proc._update(16);
    expect(proc.completed).toBe(true);
  });

  it("parallel() accepts Process instances directly", () => {
    let a = 0;
    let b = 0;
    const procA = new Process({
      update: () => {
        a++;
        return true;
      },
    });
    const procB = new Process({
      update: () => {
        b++;
        return true;
      },
    });
    const seq = new Sequence().parallel(procA, procB)._build();
    seq._update(16);
    expect(a).toBe(1);
    expect(b).toBe(1);
    // Both complete immediately, so sequence should be done after next tick
    seq._update(0);
    expect(seq.completed).toBe(true);
  });

  it("handles corrupted step array gracefully (defensive guard)", () => {
    const seq = new Sequence();
    // Inject a falsy value into the internal steps array to trigger the guard
    const steps = (seq as unknown as { steps: Array<unknown> })["steps"];
    steps.push(undefined);
    const proc = seq._build();
    proc._update(16);
    // The guard returns true (complete) when it encounters a falsy step
    expect(proc.completed).toBe(true);
  });

  it("loop() makes the sequence repeat indefinitely", () => {
    let count = 0;
    const proc = new Sequence()
      .call(() => count++)
      .loop()
      ._build();

    proc._update(0); // iteration 1
    proc._update(0); // restarts, iteration 2
    proc._update(0); // restarts, iteration 3
    expect(count).toBe(3);
    expect(proc.completed).toBe(false);
  });

  it("repeat(n) makes the sequence run n times", () => {
    let count = 0;
    const proc = new Sequence()
      .call(() => count++)
      .repeat(3)
      ._build();

    proc._update(0); // iteration 1
    proc._update(0); // iteration 2
    proc._update(0); // iteration 3
    expect(count).toBe(3);
    expect(proc.completed).toBe(true);
  });

  it("repeat(1) runs once (same as no repeat)", () => {
    let count = 0;
    const proc = new Sequence()
      .call(() => count++)
      .repeat(1)
      ._build();

    proc._update(0);
    expect(count).toBe(1);
    expect(proc.completed).toBe(true);
  });

  it("loop() resets direct Process instances between iterations", () => {
    let count = 0;
    const inner = new Process({
      duration: 50,
      update: () => { count++; },
    });
    const proc = new Sequence()
      .then(inner)
      .loop()
      ._build();

    // Iteration 1: inner runs for 50ms
    proc._update(50);
    const count1 = count;
    expect(count1).toBeGreaterThan(0);

    // Iteration 2: inner should be reset and run again
    proc._update(50);
    expect(count).toBeGreaterThan(count1);
    expect(proc.completed).toBe(false);
  });

  it("repeat() resets direct Process instances between iterations", () => {
    let count = 0;
    const inner = new Process({
      update: () => { count++; return true; },
    });
    const proc = new Sequence()
      .then(inner)
      .repeat(3)
      ._build();

    proc._update(0); // iteration 1
    proc._update(0); // iteration 2
    proc._update(0); // iteration 3
    expect(count).toBe(3);
    expect(proc.completed).toBe(true);
  });

  it("parallel() resets direct Process instances on loop", () => {
    let a = 0;
    let b = 0;
    const procA = new Process({ update: () => { a++; return true; } });
    const procB = new Process({ update: () => { b++; return true; } });

    const seq = new Sequence()
      .parallel(procA, procB)
      .loop()
      ._build();

    seq._update(0); // iteration 1: both run and complete
    seq._update(0); // iteration 2: both should be reset and run again
    seq._update(0); // iteration 3
    expect(a).toBe(3);
    expect(b).toBe(3);
  });

  it("complex chain works", () => {
    const order: string[] = [];
    const proc = new Sequence()
      .call(() => order.push("start"))
      .wait(50)
      .call(() => order.push("after-wait"))
      .then(
        () =>
          new Process({
            update: () => {
              order.push("custom");
              return true;
            },
          }),
      )
      .call(() => order.push("end"))
      ._build();

    proc._update(16); // "start" call created and completes, stepIndex → 1
    proc._update(16); // wait(50) process created, 16ms elapsed
    proc._update(34); // wait at 50ms, completes, stepIndex → 2
    proc._update(0); // "after-wait" call created and completes, stepIndex → 3
    proc._update(0); // "custom" process created and completes, stepIndex → 4
    proc._update(0); // "end" call created and completes, stepIndex → 5 (done)
    expect(order).toEqual(["start", "after-wait", "custom", "end"]);
    expect(proc.completed).toBe(true);
  });
});
