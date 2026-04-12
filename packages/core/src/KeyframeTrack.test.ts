import { describe, it, expect, vi } from "vitest";
import { createKeyframeTrack } from "./KeyframeTrack.js";
import { easeInQuad } from "./Process.js";

describe("createKeyframeTrack", () => {
  it("interpolates between 2 keyframes", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 10 },
      ],
      setter: (v) => { value = v; },
    });
    proc._update(50);
    expect(value).toBeCloseTo(5);
  });

  it("completes at the end of a non-looping track", () => {
    let value = 0;
    const onComplete = vi.fn();
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 10 },
      ],
      setter: (v) => { value = v; },
      onComplete,
    });
    proc._update(100);
    expect(value).toBeCloseTo(10);
    expect(proc.completed).toBe(true);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("selects the correct segment for multi-keyframe tracks", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 10 },
        { time: 200, data: 30 },
      ],
      setter: (v) => { value = v; },
    });
    // At t=150, we're in segment [100→200], halfway: 10 + (30-10)*0.5 = 20
    proc._update(150);
    expect(value).toBeCloseTo(20);
  });

  it("applies per-keyframe easing", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0, easing: easeInQuad },
        { time: 100, data: 100 },
      ],
      setter: (v) => { value = v; },
    });
    // At t=50, segT=0.5, easeInQuad(0.5)=0.25 → value=25
    proc._update(50);
    expect(value).toBeCloseTo(25);
  });

  it("applies track-level default easing", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 100 },
      ],
      setter: (v) => { value = v; },
      easing: easeInQuad,
    });
    proc._update(50);
    expect(value).toBeCloseTo(25);
  });

  it("per-keyframe easing overrides track default", () => {
    let value = 0;
    // Track default is easeInQuad, but keyframe overrides with linear (identity)
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0, easing: (t) => t },
        { time: 100, data: 100 },
      ],
      setter: (v) => { value = v; },
      easing: easeInQuad,
    });
    proc._update(50);
    expect(value).toBeCloseTo(50); // linear, not easeInQuad
  });

  it("fires keyframe events once per pass", () => {
    const event = vi.fn();
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 50, data: 5, event },
        { time: 100, data: 10 },
      ],
      setter: () => {},
    });
    proc._update(60);
    expect(event).toHaveBeenCalledOnce();
    proc._update(30);
    // Still only once (no re-fire)
    expect(event).toHaveBeenCalledOnce();
  });

  it("re-fires events on loop wrap", () => {
    const event = vi.fn();
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 50, data: 5, event },
        { time: 100, data: 10 },
      ],
      setter: () => {},
      loop: true,
    });
    proc._update(60); // fire event at t=50
    expect(event).toHaveBeenCalledOnce();
    proc._update(50); // wraps past 100 → firedEvents cleared, elapsed = 10
    // Event already fired this cycle, not re-fired on wrap; but set is cleared
    expect(event).toHaveBeenCalledOnce();
    proc._update(50); // elapsed now ~60, passes t=50 again in new cycle
    expect(event).toHaveBeenCalledTimes(2);
  });

  it("loops correctly", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 10 },
      ],
      setter: (v) => { value = v; },
      loop: true,
    });
    proc._update(150); // wraps to 50 (setter skipped on wrap frame)
    expect(proc.completed).toBe(false);
    proc._update(0); // next tick interpolates at wrapped position (50)
    expect(value).toBeCloseTo(5);
  });

  it("speed multiplier scales time", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 100, data: 10 },
      ],
      setter: (v) => { value = v; },
      speed: 2,
    });
    // dt=25, but speed=2 → internal elapsed = 50
    proc._update(25);
    expect(value).toBeCloseTo(5);
  });

  it("duration override extends track beyond last keyframe", () => {
    let value = 0;
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 50, data: 10 },
      ],
      setter: (v) => { value = v; },
      duration: 100,
    });
    // At t=50, reaches last keyframe value=10
    proc._update(50);
    expect(value).toBeCloseTo(10);
    // Still not complete at t=50 because duration is 100
    expect(proc.completed).toBe(false);
    proc._update(50);
    expect(proc.completed).toBe(true);
  });

  it("fires unfired events on non-loop completion (big dt skip)", () => {
    const event = vi.fn();
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0 },
        { time: 50, data: 5, event },
        { time: 100, data: 10 },
      ],
      setter: () => {},
    });
    // Jump straight past the end
    proc._update(200);
    expect(event).toHaveBeenCalledOnce();
    expect(proc.completed).toBe(true);
  });

  it("does not double-fire events on loop wrap when event time <= wrapped elapsed", () => {
    const event = vi.fn();
    const proc = createKeyframeTrack({
      keyframes: [
        { time: 0, data: 0, event },
        { time: 100, data: 10 },
      ],
      setter: () => {},
      loop: true,
    });
    // wraps to 10; time=0 event should fire exactly once
    proc._update(110);
    expect(event).toHaveBeenCalledOnce();
  });

  it("throws if duration is 0", () => {
    expect(() =>
      createKeyframeTrack({
        keyframes: [
          { time: 0, data: 0 },
          { time: 0, data: 10 },
        ],
        setter: () => {},
      }),
    ).toThrow("duration must be > 0");
  });
});
