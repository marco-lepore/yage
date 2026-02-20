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
  it("defaults to ~60fps fixed timestep", () => {
    const loop = new GameLoop();
    expect(loop.fixedTimestep).toBeCloseTo(1000 / 60);
  });

  it("defaults maxFixedStepsPerFrame to 5", () => {
    const loop = new GameLoop();
    expect(loop.maxFixedStepsPerFrame).toBe(5);
  });

  it("accepts custom config", () => {
    const loop = new GameLoop({
      fixedTimestep: 20,
      maxFixedStepsPerFrame: 3,
    });
    expect(loop.fixedTimestep).toBe(20);
    expect(loop.maxFixedStepsPerFrame).toBe(3);
  });

  describe("tick()", () => {
    it("calls phases in correct order", () => {
      const loop = new GameLoop({ fixedTimestep: 16 });
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

    it("runs multiple fixed steps when dt > fixedTimestep", () => {
      const loop = new GameLoop({ fixedTimestep: 10 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(25); // Should run 2 fixed steps (25 / 10 = 2, remainder 5)
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(2);
      expect(cbs.fixedUpdate).toHaveBeenCalledWith(10);
    });

    it("accumulates remainder across frames", () => {
      const loop = new GameLoop({ fixedTimestep: 10 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(8); // accumulator = 8, no fixed step
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(0);
      loop.tick(5); // accumulator = 13, one fixed step
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(1);
    });

    it("caps fixed steps at maxFixedStepsPerFrame", () => {
      const loop = new GameLoop({ fixedTimestep: 10, maxFixedStepsPerFrame: 3 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(100); // Would be 10 steps, capped at 3
      expect(cbs.fixedUpdate).toHaveBeenCalledTimes(3);
    });

    it("passes dt to non-fixed phases", () => {
      const loop = new GameLoop({ fixedTimestep: 16 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(20);
      expect(cbs.earlyUpdate).toHaveBeenCalledWith(20);
      expect(cbs.update).toHaveBeenCalledWith(20);
      expect(cbs.lateUpdate).toHaveBeenCalledWith(20);
      expect(cbs.render).toHaveBeenCalledWith(20);
      expect(cbs.endOfFrame).toHaveBeenCalledWith(20);
    });

    it("passes fixedTimestep to fixedUpdate", () => {
      const loop = new GameLoop({ fixedTimestep: 16 });
      const cbs = createCallbacks();
      loop.setCallbacks(cbs);
      loop.start();
      loop.tick(16);
      expect(cbs.fixedUpdate).toHaveBeenCalledWith(16);
    });

    it("does nothing without callbacks", () => {
      const loop = new GameLoop();
      expect(() => loop.tick(16)).not.toThrow();
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
        const loop = new GameLoop({ fixedTimestep: 16 });
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
        const loop = new GameLoop({ fixedTimestep: 16 });
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

  describe("attachTicker", () => {
    it("uses external ticker instead of rAF", () => {
      const loop = new GameLoop({ fixedTimestep: 16 });
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
