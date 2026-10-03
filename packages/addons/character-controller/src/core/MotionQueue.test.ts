import { describe, expect, it } from "vitest";
import { MotionQueue } from "./MotionQueue.js";
import { resolveMotion } from "./MotionIntent.js";
import type { MotionIntent } from "./MotionIntent.js";
const intent = (
  source: string,
  target: number,
  priority = 1,
): MotionIntent => ({
  source,
  target,
  priority,
  axis: "y",
  acceleration: Infinity,
});

describe("motion requests", () => {
  it("preserves one-time moves through frozen steering and consumes them once", () => {
    const queue = new MotionQueue();
    const command = queue.submitOnce(intent("jump", -300));
    for (let i = 0; i < 8; i++) {
      queue.submit(intent("gravity", 500, 0));
      queue.discardContinuous();
    }
    expect(command.active).toBe(true);
    expect(resolveMotion(queue.intents, { x: 0, y: 350 }, 1 / 60).y).toBe(-300);
    queue.resolved();
    expect(command.active).toBe(false);
    expect(queue.intents).toEqual([]);
  });
  it("keeps an ended hold until its first resolution, but cancellation withdraws it", () => {
    const queue = new MotionQueue();
    const held = queue.submitDurable(intent("dash", 100));
    held.end();
    expect(held.active).toBe(true);
    queue.resolved();
    expect(held.active).toBe(false);
    const cancelled = queue.submitDurable(intent("dash", 100));
    cancelled.end();
    cancelled.cancel();
    expect(queue.intents).toEqual([]);
  });
  it("holds across resolutions and isolates stale handles", () => {
    const queue = new MotionQueue();
    const old = queue.submitDurable(intent("old", 1));
    queue.resolved();
    queue.resolved();
    expect(old.active).toBe(true);
    queue.cancelAll();
    const current = queue.submitDurable(intent("current", 2));
    old.end();
    old.cancel();
    expect(current.active).toBe(true);
    current.end();
    expect(current.active).toBe(true);
    queue.resolved();
    expect(current.active).toBe(false);
  });
  it("consumes refused commands and reports the owner", () => {
    const queue = new MotionQueue();
    const jump = queue.submitOnce(intent("jump", -300));
    const hit = queue.submitDurable(intent("hit", 100, 2));
    expect(
      resolveMotion(queue.intents, { x: 0, y: 0 }, 1 / 60).refused,
    ).toEqual([{ source: "jump", axis: "y", outrankedBy: "hit" }]);
    queue.resolved();
    hit.end();
    expect(jump.active).toBe(false);
    expect(queue.intents).toEqual([]);
  });
  it("copies requests and rejects invalid values before insertion", () => {
    const queue = new MotionQueue();
    const request = { ...intent("jump", -300) };
    queue.submit(request);
    request.target = NaN;
    expect(queue.intents[0]?.target).toBe(-300);
    expect(() => queue.submitOnce(request)).toThrow(/target/);
    expect(queue.intents).toHaveLength(1);
  });
});
