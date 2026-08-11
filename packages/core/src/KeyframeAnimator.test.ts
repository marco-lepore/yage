import { describe, it, expect, vi } from "vitest";
import { KeyframeAnimator } from "./KeyframeAnimator.js";
import type { KeyframeAnimationDef } from "./KeyframeAnimator.js";
import { ProcessComponent } from "./ProcessComponent.js";
import { Process } from "./Process.js";
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

  it("setter is optional — keyframe `event` callbacks still fire (pure-timeline use case)", () => {
    const { entity, pc } = setup();
    const onMid = vi.fn();
    const anim = entity.add(
      new KeyframeAnimator({
        beat: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 50, data: 1, event: onMid },
            { time: 100, data: 0 },
          ],
        },
      }),
    );

    anim.play("beat");
    pc._tick(60);
    expect(onMid).toHaveBeenCalledOnce();
    pc._tick(100); // past completion
    expect(anim.isPlaying("beat")).toBe(false);
  });

  it("accepts a Record<string, KeyframeAnimationDef<number>> without per-key casts", () => {
    // Compile-time check: the def is typed with a narrow setter parameter
    // (`number`, not `Interpolatable`). With method-syntax bivariance the
    // record flows into the constructor unchanged.
    const { entity, pc } = setup();
    let value = 0;
    const defs: Record<"bob", KeyframeAnimationDef<number>> = {
      bob: {
        keyframes: [
          { time: 0, data: 0 },
          { time: 100, data: 10 },
        ],
        setter(v: number) {
          value = v;
        },
      },
    };
    const anim = entity.add(new KeyframeAnimator(defs));
    anim.play("bob");
    pc._tick(50);
    expect(value).toBeCloseTo(5);
  });

  describe("clock", () => {
    it("a fixed-clock animation only advances on fixed ticks", () => {
      const { entity, pc } = setup();
      let value = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          bob: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              value = v as number;
            },
            clock: "fixed",
          },
        }),
      );

      anim.play("bob");
      pc._tick(50);
      expect(value).toBe(0);
      expect(anim.isPlaying("bob")).toBe(true);

      pc._tick(50, undefined, "fixed");
      expect(value).toBeCloseTo(5);
    });

    it("a def with no clock stays on the frame clock", () => {
      const { entity, pc } = setup();
      let value = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          bob: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              value = v as number;
            },
          },
        }),
      );

      anim.play("bob");
      pc._tick(0.02, undefined, "fixed");
      expect(value).toBe(0);

      pc._tick(50);
      expect(value).toBeCloseTo(5);
    });

    it("the clock is per animation — one animator holds a frame-clock visual and a fixed-clock timeline", () => {
      const { entity, pc } = setup();
      let visual = 0;
      const beat = vi.fn();
      const anim = entity.add(
        new KeyframeAnimator({
          fade: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              visual = v as number;
            },
          },
          timeline: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 50, data: 1, event: beat },
              { time: 100, data: 0 },
            ],
            clock: "fixed",
          },
        }),
      );

      anim.play("fade");
      anim.play("timeline");

      pc._tick(60);
      expect(visual).toBeCloseTo(6);
      expect(beat).not.toHaveBeenCalled();

      pc._tick(60, undefined, "fixed");
      expect(beat).toHaveBeenCalledOnce();
      expect(visual).toBeCloseTo(6);
    });

    it("a setter-less fixed-clock timeline fires its keyframe event once, on the fixed tick that crosses it", () => {
      const { entity, pc } = setup();
      const beat = vi.fn();
      const anim = entity.add(
        new KeyframeAnimator({
          timeline: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 50, data: 1, event: beat },
              { time: 100, data: 0 },
            ],
            clock: "fixed",
          },
        }),
      );

      anim.play("timeline");
      pc._tick(60);
      expect(beat).not.toHaveBeenCalled();

      pc._tick(30, undefined, "fixed");
      expect(beat).not.toHaveBeenCalled();

      pc._tick(30, undefined, "fixed");
      expect(beat).toHaveBeenCalledOnce();

      pc._tick(30, undefined, "fixed");
      expect(beat).toHaveBeenCalledOnce();
    });

    it("natural completion on the fixed clock calls onExit(true)", () => {
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
            clock: "fixed",
            onExit,
          },
        }),
      );

      anim.play("flash");
      pc._tick(100);
      expect(onExit).not.toHaveBeenCalled();
      expect(anim.isPlaying("flash")).toBe(true);

      pc._tick(100, undefined, "fixed");
      expect(onExit).toHaveBeenCalledWith(true);
      expect(anim.isPlaying("flash")).toBe(false);
    });

    it("stop() cancels a fixed-clock animation and no later fixed tick calls its setter", () => {
      const { entity, pc } = setup();
      const onExit = vi.fn();
      let value = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          bob: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              value = v as number;
            },
            clock: "fixed",
            onExit,
          },
        }),
      );

      anim.play("bob");
      pc._tick(30, undefined, "fixed");
      expect(value).toBeCloseTo(3);

      anim.stop("bob");
      expect(anim.isPlaying("bob")).toBe(false);
      expect(onExit).toHaveBeenCalledWith(false);

      pc._tick(30, undefined, "fixed");
      expect(value).toBeCloseTo(3);
    });

    it("stopAll() cancels a mixed frame/fixed pair", () => {
      const { entity, pc } = setup();
      const exitFade = vi.fn();
      const exitTimeline = vi.fn();
      let fade = 0;
      let timeline = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          fade: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              fade = v as number;
            },
            onExit: exitFade,
          },
          timeline: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              timeline = v as number;
            },
            clock: "fixed",
            onExit: exitTimeline,
          },
        }),
      );

      anim.play("fade");
      anim.play("timeline");

      // Each animation only moves on its own clock, so the pair really is
      // split across the two pools before stopAll() has to reach both.
      pc._tick(20);
      expect(fade).toBeCloseTo(2);
      expect(timeline).toBe(0);
      pc._tick(30, undefined, "fixed");
      expect(fade).toBeCloseTo(2);
      expect(timeline).toBeCloseTo(3);

      anim.stopAll();

      expect(anim.isPlaying("fade")).toBe(false);
      expect(anim.isPlaying("timeline")).toBe(false);
      expect(exitFade).toHaveBeenCalledWith(false);
      expect(exitTimeline).toHaveBeenCalledWith(false);
      expect(pc.count).toBe(0);

      pc._tick(20);
      pc._tick(30, undefined, "fixed");
      expect(fade).toBeCloseTo(2);
      expect(timeline).toBeCloseTo(3);
    });

    it("onDestroy() cancels a mixed frame/fixed pair", () => {
      const { entity, pc } = setup();
      const exitFade = vi.fn();
      const exitTimeline = vi.fn();
      let fade = 0;
      let timeline = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          fade: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              fade = v as number;
            },
            onExit: exitFade,
          },
          timeline: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              timeline = v as number;
            },
            clock: "fixed",
            onExit: exitTimeline,
          },
        }),
      );

      anim.play("fade");
      anim.play("timeline");

      pc._tick(20);
      expect(fade).toBeCloseTo(2);
      expect(timeline).toBe(0);
      pc._tick(30, undefined, "fixed");
      expect(timeline).toBeCloseTo(3);

      anim.onDestroy();

      expect(exitFade).toHaveBeenCalledWith(false);
      expect(exitTimeline).toHaveBeenCalledWith(false);
      expect(pc.count).toBe(0);

      pc._tick(20);
      pc._tick(30, undefined, "fixed");
      expect(fade).toBeCloseTo(2);
      expect(timeline).toBeCloseTo(3);
    });

    it("play() restarts a fixed-clock animation on its own clock", () => {
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
            setter: (v) => {
              value = v as number;
            },
            clock: "fixed",
            onEnter,
            onExit,
          },
        }),
      );

      anim.play("bob");
      pc._tick(80, undefined, "fixed");
      expect(value).toBeCloseTo(8);

      anim.play("bob");
      expect(onExit).toHaveBeenCalledWith(false);
      expect(onEnter).toHaveBeenCalledTimes(2);

      pc._tick(50, undefined, "fixed");
      expect(value).toBeCloseTo(5);
    });

    it("a fixed-clock animation started from inside a fixed-pool process gets that step's dt", () => {
      const { entity, pc } = setup();
      let value = 0;
      const anim = entity.add(
        new KeyframeAnimator({
          bob: {
            keyframes: [
              { time: 0, data: 0 },
              { time: 100, data: 10 },
            ],
            setter: (v) => {
              value = v as number;
            },
            clock: "fixed",
          },
        }),
      );

      // ProcessComponent ticks a Set, and a Set iterator visits entries added
      // during iteration — so an animation started from another fixed-pool
      // process advances on the same step. The frame pool behaves the same way.
      pc.run(
        new Process({
          update: () => {
            anim.play("bob");
            return true;
          },
        }),
        { clock: "fixed" },
      );

      pc._tick(50, undefined, "fixed");
      expect(value).toBeCloseTo(5);
    });
  });
});
