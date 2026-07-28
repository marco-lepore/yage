import { ErrorBoundaryKey, SceneHookRegistryKey } from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { LightingSystem } from "./LightingSystem.js";
import { LightingWorldManager } from "./LightingWorldManager.js";
import { overlayLighting } from "./OverlayLightingRenderer.js";
import { LightingWorldKey, LightingWorldManagerKey } from "./types.js";
import type { LightingConfig } from "./types.js";

/** Installs per-scene lighting worlds and the render-phase lighting system. */
export class LightingPlugin implements Plugin {
  readonly name = "lighting";
  readonly version = "1.0.0";
  readonly dependencies = ["renderer"] as const;

  private readonly config: LightingConfig;
  private manager: LightingWorldManager | undefined;
  private unregisterHooks: (() => void) | null = null;

  constructor(config: LightingConfig = {}) {
    this.config = config;
  }

  install(context: EngineContext): void {
    const renderer = context.resolve(RendererKey);
    const factory =
      this.config.renderer === undefined
        ? overlayLighting()
        : this.config.renderer;
    const manager = new LightingWorldManager(
      renderer,
      this.config.ambient ?? {},
      factory,
      context.tryResolve(ErrorBoundaryKey),
    );
    this.manager = manager;
    context.register(LightingWorldManagerKey, manager);

    const hooks = context.resolve(SceneHookRegistryKey);
    this.unregisterHooks = hooks.register({
      beforeEnter: (scene) => {
        const world = manager.getOrCreateWorld(scene);
        scene.registerScoped(LightingWorldKey, world);
      },
      afterExit: (scene) => {
        manager.destroyWorld(scene);
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new LightingSystem());
  }

  onDestroy(): void {
    this.unregisterHooks?.();
    this.unregisterHooks = null;
    this.manager?.destroy();
    this.manager = undefined;
  }
}
