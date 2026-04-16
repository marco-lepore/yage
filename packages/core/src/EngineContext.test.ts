import { describe, it, expect } from "vitest";
import {
  EngineContext,
  ServiceKey,
  EngineKey,
  EventBusKey,
  SceneManagerKey,
  LoggerKey,
  InspectorKey,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoopKey,
} from "./EngineContext.js";

describe("EngineContext", () => {
  it("registers and resolves a service", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("test");
    ctx.register(key, "hello");
    expect(ctx.resolve(key)).toBe("hello");
  });

  it("throws on duplicate registration", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("test");
    ctx.register(key, "first");
    expect(() => ctx.register(key, "second")).toThrow(
      'Service "test" is already registered.',
    );
  });

  it("throws on resolve of unregistered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("missing");
    expect(() => ctx.resolve(key)).toThrow(
      'Service "missing" is not registered.',
    );
  });

  it("tryResolve returns undefined for unregistered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("missing");
    expect(ctx.tryResolve(key)).toBeUndefined();
  });

  it("tryResolve returns service for registered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<number>("num");
    ctx.register(key, 42);
    expect(ctx.tryResolve(key)).toBe(42);
  });

  it("has returns false for unregistered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("missing");
    expect(ctx.has(key)).toBe(false);
  });

  it("has returns true for registered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("test");
    ctx.register(key, "value");
    expect(ctx.has(key)).toBe(true);
  });

  it("ServiceKey stores id", () => {
    const key = new ServiceKey<string>("myService");
    expect(key.id).toBe("myService");
  });

  it("unregister removes a registered service", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("test");
    ctx.register(key, "hello");
    ctx.unregister(key);
    expect(ctx.has(key)).toBe(false);
    expect(ctx.tryResolve(key)).toBeUndefined();
  });

  it("unregister is a no-op for unregistered key", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("missing");
    expect(() => ctx.unregister(key)).not.toThrow();
  });

  it("can re-register after unregister", () => {
    const ctx = new EngineContext();
    const key = new ServiceKey<string>("test");
    ctx.register(key, "first");
    ctx.unregister(key);
    ctx.register(key, "second");
    expect(ctx.resolve(key)).toBe("second");
  });

  describe("ServiceKey.scope", () => {
    it("defaults to 'engine' when no options provided", () => {
      const key = new ServiceKey<string>("test");
      expect(key.scope).toBe("engine");
    });

    it("accepts explicit scope option", () => {
      const scoped = new ServiceKey<string>("scoped", { scope: "scene" });
      expect(scoped.scope).toBe("scene");
    });

    it("accepts explicit engine scope", () => {
      const eng = new ServiceKey<string>("eng", { scope: "engine" });
      expect(eng.scope).toBe("engine");
    });
  });

  it("well-known keys exist with correct ids", () => {
    expect(EngineKey.id).toBe("engine");
    expect(EventBusKey.id).toBe("eventBus");
    expect(SceneManagerKey.id).toBe("sceneManager");
    expect(LoggerKey.id).toBe("logger");
    expect(InspectorKey.id).toBe("inspector");
    expect(QueryCacheKey.id).toBe("queryCache");
    expect(ErrorBoundaryKey.id).toBe("errorBoundary");
    expect(GameLoopKey.id).toBe("gameLoop");
  });
});
