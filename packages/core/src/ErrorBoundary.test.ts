import { describe, it, expect, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { System } from "./System.js";
import { Component } from "./Component.js";
import { Logger, LogLevel } from "./Logger.js";
import { Phase } from "./types.js";

class TestSystem extends System {
  readonly phase = Phase.Update;
  update(): void {
    /* noop */
  }
}

class TestComponent extends Component {}

describe("ErrorBoundary", () => {
  function createBoundary() {
    const logger = new Logger({ level: LogLevel.Debug });
    const boundary = new ErrorBoundary(logger);
    return { boundary, logger };
  }

  describe("wrapSystem", () => {
    it("executes fn normally when no error", () => {
      const { boundary } = createBoundary();
      const sys = new TestSystem();
      const fn = vi.fn();
      boundary.wrapSystem(sys, fn);
      expect(fn).toHaveBeenCalledOnce();
      expect(sys.enabled).toBe(true);
    });

    it("rethrows, records the failure, and never disables the system", () => {
      const { boundary, logger } = createBoundary();
      const sys = new TestSystem();
      expect(() =>
        boundary.wrapSystem(sys, () => {
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect(sys.enabled).toBe(true);
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ kind: "System TestSystem", error: "boom" });
      const logs = logger.getRecent(1);
      expect(logs[0]?.level).toBe(LogLevel.Error);
      expect(logs[0]?.message).toContain("TestSystem");
    });

    it("handles non-Error throws", () => {
      const { boundary } = createBoundary();
      const sys = new TestSystem();
      expect(() =>
        boundary.wrapSystem(sys, () => {
          throw "string error";
        }),
      ).toThrow();
      expect(boundary.getCallbackErrors()[0]?.error).toBe("string error");
    });

    it("catches a rejected thenable from an async update, re-raising it as a new unhandled rejection", async () => {
      const { boundary } = createBoundary();
      const sys = new TestSystem();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      // Cast mirrors the real mistake: `update` is typed void-returning, but
      // an `async update()` compiles against it without a diagnostic.
      boundary.wrapSystem(sys, (async () => {
        throw new Error("async system boom");
      }) as unknown as () => void);
      const reason = await rejection;
      expect((reason as Error).message).toBe("async system boom");
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "System TestSystem",
        error: "async system boom",
      });
    });
  });

  describe("wrapComponent", () => {
    it("executes fn normally when no error", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      const fn = vi.fn();
      boundary.wrapComponent(comp, fn);
      expect(fn).toHaveBeenCalledOnce();
      expect(comp.enabled).toBe(true);
    });

    it("rethrows, records the failure, and never disables the component", () => {
      const { boundary, logger } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "player" } as never;
      expect(() =>
        boundary.wrapComponent(comp, () => {
          throw new Error("crash");
        }),
      ).toThrow("crash");
      expect(comp.enabled).toBe(true);
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Component TestComponent",
        entity: "player",
        error: "crash",
      });
      const logs = logger.getRecent(1);
      expect(logs[0]?.level).toBe(LogLevel.Error);
      expect(logs[0]?.message).toContain("TestComponent");
      expect(logs[0]?.message).toContain("player");
    });

    it("handles missing entity gracefully", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      expect(() =>
        boundary.wrapComponent(comp, () => {
          throw new Error("no entity");
        }),
      ).toThrow("no entity");
      expect(comp.enabled).toBe(true);
    });

    it("handles non-Error throws in wrapComponent", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "test" } as never;
      expect(() =>
        boundary.wrapComponent(comp, () => {
          throw "string component error";
        }),
      ).toThrow();
      expect(boundary.getCallbackErrors()[0]?.error).toBe("string component error");
    });

    it("catches a rejected thenable from an async update, re-raising it as a new unhandled rejection", async () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "player" } as never;
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      boundary.wrapComponent(comp, (async () => {
        throw new Error("async component boom");
      }) as unknown as () => void);
      const reason = await rejection;
      expect((reason as Error).message).toBe("async component boom");
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Component TestComponent",
        entity: "player",
        error: "async component boom",
      });
    });
  });

  describe("wrapCallback", () => {
    it("executes fn normally when no error", () => {
      const { boundary } = createBoundary();
      const fn = vi.fn();
      boundary.wrapCallback(fn, { kind: "Test callback" });
      expect(fn).toHaveBeenCalledOnce();
      expect(boundary.getCallbackErrors()).toHaveLength(0);
    });

    it("reports and rethrows a synchronous throw", () => {
      const { boundary, logger } = createBoundary();
      expect(() =>
        boundary.wrapCallback(
          () => {
            throw new Error("boom");
          },
          { kind: "Collision handler", entity: "DoorPad" },
        ),
      ).toThrow("boom");
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Collision handler",
        entity: "DoorPad",
        error: "boom",
      });
      const logs = logger.getRecent(1);
      expect(logs[0]?.message).toBe(
        'Collision handler threw on entity "DoorPad"',
      );
    });

    it("handles non-Error throws", () => {
      const { boundary } = createBoundary();
      expect(() =>
        boundary.wrapCallback(
          () => {
            throw "string error";
          },
          { kind: "Test callback" },
        ),
      ).toThrow();
      expect(boundary.getCallbackErrors()[0]?.error).toBe("string error");
    });

    it("catches a rejected thenable from an async callback typed as void-returning, re-raising it as a new unhandled rejection", async () => {
      const { boundary } = createBoundary();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      boundary.wrapCallback(
        // Cast mirrors the real footgun: these callback types are void-returning,
        // but nothing stops a caller from passing an async function anyway.
        (async () => {
          throw new Error("async boom");
        }) as unknown as () => void,
        { kind: "Test callback" },
      );
      // The synchronous call returns immediately; the rejection settles later.
      expect(boundary.getCallbackErrors()).toHaveLength(0);
      const reason = await rejection;
      expect((reason as Error).message).toBe("async boom");
      expect(boundary.getCallbackErrors()[0]?.error).toBe("async boom");
    });

    it("caps recorded callback errors", () => {
      const { boundary } = createBoundary();
      for (let i = 0; i < 250; i++) {
        try {
          boundary.wrapCallback(
            () => {
              throw new Error(`err${i}`);
            },
            { kind: "Test callback" },
          );
        } catch {
          // wrapCallback always rethrows — the cap itself is what's under test.
        }
      }
      expect(boundary.getCallbackErrors().length).toBeLessThanOrEqual(200);
    });

    it("keeps the original Error object (not just its message) for the console entry", () => {
      const { boundary, logger } = createBoundary();
      const original = new Error("boom");
      expect(() =>
        boundary.wrapCallback(() => {
          throw original;
        }, { kind: "Test callback" }),
      ).toThrow(original);
      const logs = logger.getRecent(1);
      const data = logs[0]?.data as { error: unknown } | undefined;
      expect(data?.error).toBe(original);
      expect(data?.error).toBeInstanceOf(Error);
    });

    it("clearCallbackErrors empties the recorded list", () => {
      const { boundary } = createBoundary();
      expect(() =>
        boundary.wrapCallback(() => {
          throw new Error("boom");
        }, { kind: "Test callback" }),
      ).toThrow("boom");
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      boundary.clearCallbackErrors();
      expect(boundary.getCallbackErrors()).toHaveLength(0);
    });

    it("does not report the same error twice when it propagates through nested wraps", () => {
      const { boundary, logger } = createBoundary();
      const sys = new TestSystem();
      expect(() =>
        boundary.wrapSystem(sys, () => {
          // Mirrors a callback's throw propagating out through a system's
          // update call (e.g. a collision handler's throw reaching
          // PhysicsSystem.update, wrapped by wrapSystem in turn).
          boundary.wrapCallback(
            () => {
              throw new Error("boom");
            },
            { kind: "Collision handler", entity: "DoorPad" },
          );
        }),
      ).toThrow("boom");
      // Only wrapCallback's more specific message was logged.
      const logs = logger.getRecent(5);
      expect(logs.map((l) => l.message)).toEqual([
        'Collision handler threw on entity "DoorPad"',
      ]);
      // The error propagated through two wrap methods but is recorded once.
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });
  });

  describe("wrapLifecycleHook", () => {
    it("executes fn normally when no error", () => {
      const { boundary } = createBoundary();
      const fn = vi.fn();
      boundary.wrapLifecycleHook(fn, { kind: "Scene onEnter hook", scene: "Game" });
      expect(fn).toHaveBeenCalledOnce();
    });

    it("reports then rethrows a synchronous throw", () => {
      const { boundary } = createBoundary();
      expect(() =>
        boundary.wrapLifecycleHook(
          () => {
            throw new Error("setup failed");
          },
          { kind: "Scene onEnter hook", scene: "Game" },
        ),
      ).toThrow("setup failed");
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Scene onEnter hook",
        scene: "Game",
        error: "setup failed",
      });
    });

    it("reports (but cannot rethrow) a rejected thenable from an async hook", async () => {
      const { boundary } = createBoundary();
      expect(() =>
        boundary.wrapLifecycleHook(
          (async () => {
            throw new Error("async setup failed");
          }) as unknown as () => void,
          { kind: "Scene onEnter hook", scene: "Game" },
        ),
      ).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      expect(boundary.getCallbackErrors()[0]?.error).toBe("async setup failed");
    });
  });

  describe("reportLifecycleError", () => {
    it("records an already-caught error without invoking anything", () => {
      const { boundary } = createBoundary();
      boundary.reportLifecycleError(new Error("beforeEnter failed"), {
        kind: "Scene beforeEnter hook",
        scene: "Game",
      });
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });
  });
});
