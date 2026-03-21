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
});
