import { describe, it, expect, vi } from "vitest";
import { Component } from "./Component.js";
import { EngineContext, LoggerKey, ServiceKey } from "./EngineContext.js";
import { Logger } from "./Logger.js";

class TestComponent extends Component {}

describe("Component", () => {
  it("enabled defaults to true", () => {
    const c = new TestComponent();
    expect(c.enabled).toBe(true);
  });

  it("can be disabled", () => {
    const c = new TestComponent();
    c.enabled = false;
    expect(c.enabled).toBe(false);
  });

  it("scene getter throws when entity has no scene", () => {
    const c = new TestComponent();
    c.entity = { scene: null } as never;
    expect(() => c.scene).toThrow(
      "Cannot access scene: entity is not attached to a scene.",
    );
  });

  it("context getter throws when entity has no scene", () => {
    const c = new TestComponent();
    c.entity = { scene: null } as never;
    expect(() => c.context).toThrow(
      "Cannot access scene: entity is not attached to a scene.",
    );
  });

  it("context getter returns scene context", () => {
    const mockContext = { resolve: () => {} };
    const c = new TestComponent();
    c.entity = { scene: { context: mockContext } } as never;
    expect(c.context).toBe(mockContext);
  });

  it("lifecycle hooks are optional", () => {
    const c = new TestComponent();
    expect(c.onAdd).toBeUndefined();
    expect(c.onRemove).toBeUndefined();
    expect(c.onDestroy).toBeUndefined();
    expect(c.update).toBeUndefined();
    expect(c.fixedUpdate).toBeUndefined();
  });

  it("subclass can define lifecycle hooks", () => {
    class LifecycleComponent extends Component {
      added = false;
      removed = false;
      destroyed = false;

      onAdd() {
        this.added = true;
      }
      onRemove() {
        this.removed = true;
      }
      onDestroy() {
        this.destroyed = true;
      }
    }

    const c = new LifecycleComponent();
    c.onAdd?.();
    c.onRemove?.();
    c.onDestroy?.();
    expect(c.added).toBe(true);
    expect(c.removed).toBe(true);
    expect(c.destroyed).toBe(true);
  });

  it("subclass can define update methods", () => {
    class UpdatingComponent extends Component {
      lastDt = 0;
      lastFixedDt = 0;

      update(dt: number) {
        this.lastDt = dt;
      }
      fixedUpdate(dt: number) {
        this.lastFixedDt = dt;
      }
    }

    const c = new UpdatingComponent();
    c.update(16);
    c.fixedUpdate(8);
    expect(c.lastDt).toBe(16);
    expect(c.lastFixedDt).toBe(8);
  });

  describe("use()", () => {
    function componentWithContext() {
      const ctx = new EngineContext();
      const logger = new Logger();
      ctx.register(LoggerKey, logger);

      class UseComponent extends Component {
        getLogger() {
          return this.use(LoggerKey);
        }
      }

      const c = new UseComponent();
      c.entity = {
        scene: { context: ctx, _resolveScoped: () => undefined },
      } as never;
      return { c, logger };
    }

    it("resolves a service by key", () => {
      const { c, logger } = componentWithContext();
      expect(c.getLogger()).toBe(logger);
    });

    it("caches the result on subsequent calls", () => {
      const { c, logger } = componentWithContext();
      const first = c.getLogger();
      const second = c.getLogger();
      expect(first).toBe(logger);
      expect(second).toBe(logger);
    });

    it("resolves scene-scoped value before engine scope", () => {
      const ctx = new EngineContext();
      const key = new ServiceKey<string>("svc", { scope: "scene" });
      ctx.register(key, "engine-value");

      class ScopedComponent extends Component {
        getValue() {
          return this.use(key);
        }
      }

      const c = new ScopedComponent();
      c.entity = {
        scene: {
          context: ctx,
          _resolveScoped: (k: ServiceKey<unknown>) =>
            k.id === "svc" ? "scene-value" : undefined,
        },
      } as never;

      expect(c.getValue()).toBe("scene-value");
    });

    it("falls back to engine scope when scene has no scoped value", () => {
      const ctx = new EngineContext();
      const key = new ServiceKey<string>("svc");
      ctx.register(key, "engine-value");

      class FallbackComponent extends Component {
        getValue() {
          return this.use(key);
        }
      }

      const c = new FallbackComponent();
      c.entity = {
        scene: {
          context: ctx,
          _resolveScoped: () => undefined,
        },
      } as never;

      expect(c.getValue()).toBe("engine-value");
    });

    it("warns when a scene-scoped key falls back to engine scope", () => {
      const ctx = new EngineContext();
      const logger = new Logger();
      ctx.register(LoggerKey, logger);
      const key = new ServiceKey<string>("missing-scoped", { scope: "scene" });
      ctx.register(key, "fallback");

      const warnSpy = vi.spyOn(logger, "warn");

      class WarnComponent extends Component {
        getValue() {
          return this.use(key);
        }
      }

      const c = new WarnComponent();
      c.entity = {
        scene: {
          context: ctx,
          _resolveScoped: () => undefined,
        },
      } as never;

      c.getValue();
      expect(warnSpy).toHaveBeenCalledWith(
        "core",
        expect.stringContaining("missing-scoped"),
        expect.objectContaining({ component: "WarnComponent" }),
      );
    });
  });
});
