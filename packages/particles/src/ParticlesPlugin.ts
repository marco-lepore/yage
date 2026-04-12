import type { Plugin, SystemScheduler } from "@yagejs/core";
import { ParticleSystem } from "./ParticleSystem.js";

/** Plugin that registers the particle system. Depends on the renderer plugin. */
export class ParticlesPlugin implements Plugin {
  readonly name = "particles";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"] as const;

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new ParticleSystem());
  }
}
