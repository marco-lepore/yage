import { describe, it, expect, vi } from "vitest";
import { GameLoop } from "./GameLoop.js";
import type { GameLoopCallbacks } from "./GameLoop.js";

function createCallbacks() {
  return {
    earlyUpdate: vi.fn(),
    fixedUpdate: vi.fn(),
    update: vi.fn(),
    lateUpdate: vi.fn(),
    render: vi.fn(),
    endOfFrame: vi.fn(),
  } satisfies GameLoopCallbacks;
}

describe("GameLoop", () => {
  it("defaults to ~60fps fixed timestep in seconds", () => {
    const loop = new GameLoop();
    expect(loop.fixedTimestep).toBeCloseTo(1 / 60);
  });

  it("defaults maxFixedStepsPerFrame to 5", () => {
    const loop = new GameLoop();
    expect(loop.maxFixedStepsPerFrame).toBe(5);
  });

  it("accepts custom config", () => {
    const loop = new GameLoop({
      fixedTimestep: 0.02,
      maxFixedStepsPerFrame: 3,
    });
    expect(loop.fixedTimestep).toBe(0.02);
    expect(loop.maxFixedStepsPerFrame).toBe(3);
  });

  describe("tick()", () => {
    it("calls phases in correct order", () => {
      const loop = new GameLoop({ fixedTimestep: 0.016 });
      const order: string[] = [];
      loop.setCallbacks({
        earlyUpdate: () => order.push("early"),
        fixedUpdate: () => order.push("fixed"),
        update: () => order.push("update"),
        lateUpdate: () => order.push("late"),
        render: () => order.push("render"),
        endOfFrame: () => order.push("end"),
      });
      loop.start();
      loop.tick(16);
      expect(order).toEqual(["early", "fixed", "update", "late", "render", "end"]);
    });

    it("converts the incoming ms delta to seconds for variable phases", () => {
      const loop = new GameLoop({ fixedTimestep: 0.016 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(20); // 20ms → 0.02s
      expect(cbs.earlyUpdate).toHaveBeenCalledWith(0.02);
      expect(cbs.update).toHaveBeenCalledWith(0.02);
      expect(cbs.lateUpdate).toHaveBeenCalledWith(0.02);
      expect(cbs.render).toHaveBeenCalledWith(0.02);
      expect(cbs.endOfFrame).toHaveBeenCalledWith(0.02);
    });

    it("runs multiple fixed steps when dt > fixedTimestep", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(25); // 0.025s → 2 fixed steps, remainder 0.005s
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(2);
      expect(cbs.fixedUpdate).toHaveBeenCalledWith(0.01);
    });

    it("accumulates remainder across frames", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(8); // accumulator = 0.008s, no fixed step
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(0);
      loop.tick(5); // accumulator = 0.013s, one fixed step
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(1);
    });

    it("caps fixed steps at maxFixedStepsPerFrame", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01, maxFixedStepsPerFrame: 3 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(100); // 0.1s would be 10 steps, capped at 3
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(3);
    });

    it("passes fixedTimestep (seconds) to fixedUpdate", () => {
      const loop = new GameLoop({ fixedTimestep: 0.016 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(16);
      expect(cbs.fixedUpdate).toHaveBeenCalledWith(0.016);
    });

    it("does nothing without callbacks", () => {
      const loop = new GameLoop();
      expect(() => loop.tick(16)).not.toThrow();
    });

    it("ignores ticks before start", () => {
      const loop = new GameLoop({ fixedTimestep: 0.016 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);

      loop.tick(16);

      expect(cbs.earlyUpdate).not.toHaveBeenCalled();
      expect(cbs.fixedUpdate).not.toHaveBeenCalled();
      expect(cbs.update).not.toHaveBeenCalled();
      expect(cbs.lateUpdate).not.toHaveBeenCalled();
      expect(cbs.render).not.toHaveBeenCalled();
      expect(cbs.endOfFrame).not.toHaveBeenCalled();
      expect(loop.frameCount).toBe(0);
      expect(loop.interpolationAlpha).toBe(0);
    });

    it("increments frame count", () => {
      const loop = new GameLoop();
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      expect(loop.frameCount).toBe(0);
      loop.tick(16);
      expect(loop.frameCount).toBe(1);
      loop.tick(16);
      expect(loop.frameCount).toBe(2);
    });

    it("reaches a seconds-based timer threshold after the expected frame count", () => {
      // Regression: a component doing `timer += dt` against a 0.28s threshold
      // must take ~17 frames at 60fps, not a single frame (which is what
      // happened when dt was delivered in milliseconds).
      const loop = new GameLoop({ fixedTimestep: 1 / 60 });
      let timer = 0;
      let firedAtFrame = -1;
      let frame = 0;
      loop.setCallbacks({
        ...createCallbacks(),
        update: (dt) => {
          timer += dt;
          frame++;
          if (firedAtFrame < 0 && timer >= 0.28) firedAtFrame = frame;
        },
      });
      loop.start();
      for (let i = 0; i < 30; i++) loop.tick(1000 / 60);
      // 0.28 / (1/60) ≈ 16.8 → first crossed on frame 17.
      expect(firedAtFrame).toBe(17);
    });
  });

  describe("start/stop", () => {
    it("start sets running to true", () => {
      const loop = new GameLoop();
      expect(loop.isRunning).toBe(false);
      loop.start();
      expect(loop.isRunning).toBe(true);
      loop.stop();
    });

    it("stop sets running to false", () => {
      const loop = new GameLoop();
      loop.start();
      loop.stop();
      expect(loop.isRunning).toBe(false);
    });

    it("start resets frame count and accumulator", () => {
      const loop = new GameLoop();
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(16);
      expect(loop.frameCount).toBe(1);
      loop.stop();
      loop.start();
      expect(loop.frameCount).toBe(0);
    });

    it("double start is a no-op", () => {
      const loop = new GameLoop();
      loop.start();
      loop.start(); // should not throw
      loop.stop();
    });
  });

  describe("requestAnimationFrame path", () => {
    it("uses rAF when no ticker is attached and rAF is available", () => {
      // Mock rAF and cAF on globalThis
      const rafCallbacks: Array<(now: number) => void> = [];
      let nextRafId = 1;
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;
      const originalPerf = globalThis.performance;

      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafCallbacks.push(cb);
        return id;
      };
      globalThis.cancelAnimationFrame = vi.fn();
      // Ensure performance.now() exists
      if (!globalThis.performance) {
        globalThis.performance = { now: () => 0 } as Performance;
      }

      try {
        const loop = new GameLoop({ fixedTimestep: 0.016 });
        const cbs = createCallbacks();
        loop.setCallbacks(cbs);
        loop.start();

        // rAF should have been called once for the initial frame
        expect(rafCallbacks.length).toBe(1);

        // Simulate a frame at 16ms
        const firstCallback = rafCallbacks[0];
        if (firstCallback) {
          firstCallback(16);
        }

        // After the loop callback, it should have called rAF again
        expect(rafCallbacks.length).toBe(2);
        // And the tick should have fired
        expect(cbs.update).toHaveBeenCalledOnce();

        loop.stop();
        // cancelAnimationFrame should have been called
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      } finally {
        // Restore originals
        if (originalRAF) {
          globalThis.requestAnimationFrame = originalRAF;
        } else {
          delete (globalThis as Record<string, unknown>)["requestAnimationFrame"];
        }
        if (originalCAF) {
          globalThis.cancelAnimationFrame = originalCAF;
        } else {
          delete (globalThis as Record<string, unknown>)["cancelAnimationFrame"];
        }
        if (originalPerf !== globalThis.performance) {
          (globalThis as Record<string, unknown>)["performance"] = originalPerf;
        }
      }
    });

    it("rAF loop stops when running is set to false", () => {
      const rafCallbacks: Array<(now: number) => void> = [];
      let nextRafId = 1;
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCAF = globalThis.cancelAnimationFrame;

      globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafCallbacks.push(cb);
        return id;
      };
      globalThis.cancelAnimationFrame = vi.fn();

      try {
        const loop = new GameLoop({ fixedTimestep: 0.016 });
        const cbs = createCallbacks();
        loop.setCallbacks(cbs);
        loop.start();

        // Stop the loop before the first rAF callback fires
        loop.stop();

        // Now invoke the queued rAF callback - it should bail because running=false
        const firstCallback = rafCallbacks[0];
        if (firstCallback) {
          firstCallback(16);
        }

        // The tick should NOT have been called since the loop was stopped
        expect(cbs.update).not.toHaveBeenCalled();
      } finally {
        if (originalRAF) {
          globalThis.requestAnimationFrame = originalRAF;
        } else {
          delete (globalThis as Record<string, unknown>)["requestAnimationFrame"];
        }
        if (originalCAF) {
          globalThis.cancelAnimationFrame = originalCAF;
        } else {
          delete (globalThis as Record<string, unknown>)["cancelAnimationFrame"];
        }
      }
    });
  });

  describe("interpolationAlpha", () => {
    it("is 0 initially", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      loop.start();
      expect(loop.interpolationAlpha).toBe(0);
      loop.stop();
    });

    it("returns correct ratio after partial tick", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(7); // accumulator = 0.007s, no fixed step → alpha = 0.7
      expect(loop.interpolationAlpha).toBeCloseTo(0.7);
    });

    it("is 0 after exact fixed step", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(10); // accumulator = 0.01s, one fixed step, remainder = 0
      expect(loop.interpolationAlpha).toBeCloseTo(0);
    });

    it("returns remainder ratio after overshoot", () => {
      const loop = new GameLoop({ fixedTimestep: 0.01 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(13); // accumulator = 0.013s, one step, remainder 0.003s → alpha 0.3
      expect(loop.interpolationAlpha).toBeCloseTo(0.3);
    });
  });

  describe("attachTicker", () => {
    it("uses external ticker instead of rAF", () => {
      const loop = new GameLoop({ fixedTimestep: 0.016 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);

      let tickFn: ((dt: number) => void) | null = null;
      loop.attachTicker((cb) => {
        tickFn = cb;
        return () => {
          tickFn = null;
        };
      });

      loop.start();
      // Manually invoke the ticker callback
      if (tickFn === null) throw new Error("tickFn should be set");
      (tickFn as (dt: number) => void)(16);
      expect(cbs.update).toHaveBeenCalledOnce();
    });

    it("stop unsubscribes from ticker", () => {
      const loop = new GameLoop();
      const unsub = vi.fn();
      loop.attachTicker(() => unsub);
      loop.start();
      loop.stop();
      expect(unsub).toHaveBeenCalledOnce();
    });
  });
});
