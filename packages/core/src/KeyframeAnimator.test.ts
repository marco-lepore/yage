import { describe, it, expect, vi } from "vitest";
import { KeyframeAnimator } from "./KeyframeAnimator.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Entity } from "./Entity.js";

function setup() {
  const entity = new Entity("test");
  const pc = new ProcessComponent();
  entity.add(pc);
  return { entity, pc };
}

describe("KeyframeAnimator", () => {
  it("play() starts an animation that updates via ProcessComponent", () => {
    const { entity, pc } = setup();
    let value = 0;
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: (v) => { value = v as number; },
        },
      }),
    );

    anim.play("bob");
    pc._tick(50);
    expect(value).toBeCloseTo(5);
  });

  it("isPlaying() returns true for active animations", () => {
    const { entity, pc } = setup();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
        },
      }),
    );

    expect(anim.isPlaying("bob")).toBe(false);
    anim.play("bob");
    expect(anim.isPlaying("bob")).toBe(true);
    pc._tick(100);
    expect(anim.isPlaying("bob")).toBe(false);
  });

  it("stop() stops animation and calls onExit(false)", () => {
    const { entity, pc } = setup();
    const onExit = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
          onExit,
        },
      }),
    );

    anim.play("bob");
    pc._tick(30);
    anim.stop("bob");
    expect(anim.isPlaying("bob")).toBe(false);
    expect(onExit).toHaveBeenCalledWith(false);
  });

  it("natural completion calls onExit(true)", () => {
    const { entity, pc } = setup();
    const onExit = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        flash: {
          keyframes: [
            { time: 0, data: 1 },
            { time: 100, data: 0 },
          ],
          setter: () => {},
          onExit,
        },
      }),
    );

    anim.play("flash");
    pc._tick(100);
    expect(onExit).toHaveBeenCalledWith(true);
    expect(anim.isPlaying("flash")).toBe(false);
  });

  it("stopAll() stops all animations", () => {
    const { entity, pc } = setup();
    const exitBob = vi.fn();
    const exitPulse = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
          onExit: exitBob,
        },
        pulse: {
          keyframes: [
            { time: 0, data: 1 },
            { time: 200, data: 1.5 },
          ],
          setter: () => {},
          onExit: exitPulse,
        },
      }),
    );

    anim.play("bob");
    anim.play("pulse");
    pc._tick(10);
    anim.stopAll();
    expect(anim.isPlaying("bob")).toBe(false);
    expect(anim.isPlaying("pulse")).toBe(false);
    expect(exitBob).toHaveBeenCalledWith(false);
    expect(exitPulse).toHaveBeenCalledWith(false);
  });

  it("concurrent animations run simultaneously", () => {
    const { entity, pc } = setup();
    let bobVal = 0;
    let pulseVal = 0;
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: (v) => { bobVal = v as number; },
        },
        pulse: {
          keyframes: [
            { time: 0, data: 1 },
            { time: 100, data: 2 },
          ],
          setter: (v) => { pulseVal = v as number; },
        },
      }),
    );

    anim.play("bob");
    anim.play("pulse");
    pc._tick(50);
    expect(bobVal).toBeCloseTo(5);
    expect(pulseVal).toBeCloseTo(1.5);
  });

  it("play() restarts if already playing", () => {
    const { entity, pc } = setup();
    const onEnter = vi.fn();
    const onExit = vi.fn();
    let value = 0;
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: (v) => { value = v as number; },
          onEnter,
          onExit,
        },
      }),
    );

    anim.play("bob");
    pc._tick(80);
    expect(value).toBeCloseTo(8);

    // Restart — should call onExit(false) then onEnter
    anim.play("bob");
    expect(onExit).toHaveBeenCalledWith(false);
    expect(onEnter).toHaveBeenCalledTimes(2);

    // Value resets to interpolated from 0
    pc._tick(50);
    expect(value).toBeCloseTo(5);
  });

  it("onEnter is called on play", () => {
    const { entity } = setup();
    const onEnter = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
          onEnter,
        },
      }),
    );

    anim.play("bob");
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("onDestroy() calls stopAll", () => {
    const { entity, pc } = setup();
    const onExit = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
          onExit,
        },
      }),
    );

    anim.play("bob");
    pc._tick(10);
    anim.onDestroy();
    expect(anim.isPlaying("bob")).toBe(false);
    expect(onExit).toHaveBeenCalledWith(false);
  });

  it("stop on non-playing animation is a no-op", () => {
    const { entity } = setup();
    const anim = entity.add(
      new KeyframeAnimator({
        bob: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 100, data: 10 },
          ],
          setter: () => {},
        },
      }),
    );

    // Should not throw
    anim.stop("bob");
    expect(anim.isPlaying("bob")).toBe(false);
  });
});
