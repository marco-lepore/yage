import { describe, it, expect, vi } from "vitest";
import { ProcessSlot } from "./ProcessSlot.js";

describe("ProcessSlot", () => {
  it("starts in completed state", () => {
    const slot = new ProcessSlot({ duration: 100 });
    expect(slot.completed).toBe(true);
    expect(slot.running).toBe(false);
    expect(slot.elapsed).toBe(0);
    expect(slot.ratio).toBe(0);
  });

  it("start() activates the slot", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    expect(slot.completed).toBe(false);
    expect(slot.running).toBe(true);
  });

  it("completes after duration", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    slot._tick(50);
    expect(slot.completed).toBe(false);
    expect(slot.ratio).toBeCloseTo(0.5);
    slot._tick(50);
    expect(slot.completed).toBe(true);
    expect(slot.ratio).toBe(1);
  });

  it("calls onComplete on natural completion", () => {
    const onComplete = vi.fn();
    const slot = new ProcessSlot({ duration: 100, onComplete });
    slot.start();
    slot._tick(100);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("calls cleanup on natural completion", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 100, cleanup });
    slot.start();
    slot._tick(100);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("calls cleanup on cancel", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 100, cleanup });
    slot.start();
    slot._tick(50);
    slot.cancel();
    expect(slot.completed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cancel on completed slot is a no-op", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 100, cleanup });
    slot.cancel();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("does not call onComplete on cancel", () => {
    const onComplete = vi.fn();
    const slot = new ProcessSlot({ duration: 100, onComplete });
    slot.start();
    slot.cancel();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("restart() calls cleanup before restarting", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 100, cleanup });
    slot.start();
    slot._tick(50);
    slot.restart();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(slot.completed).toBe(false);
    expect(slot.elapsed).toBe(0);
  });

  it("restart() works on a completed slot", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    slot._tick(100);
    expect(slot.completed).toBe(true);
    slot.restart();
    expect(slot.completed).toBe(false);
    expect(slot.elapsed).toBe(0);
  });

  it("start() is a no-op if already running", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    slot._tick(50);
    slot.start(); // should not reset
    expect(slot.elapsed).toBe(50);
  });

  it("start(overrides) merges config for that run", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start({ duration: 200 });
    slot._tick(150);
    expect(slot.completed).toBe(false);
    slot._tick(50);
    expect(slot.completed).toBe(true);
  });

  it("start(overrides) does not affect the next bare start()", () => {
    const slot = new ProcessSlot({ duration: 100, tags: ["cooldown"] });
    slot.start({ duration: 20, tags: ["rush"] });
    expect(slot.tags).toEqual(["rush"]);
    slot._tick(20);
    expect(slot.completed).toBe(true);
    expect(slot.tags).toEqual(["cooldown"]);

    slot.start();
    slot._tick(20);
    expect(slot.completed).toBe(false);
    expect(slot.tags).toEqual(["cooldown"]);
    slot._tick(80);
    expect(slot.completed).toBe(true);
  });

  it("start(overrides) on a running slot is discarded with the start", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    slot._tick(50);
    slot.start({ duration: 1000 });
    slot._tick(50);
    expect(slot.completed).toBe(true);
  });

  it("rejects a duration that is not finite and positive", () => {
    expect(() => new ProcessSlot({ duration: 0 })).toThrow(
      "ProcessSlot: duration must be a finite number > 0 in seconds, got 0.",
    );
    expect(() => new ProcessSlot({ duration: NaN })).toThrow("got NaN");
    const slot = new ProcessSlot({ duration: 1 });
    expect(() => slot.start({ duration: -2 })).toThrow(
      "ProcessSlot.start: duration must be a finite number > 0 in seconds, got -2.",
    );
  });

  it("completes on the tick that reaches a duration made of exact steps", () => {
    const slot = new ProcessSlot({ duration: 0.25 });
    slot.start();
    let ticks = 0;
    while (!slot.completed && ticks < 20) {
      slot._tick(1 / 60);
      ticks++;
    }
    expect(ticks).toBe(15);
    expect(slot.ratio).toBe(1);
  });

  it("a cleanup that restarts its own slot does not recurse", () => {
    let restarts = 0;
    const slot: ProcessSlot = new ProcessSlot({
      duration: 100,
      cleanup: () => {
        if (restarts < 3) {
          restarts++;
          slot.restart();
        }
      },
    });
    slot.start();
    slot.cancel();
    expect(restarts).toBe(1);
    expect(slot.completed).toBe(false);
    expect(slot.elapsed).toBe(0);
  });

  it("a throwing cleanup still leaves the slot cancelled", () => {
    const update = vi.fn();
    const slot = new ProcessSlot({
      duration: 100,
      update,
      cleanup: () => {
        throw new Error("boom");
      },
    });
    slot.start();
    expect(() => slot.cancel()).toThrow("boom");
    expect(slot.completed).toBe(true);
    slot._tick(10);
    expect(update).not.toHaveBeenCalled();
  });

  it("pause/resume works", () => {
    const slot = new ProcessSlot({ duration: 100 });
    slot.start();
    slot._tick(30);
    slot.pause();
    expect(slot.running).toBe(false);
    expect(slot.completed).toBe(false);
    slot._tick(100); // should not advance
    expect(slot.elapsed).toBe(30);
    slot.resume();
    expect(slot.running).toBe(true);
    slot._tick(70);
    expect(slot.completed).toBe(true);
  });

  it("update callback is called each tick", () => {
    const update = vi.fn();
    const slot = new ProcessSlot({ duration: 100, update });
    slot.start();
    slot._tick(16);
    expect(update).toHaveBeenCalledWith(16, 16);
    slot._tick(16);
    expect(update).toHaveBeenCalledWith(16, 32);
  });

  it("update returning true completes early", () => {
    const slot = new ProcessSlot({
      duration: 1000,
      update: () => true,
    });
    slot.start();
    slot._tick(16);
    expect(slot.completed).toBe(true);
  });

  it("loop resets elapsed on completion", () => {
    const update = vi.fn();
    const slot = new ProcessSlot({ duration: 100, loop: true, update });
    slot.start();
    slot._tick(100);
    expect(slot.completed).toBe(false);
    expect(slot.elapsed).toBe(0);
  });

  it("onComplete() method overrides config callback", () => {
    const original = vi.fn();
    const override = vi.fn();
    const slot = new ProcessSlot({ duration: 100, onComplete: original });
    slot.onComplete(override);
    slot.start();
    slot._tick(100);
    expect(original).not.toHaveBeenCalled();
    expect(override).toHaveBeenCalledOnce();
  });

  it("ratio is 0 when no duration set", () => {
    const slot = new ProcessSlot({});
    slot.start();
    slot._tick(100);
    expect(slot.ratio).toBe(0);
  });

  it("tags are set from config", () => {
    const slot = new ProcessSlot({ tags: ["vfx", "flash"] });
    expect(slot.tags).toEqual(["vfx", "flash"]);
  });

  it("tags can be overridden via start()", () => {
    const slot = new ProcessSlot({ tags: ["old"] });
    slot.start({ tags: ["new"] });
    expect(slot.tags).toEqual(["new"]);
  });

  it("cleanup runs on complete, cancel, and restart (all three)", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 50, cleanup });

    // Natural completion
    slot.start();
    slot._tick(50);
    expect(cleanup).toHaveBeenCalledTimes(1);

    // Cancel while running
    slot.restart(); // restart from completed — no cleanup (nothing to clean up)
    slot.cancel();  // cancel while running — cleanup fires
    expect(cleanup).toHaveBeenCalledTimes(2);

    // Restart while running
    slot.restart(); // restart from completed — no cleanup
    slot._tick(10);
    slot.restart(); // restart while running — cleanup fires
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  describe("_tick return value", () => {
    it("returns the update callback's result", () => {
      const slot = new ProcessSlot({ update: () => true });
      slot.start();
      expect(slot._tick(16)).toBe(true);
    });

    it("returns a rejected thenable from an async update callback unchanged, so a caller can attach a rejection handler", async () => {
      const rejection = Promise.reject(new Error("boom"));
      const slot = new ProcessSlot({
        // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
        update: (() => rejection) as unknown as (dt: number, elapsed: number) => boolean | void,
      });
      slot.start();

      const result = slot._tick(16);
      expect(result).toBe(rejection);

      // Attach a handler so the rejection doesn't surface as unhandled.
      await expect(result).rejects.toThrow("boom");
    });
  });
});
