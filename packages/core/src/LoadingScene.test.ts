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
  ErrorBoundaryKey,
  LoggerKey,
} from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { _resetEntityIdCounter } from "./Entity.js";
import { LoadingScene } from "./LoadingScene.js";

class TargetScene extends Scene {
  readonly name = "target";
  entered = false;
  onEnter() {
    this.entered = true;
  }
}

function targetWithPreload(preload: readonly AssetHandle<unknown>[]): TargetScene {
  class WithPreload extends TargetScene {
    override readonly preload = preload;
  }
  return new WithPreload();
}

function setup() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  const logger = new Logger({ level: LogLevel.Error });
  ctx.register(QueryCacheKey, new QueryCache());
  ctx.register(EventBusKey, new EventBus<EngineEvents>());
  ctx.register(ErrorBoundaryKey, new ErrorBoundary(logger));
  ctx.register(LoggerKey, logger);

  const assets = new AssetManager();
  ctx.register(AssetManagerKey, assets);

  const manager = new SceneManager();
  ctx.register(SceneManagerKey, manager);
  manager._setContext(ctx);

  return { ctx, manager, assets, bus: ctx.resolve(EventBusKey) };
}

/** Test-only LoadingScene subclass that kicks off loading from onEnter. */
class AutoBoot extends LoadingScene {
  constructor(
    readonly target: Scene | (() => Scene),
    readonly opts: {
      minDuration?: number;
      autoContinue?: boolean;
      onLoadError?: (e: Error) => void;
    } = {},
  ) {
    super();
    if (opts.minDuration !== undefined) {
      (this as { minDuration: number }).minDuration = opts.minDuration;
    }
    if (opts.autoContinue !== undefined) {
      (this as { autoContinue: boolean }).autoContinue = opts.autoContinue;
    }
    if (opts.onLoadError) {
      this.onLoadError = opts.onLoadError;
    }
  }

  override onEnter(): void {
    this.startLoading();
  }
}

