import { describe, it, expect, vi } from "vitest";
import { Component } from "./Component.js";
import { Entity } from "./Entity.js";
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
    c.entity = { tryScene: null } as never;
    expect(() => c.scene).toThrow(
      "Cannot access scene: entity is not attached to a scene.",
    );
  });

  it("context getter throws when entity has no scene", () => {
    const c = new TestComponent();
    c.entity = { tryScene: null } as never;
    expect(() => c.context).toThrow(
      "Cannot access scene: entity is not attached to a scene.",
    );
  });

  it("context getter returns scene context", () => {
    const mockContext = { resolve: () => {} };
    const c = new TestComponent();
    c.entity = { tryScene: { context: mockContext } } as never;
    expect(c.context).toBe(mockContext);
  });

  it("lifecycle hooks are optional", () => {
    const c = new TestComponent();
    expect(c.onAdd).toBeUndefined();
    expect(c.onDestroy).toBeUndefined();
    expect(c.update).toBeUndefined();
    expect(c.fixedUpdate).toBeUndefined();
  });

  it("subclass can define lifecycle hooks", () => {
    class LifecycleComponent extends Component {
      added = false;
      destroyed = false;

      onAdd() {
        this.added = true;
      }
      onDestroy() {
        this.destroyed = true;
      }
    }

    const c = new LifecycleComponent();
    c.onAdd?.();
    c.onDestroy?.();
    expect(c.added).toBe(true);
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

  describe("destroy()", () => {
    it("removes the component from its entity and fires onDestroy", () => {
      class DestroyableComponent extends Component {
        destroyed = false;
        onDestroy() {
          this.destroyed = true;
        }
      }
      const entity = new Entity("test");
      const c = entity.add(new DestroyableComponent());

      c.destroy();

      expect(entity.has(DestroyableComponent)).toBe(false);
      expect(c.destroyed).toBe(true);
    });

    it("is a safe no-op on a component never attached to an entity", () => {
      class DestroyableComponent extends Component {
        destroyed = false;
        onDestroy() {
          this.destroyed = true;
        }
      }
      const c = new DestroyableComponent();

      expect(() => c.destroy()).not.toThrow();
      expect(c.destroyed).toBe(false);
    });
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
      c.entity = { tryScene: { context: ctx, _resolveScoped: () => undefined },
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
      c.entity = { tryScene: {
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
      c.entity = { tryScene: {
          context: ctx,
          _resolveScoped: () => undefined,
        },
      } as never;

      expect(c.getValue()).toBe("engine-value");
    });

    it("does not cache the engine fallback for a scene-scoped key", () => {
      const ctx = new EngineContext();
      const key = new ServiceKey<string>("late-scoped", { scope: "scene" });
      ctx.register(key, "engine-value");

      const state: { scoped: string | undefined } = { scoped: undefined };

      class LateComponent extends Component {
        getValue() {
          return this.use(key);
        }
      }

      const c = new LateComponent();
      c.entity = { tryScene: {
          context: ctx,
          _resolveScoped: (k: ServiceKey<unknown>) =>
            k.id === "late-scoped" ? state.scoped : undefined,
        },
      } as never;

      // First call: no scoped value, falls back to engine.
      expect(c.getValue()).toBe("engine-value");

      // Now a plugin belatedly registers the scoped value.
      state.scoped = "scoped-value";

      // Subsequent call should pick up the scoped registration rather than
      // the cached fallback.
      expect(c.getValue()).toBe("scoped-value");
    });

    it("throws a named error when called at field-init (entity unbound)", () => {
      const key = new ServiceKey<string>("infra");

      class FieldInitComponent extends Component {
        readonly value = this.use(key);
      }

      expect(() => new FieldInitComponent()).toThrow(
        /Component\.use\(infra\) called before the component is bound to an entity/,
      );
      expect(() => new FieldInitComponent()).toThrow(
        /Use this\.service\(Key\) for lazy resolution/,
      );
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
      c.entity = { tryScene: {
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
