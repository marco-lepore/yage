import {
  EventBusKey,
  GameLoopKey,
  InspectorKey,
  SceneManagerKey,
} from "@yagejs/core";
import type {
  EngineContext,
  EventBus,
  EngineEvents,
  Plugin,
  SceneManager,
  System,
  SystemScheduler,
} from "@yagejs/core";
import { DebugRegistryKey } from "./types.js";
import { CameraComponent, RendererKey } from "@yagejs/renderer";
import type { RendererPlugin, SceneRenderTreeProvider } from "@yagejs/renderer";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { Application, Container } from "pixi.js";
import { DebugClock } from "./DebugClock.js";
import type { DebugClockHost, IDebugClock } from "./DebugClock.js";
import { DebugRegistryImpl } from "./DebugRegistryImpl.js";
import { DebugScene } from "./DebugScene.js";
import { StatsStore } from "./StatsStore.js";
import { GraphicsPool } from "./GraphicsPool.js";
import { TextPool } from "./TextPool.js";
import { WorldDebugApiImpl } from "./WorldDebugApiImpl.js";
import { HudDebugApiImpl } from "./HudDebugApiImpl.js";
import { DebugRenderSystem } from "./DebugRenderSystem.js";
import { FpsContributor } from "./contributors/FpsContributor.js";
import { EntityCountContributor } from "./contributors/EntityCountContributor.js";
import { SystemTimingContributor } from "./contributors/SystemTimingContributor.js";

/** Configuration for the DebugPlugin. */
export interface DebugConfig {
  /** Key code to toggle debug overlay. Default: "Backquote" */
  toggleKey?: string;
  /** Key code to advance one fixed-timestep frame while the debug clock is frozen. Default: "Period" */
  stepKey?: string;
  /** Max pooled Graphics objects. Default: 256 */
  maxGraphics?: number;
  /** Max HUD text lines. Default: 32 */
  maxHudLines?: number;
  /** Whether the overlay starts enabled. Default: false */
  startEnabled?: boolean;
  /** Initial flag overrides, keyed by "contributorName.flagName". */
  flags?: Record<string, boolean>;
  /**
   * If set, every scene's RNG is initialized with this seed instead of an
   * unspecified default. Use for deterministic E2E runs. Leave undefined for
   * normal debug builds so randomness behaves the same as in production.
   */
  deterministicSeed?: number;
}

export interface LayerTransformSnapshot {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface CameraStackSnapshot {
  scene: string;
  name: string | undefined;
  priority: number;
  enabled: boolean;
}

/**
 * Renderer-aware diagnostics exposed through the inspector extension
 * namespace `debug`. Kept out of the core Inspector surface so the core
 * package stays renderer-agnostic while plugins can still publish optional
 * runtime helpers in a uniform way.
 */
export interface DebugDiagnostics {
  getLayerTransform(
    sceneName: string,
    layerName: string,
  ): LayerTransformSnapshot | undefined;
  getCameraStack(): CameraStackSnapshot[];
}

/**
 * Debug overlay plugin. Mounts a private `DebugScene` through
 * `SceneManager._mountDetached` so it goes through the same scoped-DI
 * lifecycle as stacked scenes (the renderer's `beforeEnter` hook creates
 * its render tree) while staying off the user-visible scene stack.
 */
export class DebugPlugin implements Plugin {
  readonly name = "debug";
  readonly version = "3.0.0";
  readonly dependencies = ["renderer"] as const;

  private readonly config: DebugConfig;
  private registry!: DebugRegistryImpl;
  private stats!: StatsStore;
  private graphicsPool: GraphicsPool | null = null;
  private textPool: TextPool | null = null;
  private worldApi: WorldDebugApiImpl | null = null;
  private hudApi: HudDebugApiImpl | null = null;
  private renderSystem: DebugRenderSystem | null = null;
  private systemTimings = new Map<string, number>();
  private originalUpdates = new Map<System, (dt: number) => void>();
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private context!: EngineContext;
  private renderer!: RendererPlugin;
  private scheduler!: SystemScheduler;
  private sceneManager!: SceneManager;
  private debugScene: DebugScene | null = null;
  private provider: SceneRenderTreeProvider | null = null;
  private eventUnsubs: Array<() => void> = [];
  private clock: DebugClock | null = null;

