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
import { ErrorBoundary } from "./ErrorBoundary.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import { Logger, LogLevel } from "./Logger.js";

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

  it("scenes without preload enter after awaiting push", async () => {
    const { manager } = setup();
    const scene = new PlainScene();
    await manager.push(scene);
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
    await manager.push(first);

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

  it("preload() loads the manifest and the push consumes it", async () => {
    const { manager, am } = setup();
    const scene = new PreloadScene();
    const progress: number[] = [];

    await manager.preload(scene, (ratio) => progress.push(ratio));
    expect(am.has(FakeAsset)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(scene.progressValues.at(-1)).toBe(1);

    await manager.push(scene);
    expect(scene.entered).toBe(true);

    // One owner, one reference: the scene's own unload frees the handle.
    am.unload(FakeAsset);
    expect(am.has(FakeAsset)).toBe(false);
  });

  it("preloading one scene twice still takes one reference", async () => {
    const { manager, am } = setup();
    const scene = new PreloadScene();

    // A menu prefetches the level, then routes to that same instance through
    // a LoadingScene, which preloads it again.
    await manager.preload(scene);
    await manager.preload(scene);
    await manager.push(scene);

    am.unload(FakeAsset);
    expect(am.has(FakeAsset)).toBe(false);
  });

  it("attributes a throwing caller callback to the caller, not the scene", async () => {
    const { manager, ctx } = setup();
    const logger = new Logger({ level: LogLevel.Error });
    const boundary = new ErrorBoundary(logger);
    ctx.register(ErrorBoundaryKey, boundary);
    manager._setContext(ctx);

    await expect(
      manager.preload(new PreloadScene(), () => {
        throw new Error("progress bar blew up");
      }),
    ).rejects.toThrow("progress bar blew up");
    expect(boundary.getCallbackErrors()).toEqual([
      expect.objectContaining({
        kind: "SceneManager.preload onProgress callback",
        scene: "preloaded",
      }),
    ]);
  });

  it("preloads normally when the same scene is pushed twice", async () => {
    const { manager, am } = setup();
    const scene = new PreloadScene();

    await manager.preload(scene);
    await manager.push(scene);
    await manager.pop();
    await manager.push(scene);

    // The mark is consumed once; the second push takes its own reference.
    am.unload(FakeAsset);
    expect(am.has(FakeAsset)).toBe(true);
    am.unload(FakeAsset);
    expect(am.has(FakeAsset)).toBe(false);
  });

  it("attributes a throwing onProgress hook to the scene", async () => {
    const { manager, ctx } = setup();
    const logger = new Logger({ level: LogLevel.Error });
    const boundary = new ErrorBoundary(logger);
    ctx.register(ErrorBoundaryKey, boundary);
    manager._setContext(ctx);

    class BadProgress extends PreloadScene {
      override onProgress(): void {
        throw new Error("progress blew up");
      }
    }

    await expect(manager.push(new BadProgress())).rejects.toThrow(
      "progress blew up",
    );
    expect(boundary.getCallbackErrors()).toEqual([
      expect.objectContaining({
        kind: "Scene onProgress hook",
        scene: "preloaded",
      }),
    ]);
  });

  it("skips preloading when asset manager is not registered", async () => {
    // Setup without asset manager
    _resetEntityIdCounter();
    const ctx = new EngineContext();
    ctx.register(QueryCacheKey, new QueryCache());
    ctx.register(EventBusKey, new EventBus<EngineEvents>());
    const manager = new SceneManager();
    ctx.register(SceneManagerKey, manager);
    manager._setContext(ctx);

    const scene = new PreloadScene();
    await manager.push(scene);
    // Without asset manager, preload is skipped; onEnter still fires.
    expect(scene.entered).toBe(true);
  });
});
