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
import { CameraKey, RendererKey } from "@yagejs/renderer";
import type {
  RendererPlugin,
  SceneRenderTreeProvider,
} from "@yagejs/renderer";
import { SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { Container } from "pixi.js";
import { DebugClock } from "./DebugClock.js";
import type { IDebugClock } from "./DebugClock.js";
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
  /** When true, stop the renderer ticker and advance simulation manually via `window.__yage__.clock`. */
  manualClock?: boolean;
  /** Key code to advance one fixed-timestep frame while manual clock mode is active. Default: "Period" */
  stepKey?: string;
  /** Max pooled Graphics objects. Default: 256 */
  maxGraphics?: number;
  /** Max HUD text lines. Default: 32 */
  maxHudLines?: number;
  /** Whether the overlay starts enabled. Default: false */
  startEnabled?: boolean;
  /** Initial flag overrides, keyed by "contributorName.flagName". */
  flags?: Record<string, boolean>;
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
      if (e.code === stepKey && this.clock?.isManual) {
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

    // Manual clock for deterministic stepping
    const gameLoop = this.context.resolve(GameLoopKey);
    const app = this.renderer.application;
    this.clock = new DebugClock(
      gameLoop,
      () => app.stop(),
      () => app.start(),
      () => app.render(),
    );
    if (this.config.manualClock) {
      this.clock.setManual(true);
    }
    this.attachToGlobal(this.clock);

    // Materialize the debug scene off-stack. `_mountDetached` routes through
    // the same beforeEnter hooks as `push`, so the renderer materializes the
    // debug scene's tree and registers SceneRenderTreeKey on its scope.
    this.provider = this.context.tryResolve(SceneRenderTreeProviderKey) ?? null;
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

  private setUpDebugInfra(
    worldContainer: Container,
    hudContainer: Container,
  ): void {
    const camera = this.context.resolve(CameraKey);

    this.graphicsPool = new GraphicsPool(
      worldContainer,
      this.config.maxGraphics,
    );
    this.textPool = new TextPool(hudContainer, this.config.maxHudLines);

    this.worldApi = new WorldDebugApiImpl(
      this.graphicsPool,
      this.registry,
      camera,
    );
    this.hudApi = new HudDebugApiImpl(
      this.textPool,
      this.registry,
      camera.viewportWidth,
      camera.viewportHeight,
    );

    this.renderSystem = new DebugRenderSystem(
      this.registry,
      this.graphicsPool,
      this.textPool,
      this.worldApi,
      this.hudApi,
      this.stats,
      worldContainer,
      hudContainer,
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