  constructor(config?: DebugConfig) {
    this.config = config ?? {};
  }

  install(context: EngineContext): void {
    this.context = context;
    this.renderer = context.resolve(RendererKey);
    if (this.config.deterministicSeed !== undefined) {
      context
        .resolve(InspectorKey)
        .setDefaultSceneSeed(this.config.deterministicSeed);
    }

    this.registry = new DebugRegistryImpl();
    this.registry.enabled = this.config.startEnabled ?? false;

    if (this.config.flags) {
      for (const [key, value] of Object.entries(this.config.flags)) {
        const dot = key.indexOf(".");
        if (dot > 0) {
          this.registry.setFlag(key.slice(0, dot), key.slice(dot + 1), value);
        }
      }
    }

    this.stats = new StatsStore();

    context.register(DebugRegistryKey, this.registry);
  }

  registerSystems(scheduler: SystemScheduler): void {
    // DebugRenderSystem is registered lazily once the debug scene is ready —
    // its constructor needs the scene's layer containers.
    this.scheduler = scheduler;
  }

  async onStart(): Promise<void> {
    this.sceneManager = this.context.resolve(SceneManagerKey);
    const bus = this.context.resolve(EventBusKey) as EventBus<EngineEvents>;

    // Key listeners (toggle, manual-clock step)
    const toggleKey = this.config.toggleKey ?? "Backquote";
    const stepKey = this.config.stepKey ?? "Period";
    this.keyListener = (e: KeyboardEvent) => {
      if (e.code === toggleKey) {
        this.registry.toggle();
        return;
      }
      if (e.code === stepKey && this.clock?.isFrozen) {
        e.preventDefault();
        this.clock.step();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.keyListener);
    }

    // Instrument system timings — reuse the scheduler captured in
    // `registerSystems`, which ran before `onStart`.
    for (const system of this.scheduler.getAllSystems()) {
      if (system instanceof DebugRenderSystem) continue;
      const name = system.constructor.name;
      const original = system.update.bind(system);
      this.originalUpdates.set(system, original);
      system.update = (dt: number) => {
        const t0 = performance.now();
        original(dt);
        this.systemTimings.set(name, performance.now() - t0);
      };
    }

    // Built-in contributors
    const inspector = this.context.resolve(InspectorKey);
    this.registry.register(new FpsContributor());
    this.registry.register(new EntityCountContributor(inspector));
    this.registry.register(new SystemTimingContributor(this.systemTimings));

    // Manual clock for deterministic stepping. The host drives `app.ticker`
    // directly so a manual `step()` fires every ticker subscriber
    // (AnimatedSprite, pixi-filters, render, user `app.ticker.add` callbacks)
    // with the same synthetic dt as gameplay state.
    const gameLoop = this.context.resolve(GameLoopKey);
    const app = this.renderer.application;
    this.clock = new DebugClock(createPixiTickerHost(app, gameLoop.fixedTimestep));
    inspector.attachTimeController(this.clock);
    inspector.setEventLogEnabled(true);
    this.attachToGlobal(this.clock);

    // Materialize the debug scene off-stack. `_mountDetached` routes through
    // the same beforeEnter hooks as `push`, so the renderer materializes the
    // debug scene's tree and registers SceneRenderTreeKey on its scope.
    this.provider = this.context.tryResolve(SceneRenderTreeProviderKey) ?? null;
    this.registerInspectorDiagnostics();
    await this.materializeDebugScene();

    // Keep the debug scene visually on top of the user stack after any
    // push/pop/replace by reordering its root containers.
    const bringToFront = () => {
      if (this.debugScene && this.provider?.bringSceneToFront) {
        this.provider.bringSceneToFront(this.debugScene);
      }
    };
    this.eventUnsubs.push(bus.on("scene:pushed", bringToFront));
    this.eventUnsubs.push(bus.on("scene:popped", bringToFront));
    this.eventUnsubs.push(bus.on("scene:replaced", bringToFront));
  }

