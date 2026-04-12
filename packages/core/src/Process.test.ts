import { describe, it, expect, vi } from "vitest";
import {
  Process,
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeOutBounce,
} from "./Process.js";

describe("Process", () => {
  it("calls update function each tick", () => {
    const update = vi.fn();
    const proc = new Process({ update });
    proc._update(16);
    expect(update).toHaveBeenCalledWith(16, 16);
    proc._update(16);
    expect(update).toHaveBeenCalledWith(16, 32);
  });

  it("completes when update returns true", () => {
    const proc = new Process({
      update: () => true,
    });
    expect(proc.completed).toBe(false);
    proc._update(16);
    expect(proc.completed).toBe(true);
  });

  it("completes when duration is reached", () => {
    const proc = new Process({
      duration: 100,
      update: () => {},
    });
    proc._update(50);
    expect(proc.completed).toBe(false);
    proc._update(50);
    expect(proc.completed).toBe(true);
  });

  it("calls onComplete when done", () => {
    const onComplete = vi.fn();
    const proc = new Process({
      update: () => true,
      onComplete,
    });
    proc._update(16);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("does not update when paused", () => {
    const update = vi.fn();
    const proc = new Process({ update });
    proc.pause();
    expect(proc.paused).toBe(true);
    proc._update(16);
    expect(update).not.toHaveBeenCalled();
  });

  it("resumes after pause", () => {
    const update = vi.fn();
    const proc = new Process({ update });
    proc.pause();
    proc.resume();
    expect(proc.paused).toBe(false);
    proc._update(16);
    expect(update).toHaveBeenCalled();
  });

  it("cancel completes immediately", () => {
    const proc = new Process({ update: () => {} });
    proc.cancel();
    expect(proc.completed).toBe(true);
  });

  it("does not update after completed", () => {
    const update = vi.fn();
    const proc = new Process({ update: () => true });
    proc._update(16); // completes
    update.mockClear();
    proc._update(16);
    expect(update).not.toHaveBeenCalled();
  });

  it("toPromise resolves on completion", async () => {
    const proc = new Process({ update: () => true });
    const promise = proc.toPromise();
    proc._update(16);
    await promise; // should resolve without timing out
  });

  it("toPromise resolves on cancel", async () => {
    const proc = new Process({ update: () => {} });
    const promise = proc.toPromise();
    proc.cancel();
    await promise;
  });

  it("toPromise resolves immediately if already completed", async () => {
    const proc = new Process({ update: () => true });
    proc._update(16);
    await proc.toPromise();
  });

  it("loop resets elapsed when update returns true", () => {
    let callCount = 0;
    const proc = new Process({
      loop: true,
      update: () => {
        callCount++;
        return callCount % 2 === 0;
      },
    });
    proc._update(16); // callCount=1, not complete
    proc._update(16); // callCount=2, returns true → loops
    expect(proc.completed).toBe(false);
    proc._update(16); // callCount=3, continues
    expect(proc.completed).toBe(false);
  });

  it("loop resets when duration is reached", () => {
    const update = vi.fn(() => {});
    const proc = new Process({
      duration: 100,
      loop: true,
      update,
    });
    proc._update(100);
    expect(proc.completed).toBe(false); // looped, not completed
    proc._update(100);
    expect(proc.completed).toBe(false);
  });

  it("loop carries overshoot remainder forward", () => {
    const elapsed: number[] = [];
    const proc = new Process({
      duration: 100,
      loop: true,
      update: (_dt, e) => {
        elapsed.push(e);
      },
    });
    // Tick overshoots by 8ms: elapsed=108, loops to 108%100=8
    proc._update(108);
    expect(proc.completed).toBe(false);
    // Next tick adds 50ms: elapsed should be 8+50=58
    proc._update(50);
    expect(elapsed[elapsed.length - 1]).toBeCloseTo(58);
  });

  it("_reset() restores process to initial state", () => {
    const update = vi.fn();
    const proc = new Process({ duration: 100, update });
    proc._update(100); // completes
    expect(proc.completed).toBe(true);

    proc._reset();
    expect(proc.completed).toBe(false);
    expect(proc.paused).toBe(false);

    // Can run again
    update.mockClear();
    proc._update(50);
    expect(update).toHaveBeenCalled();
    expect(proc.completed).toBe(false);
    proc._update(50);
    expect(proc.completed).toBe(true);
  });

  it("_reset() clears cancelled state", () => {
    const update = vi.fn();
    const proc = new Process({ update });
    proc.cancel();
    expect(proc.completed).toBe(true);

    proc._reset();
    proc._update(16);
    expect(update).toHaveBeenCalled();
  });

  it("_reset() clears paused state", () => {
    const update = vi.fn();
    const proc = new Process({ update });
    proc.pause();
    proc._reset();
    proc._update(16);
    expect(update).toHaveBeenCalled();
  });

  it("stores tags", () => {
    const proc = new Process({
      update: () => {},
      tags: ["effect", "ui"],
    });
    expect(proc.tags).toEqual(["effect", "ui"]);
  });
});

describe("Easing functions", () => {
  it("easeLinear", () => {
    expect(easeLinear(0)).toBe(0);
    expect(easeLinear(0.5)).toBe(0.5);
    expect(easeLinear(1)).toBe(1);
  });

  it("easeInQuad", () => {
    expect(easeInQuad(0)).toBe(0);
    expect(easeInQuad(1)).toBe(1);
    expect(easeInQuad(0.5)).toBeCloseTo(0.25);
  });

  it("easeOutQuad", () => {
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(1)).toBe(1);
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75);
  });

  it("easeInOutQuad", () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5);
  });

  it("easeOutBounce", () => {
    expect(easeOutBounce(0)).toBe(0);
    expect(easeOutBounce(1)).toBeCloseTo(1);
    // Mid-values should be reasonable
    expect(easeOutBounce(0.5)).toBeGreaterThan(0);
    expect(easeOutBounce(0.5)).toBeLessThanOrEqual(1);
  });

  it("easeOutBounce covers all branches", () => {
    // Each branch based on t thresholds
    expect(easeOutBounce(0.2)).toBeGreaterThan(0); // t < 1/2.75
    expect(easeOutBounce(0.5)).toBeGreaterThan(0); // t < 2/2.75
    expect(easeOutBounce(0.8)).toBeGreaterThan(0); // t < 2.5/2.75
    expect(easeOutBounce(0.97)).toBeGreaterThan(0); // t >= 2.5/2.75
  });
});
