import type { EngineContext, SystemScheduler, Plugin, EngineEvents, Scene } from "@yagejs/core";
import { EventBusKey } from "@yagejs/core";
import type { EventBus } from "@yagejs/core";
import { DebugRegistryKey } from "@yagejs/debug/api";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";
import { PhysicsWorldManagerKey } from "./types.js";
import type { PhysicsConfig } from "./types.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { PhysicsDebugContributor } from "./PhysicsDebugContributor.js";

/**
 * Physics plugin that installs Rapier2D physics into the YAGE engine.
 *
 * Creates a {@link PhysicsWorldManager} that manages per-scene Rapier worlds,
 * and registers two systems:
 * - PhysicsSystem (FixedUpdate, priority 0)
 * - PhysicsInterpolationSystem (LateUpdate, priority 100)
 */
export class PhysicsPlugin implements Plugin {
  readonly name = "physics";
  readonly version = "2.0.0";

  private readonly config: PhysicsConfig | undefined;
  private manager!: PhysicsWorldManager;
  private context!: EngineContext;

  constructor(config?: PhysicsConfig) {
    this.config = config;
  }

  install(context: EngineContext): void {
    this.context = context;
    this.manager = new PhysicsWorldManager(this.config);
    context.register(PhysicsWorldManagerKey, this.manager);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new PhysicsSystem());
    scheduler.add(new PhysicsInterpolationSystem());
  }

  onStart(): void {
    // Debug contributor
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new PhysicsDebugContributor(this.manager));

    // Destroy per-scene worlds when scenes exit
    const bus = this.context.tryResolve(EventBusKey) as
      | EventBus<EngineEvents>
      | undefined;
    if (bus) {
      // SceneManager emits the actual Scene instance, but EngineEvents
      // types the payload as SceneRef ({ name: string }) for decoupling.
      // The cast is safe because the Map is keyed by object identity and
      // SceneManager always passes the real Scene object.
      bus.on("scene:popped", ({ scene }) => {
        this.manager.destroyWorld(scene as Scene);
      });
      bus.on("scene:replaced", ({ oldScene }) => {
        this.manager.destroyWorld(oldScene as Scene);
      });
    }
  }

  onDestroy(): void {
    this.manager.destroy();
  }
}
