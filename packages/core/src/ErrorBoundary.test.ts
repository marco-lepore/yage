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
});