  onDestroy(): void {
    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs.length = 0;

    for (const [system, original] of this.originalUpdates) {
      system.update = original;
    }
    this.originalUpdates.clear();

    if (this.keyListener) {
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", this.keyListener);
      }
      this.keyListener = null;
    }

    this.detachFromGlobal();
    const inspector = this.context.resolve(InspectorKey);
    inspector.removeExtension("debug");
    // Only detach our own clock — passing undefined would clear whatever
    // controller is registered, which could belong to another plugin if
    // onDestroy runs after a failed onStart.
    if (this.clock) {
      inspector.detachTimeController(this.clock);
    }
    inspector.setEventLogEnabled(false);
    if (this.config.deterministicSeed !== undefined) {
      inspector.setDefaultSceneSeed(undefined);
    }
    this.clock = null;

    for (const contributor of this.registry.contributors.values()) {
      contributor.dispose?.();
    }
    this.registry.contributors.clear();

    this.tearDownDebugInfra();
    this.teardownDebugScene();
  }

  private async materializeDebugScene(): Promise<void> {
    const scene = new DebugScene();
    scene.onReady = (worldContainer, hudContainer) =>
      this.setUpDebugInfra(worldContainer, hudContainer);
    scene.onTearDown = () => this.tearDownDebugInfra();
    await this.sceneManager._mountDetached(scene);
    this.debugScene = scene;
  }

  private teardownDebugScene(): void {
    // If destroy is called while `_mountDetached` is still pending, we don't
    // yet hold a reference to the partially-mounted scene. Skipping unmount
    // here is safe: onDestroy still runs `tearDownDebugInfra` below, and the
    // engine teardown tears down the renderer next which destroys any
    // half-created provider entries.
    if (!this.debugScene) return;
    this.sceneManager._unmountDetached(this.debugScene);
    this.debugScene = null;
    this.provider = null;
  }

  private findActiveCamera(): CameraComponent | undefined {
    return findTopmostCamera(this.sceneManager);
  }

  private setUpDebugInfra(
    worldContainer: Container,
    hudContainer: Container,
  ): void {
    const vw = this.renderer.virtualSize.width;
    const vh = this.renderer.virtualSize.height;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // Lazy camera accessor — reads from whichever stacked scene has a camera
    const cameraProxy = {
      get zoom() {
        return self.findActiveCamera()?.zoom ?? 1;
      },
    };

    this.graphicsPool = new GraphicsPool(
      worldContainer,
      this.config.maxGraphics,
    );
    this.textPool = new TextPool(hudContainer, this.config.maxHudLines);

    this.worldApi = new WorldDebugApiImpl(
      this.graphicsPool,
      this.registry,
      cameraProxy,
    );
    this.hudApi = new HudDebugApiImpl(this.textPool, this.registry, vw, vh);

    this.renderSystem = new DebugRenderSystem(
      this.registry,
      this.graphicsPool,
      this.textPool,
      this.worldApi,
      this.hudApi,
      this.stats,
      worldContainer,
      hudContainer,
      {
        findCamera: () => self.findActiveCamera(),
        viewportWidth: vw,
        viewportHeight: vh,
      },
    );
    this.scheduler.add(this.renderSystem);
  }

  private tearDownDebugInfra(): void {
    if (this.renderSystem) {
      this.scheduler.remove(this.renderSystem);
      this.renderSystem = null;
    }
    this.graphicsPool?.destroy();
    this.textPool?.destroy();
    this.graphicsPool = null;
    this.textPool = null;
    this.worldApi = null;
    this.hudApi = null;
  }

