import {
  System,
  Phase,
  Transform,
  Vec2Buffer,
  QueryCacheKey,
  SceneTimeKey,
} from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

/**
 * System that drives all ParticleEmitterComponents each frame. Runs in
 * `LateUpdate` so it reads the frame's final `Transform`: component updates
 * have already moved their entities, so an emitter's container and its new
 * particles land where the entity is drawn this frame, not where it was last
 * frame.
 */
export class ParticleSystem extends System {
  private readonly positionScratch = new Vec2Buffer();
  readonly phase = Phase.LateUpdate;
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
      // World position, so parented emitters spawn where they are drawn: the
      // emitter's container follows it and particles are local to that.
      const pos = entity
        .get(Transform)
        .getWorldPositionInto(this.positionScratch);
      emitter._update(dt * sceneTimeScale * entity.timeScale, pos.x, pos.y);
    }
  }
}
