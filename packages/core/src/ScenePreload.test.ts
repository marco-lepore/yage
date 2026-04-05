import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneManager } from "./SceneManager.js";
import { Scene } from "./Scene.js";
import { AssetManager } from "./AssetManager.js";
import { AssetHandle } from "./AssetHandle.js";
import {
  EngineContext,
  QueryCacheKey,
  EventBusKey,
  AssetManagerKey,
  SceneManagerKey,
} from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { _resetEntityIdCounter } from "./Entity.js";

const FakeAsset = new AssetHandle<string>("fake", "test.dat");

class PlainScene extends Scene {
  readonly name = "plain";
  entered = false;
  onEnter() {
    this.entered = true;
  }
}

class PreloadScene extends Scene {
  readonly name = "preloaded";
  override readonly preload = [FakeAsset];
  entered = false;
  progressValues: number[] = [];

  onProgress(ratio: number) {
    this.progressValues.push(ratio);
  }
  onEnter() {
    this.entered = true;
  }
}

function setup() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  ctx.register(QueryCacheKey, new QueryCache());
  ctx.register(EventBusKey, new EventBus<EngineEvents>());

  const am = new AssetManager();
  ctx.register(AssetManagerKey, am);

  // Register a fake loader that resolves immediately
  am.registerLoader("fake", {
    load: vi.fn(async (path: string) => `loaded:${path}`),
  });

  const manager = new SceneManager();
  ctx.register(SceneManagerKey, manager);
  manager._setContext(ctx);
  return { manager, am, ctx };
}

describe("Scene preload integration", () => {
  beforeEach(() => _resetEntityIdCounter());

  it("scenes without preload still enter synchronously", () => {
    const { manager } = setup();
    const scene = new PlainScene();
    manager.push(scene);
    expect(scene.entered).toBe(true);
  });

  it("preloaded scene enters after loading completes", async () => {
    const { manager } = setup();
    const scene = new PreloadScene();
    const promise = manager.push(scene);

    // onEnter not called yet (loading is async)
    expect(scene.entered).toBe(false);

    await promise;
    expect(scene.entered).toBe(true);
  });

  it("reports progress to scene.onProgress()", async () => {
    const { manager } = setup();
    const scene = new PreloadScene();
    await manager.push(scene);
    // Should have called onProgress with 0 then 1
    expect(scene.progressValues[0]).toBe(0);
    expect(scene.progressValues[scene.progressValues.length - 1]).toBe(1);
  });

  it("assets are available in onEnter via scene.assets", async () => {
    const { manager } = setup();
    let assetValue: string | undefined;

    class TestScene extends Scene {
      readonly name = "test";
      override readonly preload = [FakeAsset];
      onEnter() {
        assetValue = this.assets.get(FakeAsset);
      }
    }

    await manager.push(new TestScene());
    expect(assetValue).toBe("loaded:test.dat");
  });

  it("replace() preloads before entering", async () => {
    const { manager } = setup();
    const first = new PlainScene();
    manager.push(first);

    const second = new PreloadScene();
    const promise = manager.replace(second);
    expect(second.entered).toBe(false);

    await promise;
    expect(second.entered).toBe(true);
    expect(first.entered).toBe(true); // was entered before replace
  });

  it("emits scene:pushed after preload completes", async () => {
    const { manager, ctx } = setup();
    const bus = ctx.resolve(EventBusKey);
    const handler = vi.fn();
    bus.on("scene:pushed", handler);

    const scene = new PreloadScene();
    const promise = manager.push(scene);
    // Event not emitted yet
    expect(handler).not.toHaveBeenCalled();

    await promise;
    expect(handler).toHaveBeenCalledWith({ scene });
  });

  it("skips preloading when asset manager is not registered", () => {
    // Setup without asset manager
    _resetEntityIdCounter();
    const ctx = new EngineContext();
    ctx.register(QueryCacheKey, new QueryCache());
    ctx.register(EventBusKey, new EventBus<EngineEvents>());
    const manager = new SceneManager();
    ctx.register(SceneManagerKey, manager);
    manager._setContext(ctx);

    const scene = new PreloadScene();
    manager.push(scene);
    // Without asset manager, push is synchronous and skips preload
    expect(scene.entered).toBe(true);
  });
});
