import {
  System,
  Phase,
  Transform,
  QueryCacheKey,
  SceneTimeKey,
} from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

/** System that drives all ParticleEmitterComponents each frame. */
export class ParticleSystem extends System {
  readonly phase = Phase.Update;
  readonly priority = 0;

  private query!: QueryResult;

  onRegister(context: EngineContext): void {
    this.query = context
      .resolve(QueryCacheKey)
      .register([Transform, ParticleEmitterComponent]);
  }

  update(dt: number): void {
    for (const entity of this.query) {
      const scene = entity.tryScene;
      if (scene?.isPaused) continue;
      // Per-entity SceneTime scale so freeze/slow-mo requests (and their
      // excludeUpdates exclusions) apply to emitters like component updates.
      const time = scene?.tryResolveScoped(SceneTimeKey);
      const sceneTimeScale =
        time?.effectiveScaleForUpdates(entity) ?? scene?.timeScale ?? 1;
      const emitter = entity.get(ParticleEmitterComponent);
      if (!emitter.enabled) continue;
      const pos = entity.get(Transform).position;
      emitter._update(
        dt * sceneTimeScale * entity.timeScale,
        pos.x,
        pos.y,
      );
    }
  }
}
