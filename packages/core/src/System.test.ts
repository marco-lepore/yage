import { describe, it, expect } from "vitest";
import { System } from "./System.js";
import { Phase } from "./types.js";
import { EngineContext, LoggerKey } from "./EngineContext.js";
import { Logger } from "./Logger.js";

class TestSystem extends System {
  readonly phase = Phase.Update;
  lastDt = 0;
  update(dt: number): void {
    this.lastDt = dt;
  }
}

describe("System", () => {
  it("has default priority 0", () => {
    const sys = new TestSystem();
    expect(sys.priority).toBe(0);
  });

  it("is enabled by default", () => {
    const sys = new TestSystem();
    expect(sys.enabled).toBe(true);
  });

  it("can be disabled", () => {
    const sys = new TestSystem();
    sys.enabled = false;
    expect(sys.enabled).toBe(false);
  });

  it("update receives dt", () => {
    const sys = new TestSystem();
    sys.update(16);
    expect(sys.lastDt).toBe(16);
  });

  it("lifecycle hooks are optional", () => {
    const sys = new TestSystem();
    expect(sys.onRegister).toBeUndefined();
    expect(sys.onUnregister).toBeUndefined();
  });

  describe("use()", () => {
    class UseSystem extends System {
      readonly phase = Phase.Update;
      update() {}
      getLogger() {
        return this.use(LoggerKey);
      }
    }

    function systemWithContext() {
      const ctx = new EngineContext();
      const logger = new Logger();
      ctx.register(LoggerKey, logger);
      const sys = new UseSystem();
      sys._setContext(ctx);
      return { sys, logger };
    }

    it("resolves a service by key", () => {
      const { sys, logger } = systemWithContext();
      expect(sys.getLogger()).toBe(logger);
    });

    it("caches the result on subsequent calls", () => {
      const { sys, logger } = systemWithContext();
      const first = sys.getLogger();
      const second = sys.getLogger();
      expect(first).toBe(logger);
      expect(second).toBe(logger);
    });
  });
});
