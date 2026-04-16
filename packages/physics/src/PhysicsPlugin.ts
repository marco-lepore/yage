import type { EngineContext, SystemScheduler, Plugin } from "@yagejs/core";
import { SceneHookRegistryKey } from "@yagejs/core";
import { DebugRegistryKey } from "@yagejs/debug/api";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { PhysicsWorldKey, PhysicsWorldManagerKey } from "./types.js";
import type { PhysicsConfig } from "./types.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { PhysicsDebugContributor } from "./PhysicsDebugContributor.js";

/**
 * Physics plugin that installs Rapier2D physics into the YAGE engine.
 *
 * Creates a {@link PhysicsWorldManager} that owns per-scene Rapier worlds,
 * and registers two systems:
 * - PhysicsSystem (FixedUpdate, priority 0)
 * - PhysicsInterpolationSystem (LateUpdate, priority 100)
 *
 * Per-scene worlds are created in a `beforeEnter` scene hook and destroyed
 * in `afterExit`. Components access the active scene's world via
 * `this.use(PhysicsWorldKey)`.
 */
export class PhysicsPlugin implements Plugin {
  readonly name = "physics";
  readonly version = "3.0.0";

  private readonly config: PhysicsConfig | undefined;
  private manager!: PhysicsWorldManager;
  private context!: EngineContext;
  private unregisterHooks: (() => void) | null = null;

  constructor(config?: PhysicsConfig) {
    this.config = config;
  }

  install(context: EngineContext): void {
    this.context = context;
    this.manager = new PhysicsWorldManager(this.config);
    context.register(PhysicsWorldManagerKey, this.manager);

    const hookRegistry = context.resolve(SceneHookRegistryKey);
    this.unregisterHooks = hookRegistry.register({
      beforeEnter: (scene) => {
        const world = this.manager.getOrCreateWorld(scene);
        scene._registerScoped(PhysicsWorldKey, world);
      },
      afterExit: (scene) => {
        this.manager.destroyWorld(scene);
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new PhysicsSystem());
    scheduler.add(new PhysicsInterpolationSystem());
  }

  onStart(): void {
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new PhysicsDebugContributor(this.manager));
  }

  onDestroy(): void {
    this.unregisterHooks?.();
    this.unregisterHooks = null;
    this.manager.destroy();
  }
}