  private registerInspectorDiagnostics(): void {
    const diagnostics: DebugDiagnostics = {
      getLayerTransform: (sceneName, layerName) => {
        const scene = this.sceneManager.all.find(
          (candidate) => candidate.name === sceneName,
        );
        if (!scene) return undefined;

        const layer = this.provider?.getTree(scene)?.tryGet(layerName);
        if (!layer) return undefined;

        const container = layer.container;
        return {
          x: container.position.x,
          y: container.position.y,
          scaleX: container.scale.x,
          scaleY: container.scale.y,
          rotation: container.rotation,
        };
      },
      getCameraStack: () => {
        const cameras: CameraStackSnapshot[] = [];
        for (const scene of this.sceneManager.all) {
          for (const entity of scene.getEntities()) {
            const cam = entity.tryGet(CameraComponent);
            if (!cam) continue;
            cameras.push({
              scene: scene.name,
              name: cam.cameraName,
              priority: cam.priority,
              enabled: cam.enabled,
            });
          }
        }
        return cameras;
      },
    };
    this.context.resolve(InspectorKey).addExtension("debug", diagnostics);
  }

  private attachToGlobal(clock: IDebugClock): void {
    const g = (globalThis as Record<string, unknown>)["__yage__"];
    if (g && typeof g === "object") {
      (g as Record<string, unknown>)["clock"] = clock;
    }
  }

  private detachFromGlobal(): void {
    const g = (globalThis as Record<string, unknown>)["__yage__"];
    if (
      g &&
      typeof g === "object" &&
      (g as Record<string, unknown>)["clock"] === this.clock
    ) {
      delete (g as Record<string, unknown>)["clock"];
    }
  }
}

/**
 * Wire a `DebugClockHost` against a Pixi v8 `Application`. Driving
 * `app.ticker.update(syntheticTime)` while the ticker is stopped fires every
 * subscriber — Pixi's `Ticker.update` doesn't gate on `started`, only the
 * rAF-driven `_tick` does — so a single advance replaces the old
 * `gameLoop.tick(dt)` + `app.render()` quad and along the way fixes the
 * AnimatedSprite / pixi-filters / `app.ticker.add` subscriber freeze.
 */
function createPixiTickerHost(
  app: Application,
  fixedTimestep: number,
): DebugClockHost {
  let syntheticTime = 0;
  let savedMinFPS: number | null = null;
  return {
    fixedTimestep,
    freeze(): void {
      app.stop();
      // Reset both to zero so synthetic time starts from a clean origin
      // and `(syntheticTime + dt) - syntheticTime` stays an exact `dt`
      // — keeps deltaMS deterministic regardless of how long the page
      // ran in auto mode before the freeze.
      syntheticTime = 0;
      app.ticker.lastTime = 0;
      // Default minFPS=10 clamps deltaMS at 100ms — `step(200)` would
      // silently see deltaMS=100. Disable for the duration of the freeze.
      savedMinFPS = app.ticker.minFPS;
      app.ticker.minFPS = 0;
    },
    thaw(): void {
      if (savedMinFPS !== null) {
        app.ticker.minFPS = savedMinFPS;
        savedMinFPS = null;
      }
      // `app.start()` calls `Ticker._requestIfNeeded` which resets
      // `lastTime` to `performance.now()` itself, so the next rAF
      // doesn't see `realNow - 0` as a giant first-frame delta. No
      // need to set it manually here.
      app.start();
    },
    advance(dtMs: number): void {
      syntheticTime += dtMs;
      app.ticker.update(syntheticTime);
    },
  };
}

/**
 * Find the highest-priority enabled camera on the topmost scene that has one.
 * `sceneManager.all` is bottom→top, so we walk in reverse — a pause/HUD
 * scene's camera wins over a frozen scene beneath it.
 */
export function findTopmostCamera(
  sceneManager: SceneManager,
): CameraComponent | undefined {
  const stack = sceneManager.all;
  for (let i = stack.length - 1; i >= 0; i--) {
    const scene = stack[i];
    if (!scene) continue;
    let highestPriorityCamera: CameraComponent | undefined;
    for (const entity of scene.getEntities()) {
      const cam = entity.tryGet(CameraComponent);
      if (
        cam &&
        cam.enabled &&
        (!highestPriorityCamera ||
          cam.priority > highestPriorityCamera.priority)
      ) {
        highestPriorityCamera = cam;
      }
    }
    if (highestPriorityCamera) return highestPriorityCamera;
  }
  return undefined;
}
