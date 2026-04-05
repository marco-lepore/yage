import type { EngineContext, SystemScheduler, Plugin } from "@yage/core";
import { DebugRegistryKey } from "@yage/debug/api";
import { PhysicsWorld } from "./PhysicsWorld.js";
import { PhysicsWorldKey, PhysicsInterpolationAlphaKey } from "./types.js";
import type { PhysicsConfig } from "./types.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { PhysicsDebugContributor } from "./PhysicsDebugContributor.js";

/**
 * Physics plugin that installs Rapier2D physics into the YAGE engine.
 *
 * Registers the PhysicsWorld service and two systems:
 * - PhysicsSystem (FixedUpdate, priority 0)
 * - PhysicsInterpolationSystem (LateUpdate, priority 100)
 */
export class PhysicsPlugin implements Plugin {
  readonly name = "physics";
  readonly version = "2.0.0";

  private readonly config: PhysicsConfig | undefined;
  private physicsWorld!: PhysicsWorld;
  private context!: EngineContext;

  constructor(config?: PhysicsConfig) {
    this.config = config;
  }

  install(context: EngineContext): void {
    this.context = context;
    this.physicsWorld = new PhysicsWorld(this.config);
    context.register(PhysicsWorldKey, this.physicsWorld);
    context.register(PhysicsInterpolationAlphaKey, { value: 0 });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new PhysicsSystem());
    scheduler.add(new PhysicsInterpolationSystem());
  }

  onStart(): void {
    const registry = this.context.tryResolve(DebugRegistryKey);
    registry?.register(new PhysicsDebugContributor(this.physicsWorld));
  }

  onDestroy(): void {
    this.physicsWorld.destroy();
  }
}