describe("LoadingScene", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("replaces itself with the target after preload completes", async () => {
    const { manager, assets } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    assets.registerLoader("fake", { load: async (p) => `loaded:${p}` });

    const target = targetWithPreload([FakeAsset]);
    await manager.push(new AutoBoot(target));
    await vi.waitFor(() => expect(manager.active).toBe(target));
    expect(target.entered).toBe(true);
  });

  it("does not start loading until startLoading() is called", async () => {
    const { manager, assets, bus } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    assets.registerLoader("fake", { load: async (p) => `loaded:${p}` });

    const target = targetWithPreload([FakeAsset]);
    let progressEvents = 0;
    bus.on("scene:loading:progress", () => progressEvents++);

    class LazyBoot extends LoadingScene {
      readonly target = target;
      // No startLoading() call — deliberately hold loading.
    }
    const boot = new LazyBoot();
    await manager.push(boot);

    // Give microtasks a chance to run; no events should fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(progressEvents).toBe(0);
    expect(manager.active).toBe(boot);

    // Now kick it off explicitly.
    boot.startLoading();
    await vi.waitFor(() => expect(manager.active).toBe(target));
    expect(progressEvents).toBeGreaterThan(0);
  });

  it("startLoading() is idempotent", async () => {
    const { manager, assets } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    const loader = vi.fn(async (p: string) => `loaded:${p}`);
    assets.registerLoader("fake", { load: loader });

    const target = targetWithPreload([FakeAsset]);

    class Boot extends LoadingScene {
      readonly target = target;
      override onEnter(): void {
        this.startLoading();
        this.startLoading(); // second call must no-op
        this.startLoading();
      }
    }

    await manager.push(new Boot());
    await vi.waitFor(() => expect(manager.active).toBe(target));
    // The loader runs once per asset; a second startLoading() shouldn't
    // re-trigger loadAll (and even if it did, AssetManager caches, so the
    // stronger check is on invocation count).
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("accepts a factory target and invokes it once", async () => {
    const { manager, assets } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    assets.registerLoader("fake", { load: async (p) => `loaded:${p}` });

    const factory = vi.fn(() => targetWithPreload([FakeAsset]));
    await manager.push(new AutoBoot(factory));
    await vi.waitFor(() => expect(manager.active?.name).toBe("target"));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("emits scene:loading:progress with monotonic 0 → 1 ratios", async () => {
    const { manager, assets, bus } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    assets.registerLoader("fake", { load: async (p) => `loaded:${p}` });

    const target = targetWithPreload([FakeAsset]);
    const ratios: number[] = [];

    const boot = new AutoBoot(target);
    bus.on("scene:loading:progress", (ev) => {
      if (ev.scene === boot) ratios.push(ev.ratio);
    });

    await manager.push(boot);
    await vi.waitFor(() => expect(manager.active).toBe(target));

    expect(ratios.length).toBeGreaterThan(0);
    expect(ratios[0]).toBe(0);
    expect(ratios[ratios.length - 1]).toBe(1);
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]!);
    }
  });

  it("exposes progress via a readonly getter", async () => {
    const { manager, assets } = setup();
    const FakeAsset = new AssetHandle<string>("fake", "a.dat");
    assets.registerLoader("fake", { load: async (p) => `loaded:${p}` });

    const target = targetWithPreload([FakeAsset]);
    const boot = new AutoBoot(target);

    expect(boot.progress).toBe(0);

    await manager.push(boot);
    await vi.waitFor(() => expect(manager.active).toBe(target));

    expect(boot.progress).toBe(1);
  });

  it("emits scene:loading:done once after preload + minDuration", async () => {
    const { manager, bus } = setup();
    const target = new TargetScene();
    const boot = new AutoBoot(target, { minDuration: 80 });

    const done = vi.fn();
    bus.on("scene:loading:done", (ev) => {
      if (ev.scene === boot) done();
    });

    await manager.push(boot);
    await vi.waitFor(() => expect(manager.active).toBe(target));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("handles a target with no preload", async () => {
    const { manager } = setup();
    const target = new TargetScene();
    await manager.push(new AutoBoot(target));
    await vi.waitFor(() => expect(manager.active).toBe(target));
  });

  it("enforces minDuration on fast loads", async () => {
    const { manager } = setup();
    const target = new TargetScene();

    const start = performance.now();
    await manager.push(new AutoBoot(target, { minDuration: 120 }));
    await vi.waitFor(
      () => expect(manager.active).toBe(target),
      { timeout: 500 },
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(110);
  });

  it("allows retry from onLoadError by calling startLoading() again", async () => {
    const { manager, assets } = setup();
    let failNext = true;
    assets.registerLoader("maybe", {
      load: async (p) => {
        if (failNext) {
          failNext = false;
          throw new Error("transient");
        }
        return `loaded:${p}`;
      },
    });

    const target = targetWithPreload([new AssetHandle<string>("maybe", "a")]);
    const errors: Error[] = [];

    class RetryBoot extends LoadingScene {
      readonly target = target;
      override onEnter(): void {
        this.startLoading();
      }
      override onLoadError(err: Error): void {
        errors.push(err);
        this.startLoading(); // retry
      }
    }

    const boot = new RetryBoot();
    await manager.push(boot);
    await vi.waitFor(() => expect(manager.active).toBe(target));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("transient");
  });

  it("invokes onLoadError when loading rejects and stays mounted", async () => {
    const { manager, assets } = setup();
    const FailAsset = new AssetHandle<string>("fail", "bad.dat");
    assets.registerLoader("fail", {
      load: async () => {
        throw new Error("boom");
      },
    });

    const target = targetWithPreload([FailAsset]);
    const errors: Error[] = [];
    const boot = new AutoBoot(target, { onLoadError: (e) => errors.push(e) });

    await manager.push(boot);
    await vi.waitFor(() => expect(errors.length).toBe(1));

    expect(errors[0]?.message).toBe("boom");
    expect(manager.active).toBe(boot);
    expect(target.entered).toBe(false);
  });

  it("with autoContinue=false, waits for continue() before handing off", async () => {
    const { manager, bus } = setup();
    const target = new TargetScene();
    const boot = new AutoBoot(target, { autoContinue: false });

    let doneFired = false;
    bus.on("scene:loading:done", (ev) => {
      if (ev.scene === boot) doneFired = true;
    });

    await manager.push(boot);
    await vi.waitFor(() => expect(doneFired).toBe(true));

    expect(manager.active).toBe(boot);
    expect(target.entered).toBe(false);

    boot.continue();
    await vi.waitFor(() => expect(manager.active).toBe(target));
    expect(target.entered).toBe(true);
  });

  it("continue() is idempotent", async () => {
    const { manager, bus } = setup();
    const target = new TargetScene();
    const boot = new AutoBoot(target, { autoContinue: false });

    let doneFired = false;
    bus.on("scene:loading:done", (ev) => {
      if (ev.scene === boot) doneFired = true;
    });

    await manager.push(boot);
    // Wait for _run to reach the continue gate (loading:done fires right
    // before the gate is awaited).
    await vi.waitFor(() => expect(doneFired).toBe(true));

    boot.continue();
    boot.continue();

    await vi.waitFor(() => expect(manager.active).toBe(target));
  });

  it("does not enter the target if the scene is replaced mid-load", async () => {
    const { manager, assets, bus } = setup();
    let resolveLoad: ((v: string) => void) | undefined;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((r) => (markLoadStarted = r));
    assets.registerLoader("slow", {
      load: () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
          markLoadStarted();
        }),
    });

    const SlowAsset = new AssetHandle<string>("slow", "x");
    const target = targetWithPreload([SlowAsset]);
    const boot = new AutoBoot(target);

    class OtherScene extends Scene {
      readonly name = "other";
    }

    let replaced = false;
    let progressEventsAfterReplace = 0;
    let doneFired = false;
    bus.on("scene:loading:progress", (ev) => {
      if (replaced && ev.scene === boot) progressEventsAfterReplace++;
    });
    bus.on("scene:loading:done", (ev) => {
      if (ev.scene === boot) doneFired = true;
    });

    await manager.push(boot);
    await loadStarted;

    // Replace the loading scene from outside, then complete the loader.
    const other = new OtherScene();
    await manager.replace(other);
    replaced = true;

    resolveLoad!("done");
    // Give any stray async work a chance to run.
    await new Promise((r) => setTimeout(r, 40));

    expect(manager.active).toBe(other);
    expect(target.entered).toBe(false);
    expect(doneFired).toBe(false);
    expect(progressEventsAfterReplace).toBe(0);
  });

  it("does not leak when an autoContinue=false scene is replaced while gated", async () => {
    const { manager, bus } = setup();
    const target = new TargetScene();
    const boot = new AutoBoot(target, { autoContinue: false });

    let doneFired = false;
    bus.on("scene:loading:done", (ev) => {
      if (ev.scene === boot) doneFired = true;
    });

    await manager.push(boot);
    // Wait until _run is parked at the continue gate.
    await vi.waitFor(() => expect(doneFired).toBe(true));

    class OtherScene extends Scene {
      readonly name = "other";
    }
    // Replacing while gated must not hang — _run should terminate cleanly.
    await manager.replace(new OtherScene());

    expect(manager.active?.name).toBe("other");
    expect(target.entered).toBe(false);
  });

  it("continue() called before load finishes still triggers handoff", async () => {
    const { manager, assets } = setup();
    let resolveLoad: ((v: string) => void) | undefined;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((r) => (markLoadStarted = r));
    assets.registerLoader("slow", {
      load: () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
          markLoadStarted();
        }),
    });

    const SlowAsset = new AssetHandle<string>("slow", "x");
    const target = targetWithPreload([SlowAsset]);
    const boot = new AutoBoot(target, { autoContinue: false });

    await manager.push(boot);
    await loadStarted;

    boot.continue();
    expect(manager.active).toBe(boot);

    resolveLoad!("done");
    await vi.waitFor(() => expect(manager.active).toBe(target));
  });
});
