import { describe, it, expect, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { System } from "./System.js";
import { Component } from "./Component.js";
import { Logger, LogLevel } from "./Logger.js";
import { GameLoop } from "./GameLoop.js";
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
    const boundary = new ErrorBoundary(logger, "isolate");
    return { boundary, logger };
  }

  function createFatalBoundary() {
    const logger = new Logger({ level: LogLevel.Debug });
    const loop = new GameLoop();
    const boundary = new ErrorBoundary(logger, "fatal", loop);
    return { boundary, logger, loop };
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

    it("disables system and logs on error", () => {
      const { boundary, logger } = createBoundary();
      const sys = new TestSystem();
      boundary.wrapSystem(sys, () => {
        throw new Error("boom");
      });
      expect(sys.enabled).toBe(false);
      const logs = logger.getRecent(1);
      expect(logs[0]?.level).toBe(LogLevel.Error);
      expect(logs[0]?.message).toContain("TestSystem");
      expect(logs[0]?.message).toContain("disabled");
    });

    it("tracks disabled system in getDisabled", () => {
      const { boundary } = createBoundary();
      const sys = new TestSystem();
      boundary.wrapSystem(sys, () => {
        throw new Error("fail");
      });
      const disabled = boundary.getDisabled();
      expect(disabled.systems).toHaveLength(1);
      expect(disabled.systems[0]?.system).toBe(sys);
      expect(disabled.systems[0]?.error).toBe("fail");
    });

    it("handles non-Error throws", () => {
      const { boundary } = createBoundary();
      const sys = new TestSystem();
      boundary.wrapSystem(sys, () => {
        throw "string error";
      });
      expect(sys.enabled).toBe(false);
      const disabled = boundary.getDisabled();
      expect(disabled.systems[0]?.error).toBe("string error");
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

    it("disables component and logs on error", () => {
      const { boundary, logger } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "player" } as never;
      boundary.wrapComponent(comp, () => {
        throw new Error("crash");
      });
      expect(comp.enabled).toBe(false);
      const logs = logger.getRecent(1);
      expect(logs[0]?.level).toBe(LogLevel.Error);
      expect(logs[0]?.message).toContain("TestComponent");
      expect(logs[0]?.message).toContain("player");
    });

    it("tracks disabled component in getDisabled", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "enemy" } as never;
      boundary.wrapComponent(comp, () => {
        throw new Error("oops");
      });
      const disabled = boundary.getDisabled();
      expect(disabled.components).toHaveLength(1);
      expect(disabled.components[0]?.component).toBe(comp);
      expect(disabled.components[0]?.error).toBe("oops");
    });

    it("handles missing entity gracefully", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      boundary.wrapComponent(comp, () => {
        throw new Error("no entity");
      });
      expect(comp.enabled).toBe(false);
    });

    it("handles non-Error throws in wrapComponent", () => {
      const { boundary } = createBoundary();
      const comp = new TestComponent();
      comp.entity = { name: "test" } as never;
      boundary.wrapComponent(comp, () => {
        throw "string component error";
      });
      expect(comp.enabled).toBe(false);
      const disabled = boundary.getDisabled();
      expect(disabled.components[0]?.error).toBe("string component error");
    });
  });

  it("getDisabled returns empty arrays initially", () => {
    const { boundary } = createBoundary();
    const disabled = boundary.getDisabled();
    expect(disabled.systems).toHaveLength(0);
    expect(disabled.components).toHaveLength(0);
  });

  describe("wrapCallback", () => {
    it("executes fn normally when no error", () => {
      const { boundary } = createBoundary();
      const fn = vi.fn();
      boundary.wrapCallback(fn, { kind: "Test callback" }, "removed");
      expect(fn).toHaveBeenCalledOnce();
      expect(boundary.getCallbackErrors()).toHaveLength(0);
    });

    it("reports a synchronous throw and runs onError", () => {
      const { boundary, logger } = createBoundary();
      const onError = vi.fn();
      boundary.wrapCallback(
        () => {
          throw new Error("boom");
        },
        { kind: "Collision handler", entity: "DoorPad" },
        "removed",
        { onError },
      );
      expect(onError).toHaveBeenCalledOnce();
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Collision handler",
        entity: "DoorPad",
        outcome: "removed",
        error: "boom",
      });
      const logs = logger.getRecent(1);
      expect(logs[0]?.message).toBe(
        'Collision handler threw on entity "DoorPad" and was removed',
      );
    });

    it("never lets the wrapped callback's throw escape", () => {
      const { boundary } = createBoundary();
      expect(() =>
        boundary.wrapCallback(
          () => {
            throw new Error("boom");
          },
          { kind: "Test callback" },
          "removed",
        ),
      ).not.toThrow();
    });

    it("handles non-Error throws", () => {
      const { boundary } = createBoundary();
      boundary.wrapCallback(
        () => {
          throw "string error";
        },
        { kind: "Test callback" },
        "reported",
      );
      expect(boundary.getCallbackErrors()[0]?.error).toBe("string error");
    });

    it("catches a rejected thenable from an async callback typed as void-returning", async () => {
      const { boundary } = createBoundary();
      const onError = vi.fn();
      boundary.wrapCallback(
        // Cast mirrors the real footgun: these callback types are void-returning,
        // but nothing stops a caller from passing an async function anyway.
        (async () => {
          throw new Error("async boom");
        }) as unknown as () => void,
        { kind: "Test callback" },
        "removed",
        { onError },
      );
      // The synchronous call returns immediately; the rejection settles later.
      expect(boundary.getCallbackErrors()).toHaveLength(0);
      await Promise.resolve();
      await Promise.resolve();
      expect(onError).toHaveBeenCalledOnce();
      expect(boundary.getCallbackErrors()[0]?.error).toBe("async boom");
    });

    it("mutes repeat failures for the same handler+event, keeping the first report only", () => {
      const { boundary } = createBoundary();
      const handler = (): void => {
        throw new Error("boom");
      };
      const muteKey = { handler, event: "greet" };
      boundary.wrapCallback(handler, { kind: "Event bus handler" }, "muted", { muteKey });
      boundary.wrapCallback(handler, { kind: "Event bus handler" }, "muted", { muteKey });
      boundary.wrapCallback(handler, { kind: "Event bus handler" }, "muted", { muteKey });
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });

    it("mute key is scoped by event name — the same handler on a different event reports again", () => {
      const { boundary } = createBoundary();
      const handler = (): void => {
        throw new Error("boom");
      };
      boundary.wrapCallback(handler, { kind: "Event bus handler" }, "muted", {
        muteKey: { handler, event: "a" },
      });
      boundary.wrapCallback(handler, { kind: "Event bus handler" }, "muted", {
        muteKey: { handler, event: "b" },
      });
      expect(boundary.getCallbackErrors()).toHaveLength(2);
    });

    it("caps recorded callback errors", () => {
      const { boundary } = createBoundary();
      for (let i = 0; i < 250; i++) {
        boundary.wrapCallback(
          () => {
            throw new Error(`err${i}`);
          },
          { kind: "Test callback" },
          "reported",
        );
      }
      expect(boundary.getCallbackErrors().length).toBeLessThanOrEqual(200);
    });

    it("keeps the original Error object (not just its message) for the console entry", () => {
      const { boundary, logger } = createBoundary();
      const original = new Error("boom");
      boundary.wrapCallback(
        () => {
          throw original;
        },
        { kind: "Test callback" },
        "removed",
      );
      const logs = logger.getRecent(1);
      const data = logs[0]?.data as { error: unknown } | undefined;
      expect(data?.error).toBe(original);
      expect(data?.error).toBeInstanceOf(Error);
    });

    it("clearCallbackErrors empties the recorded list", () => {
      const { boundary } = createBoundary();
      boundary.wrapCallback(
        () => {
          throw new Error("boom");
        },
        { kind: "Test callback" },
        "reported",
      );
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      boundary.clearCallbackErrors();
      expect(boundary.getCallbackErrors()).toHaveLength(0);
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
        outcome: "propagated",
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

  describe("errors: \"fatal\"", () => {
    describe("wrapSystem", () => {
      it("rethrows, stops the loop, records a fatal error, and does not disable the system", () => {
        const { boundary, loop } = createFatalBoundary();
        loop.start();
        const sys = new TestSystem();
        expect(() =>
          boundary.wrapSystem(sys, () => {
            throw new Error("boom");
          }),
        ).toThrow("boom");
        expect(sys.enabled).toBe(true);
        expect(loop.isRunning).toBe(false);
        expect(boundary.getDisabled().systems).toHaveLength(0);
        const errors = boundary.getCallbackErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          kind: "System TestSystem",
          outcome: "fatal",
          error: "boom",
        });
      });
    });

    describe("wrapComponent", () => {
      it("rethrows, stops the loop, records a fatal error, and does not disable the component", () => {
        const { boundary, loop } = createFatalBoundary();
        loop.start();
        const comp = new TestComponent();
        comp.entity = { name: "player" } as never;
        expect(() =>
          boundary.wrapComponent(comp, () => {
            throw new Error("crash");
          }),
        ).toThrow("crash");
        expect(comp.enabled).toBe(true);
        expect(loop.isRunning).toBe(false);
        expect(boundary.getDisabled().components).toHaveLength(0);
        const errors = boundary.getCallbackErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          kind: "Component TestComponent",
          entity: "player",
          outcome: "fatal",
          error: "crash",
        });
      });
    });

    describe("wrapCallback", () => {
      it("rethrows a synchronous throw, stops the loop, records it with outcome \"fatal\", and never calls onError", () => {
        const { boundary, logger, loop } = createFatalBoundary();
        loop.start();
        const onError = vi.fn();
        expect(() =>
          boundary.wrapCallback(
            () => {
              throw new Error("boom");
            },
            { kind: "Collision handler", entity: "DoorPad" },
            "removed",
            { onError },
          ),
        ).toThrow("boom");
        expect(onError).not.toHaveBeenCalled();
        expect(loop.isRunning).toBe(false);
        const errors = boundary.getCallbackErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          kind: "Collision handler",
          entity: "DoorPad",
          outcome: "fatal",
          error: "boom",
        });
        const logs = logger.getRecent(1);
        expect(logs[0]?.message).toBe(
          'Collision handler threw on entity "DoorPad" and stopped the game loop',
        );
        const data = logs[0]?.data as { error: unknown } | undefined;
        expect(data?.error).toBeInstanceOf(Error);
      });

      it("re-raises a rejected thenable as a new unhandled rejection and stops the loop", async () => {
        const { boundary, loop } = createFatalBoundary();
        loop.start();
        const rejection = new Promise<unknown>((resolve) => {
          process.once("unhandledRejection", resolve);
        });
        boundary.wrapCallback(
          (async () => {
            throw new Error("async boom");
          }) as unknown as () => void,
          { kind: "Test callback" },
          "removed",
        );
        const reason = await rejection;
        expect((reason as Error).message).toBe("async boom");
        expect(loop.isRunning).toBe(false);
        expect(boundary.getCallbackErrors()).toMatchObject([
          { kind: "Test callback", outcome: "fatal", error: "async boom" },
        ]);
      });

      it("does not report or stop the loop twice for the same error propagating through nested wraps", () => {
        const { boundary, logger, loop } = createFatalBoundary();
        loop.start();
        const stopSpy = vi.spyOn(loop, "stop");
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
              "removed",
            );
          }),
        ).toThrow("boom");
        expect(stopSpy).toHaveBeenCalledOnce();
        // Only wrapCallback's more specific message was logged.
        const logs = logger.getRecent(5);
        const messages = logs.map((l) => l.message);
        expect(messages).toEqual([
          'Collision handler threw on entity "DoorPad" and stopped the game loop',
        ]);
        // The error propagated through two wrap methods but is recorded once.
        expect(boundary.getCallbackErrors()).toHaveLength(1);
      });
    });

    describe("wrapLifecycleHook", () => {
      it("behaves the same as under \"isolate\" — reports and rethrows, does not stop the loop", () => {
        const { boundary, loop } = createFatalBoundary();
        loop.start();
        expect(() =>
          boundary.wrapLifecycleHook(
            () => {
              throw new Error("setup failed");
            },
            { kind: "Scene onEnter hook", scene: "Game" },
          ),
        ).toThrow("setup failed");
        // Lifecycle hooks already propagate on their own; stopping the loop
        // on top would be redundant with the caller's own rejection handling.
        expect(loop.isRunning).toBe(true);
      });
    });
  });
});
