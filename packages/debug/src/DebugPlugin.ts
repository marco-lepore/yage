import {
  SystemSchedulerKey,
  InspectorKey,
} from "@yage/core";
import type { EngineContext, Plugin, SystemScheduler, System } from "@yage/core";
import { DebugRegistryKey } from "./types.js";
import type { Container } from "pixi.js";
import { RendererKey, RenderLayerManagerKey, CameraKey } from "@yage/renderer";
import type { RendererPlugin } from "@yage/renderer";
import { DebugRegistryImpl } from "./DebugRegistryImpl.js";
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
  /** Max pooled Graphics objects. Default: 256 */
  maxGraphics?: number;
  /** Max HUD text lines. Default: 32 */
  maxHudLines?: number;
  /** Whether the overlay starts enabled. Default: false */
  startEnabled?: boolean;
  /** Initial flag overrides, keyed by "contributorName.flagName". */
  flags?: Record<string, boolean>;
}

/** Debug overlay plugin. Depends on the renderer plugin. */
export class DebugPlugin implements Plugin {
  readonly name = "debug";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"] as const;

  private readonly config: DebugConfig;
  private registry!: DebugRegistryImpl;
  private stats!: StatsStore;
  private graphicsPool!: GraphicsPool;
  private textPool!: TextPool;
  private worldContainer!: Container;
  private hudContainer!: Container;
  private worldApi!: WorldDebugApiImpl;
  private hudApi!: HudDebugApiImpl;
  private systemTimings = new Map<string, number>();
  private originalUpdates = new Map<System, (dt: number) => void>();
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private context!: EngineContext;
  private renderer!: RendererPlugin;

  constructor(config?: DebugConfig) {
    this.config = config ?? {};
  }

  install(context: EngineContext): void {
    this.context = context;

    this.renderer = context.resolve(RendererKey);
    const camera = context.resolve(CameraKey);

    // World-space debug layer (child of world container, drawn on top)
    const worldLayers = context.resolve(RenderLayerManagerKey);
    const debugLayer = worldLayers.getOrCreate("debug", 999999);
    this.worldContainer = debugLayer.container;
    this.worldContainer.eventMode = "none";

    // Screen-space HUD container (sibling of world container, unaffected by camera)
    const hudLayers = this.renderer.createScreenContainer("debug-hud");
    this.hudContainer = hudLayers.defaultLayer.container;
    this.hudContainer.eventMode = "none";

    this.graphicsPool = new GraphicsPool(
      this.worldContainer,
      this.config.maxGraphics,
    );
    this.textPool = new TextPool(
      this.hudContainer,
      this.config.maxHudLines,
    );

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

    context.register(DebugRegistryKey, this.registry);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(
      new DebugRenderSystem(
        this.registry,
        this.graphicsPool,
        this.textPool,
        this.worldApi,
        this.hudApi,
        this.stats,
        this.worldContainer,
        this.hudContainer,
      ),
    );
  }

  onStart(): void {
    // Toggle key listener
    const toggleKey = this.config.toggleKey ?? "Backquote";
    this.keyListener = (e: KeyboardEvent) => {
      if (e.code === toggleKey) this.registry.toggle();
    };
    window.addEventListener("keydown", this.keyListener);

    // Instrument system timings
    const scheduler = this.context.resolve(SystemSchedulerKey);
    for (const system of scheduler.getAllSystems()) {
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
  }

  onDestroy(): void {
    // Restore original system.update methods
    for (const [system, original] of this.originalUpdates) {
      system.update = original;
    }
    this.originalUpdates.clear();

    if (this.keyListener) {
      window.removeEventListener("keydown", this.keyListener);
      this.keyListener = null;
    }

    for (const contributor of this.registry.contributors.values()) {
      contributor.dispose?.();
    }
    this.registry.contributors.clear();

    this.graphicsPool.destroy();
    this.textPool.destroy();
    // worldContainer is owned by the world RenderLayerManager — don't destroy it
    this.renderer.destroyScreenContainer("debug-hud");
  }
}
