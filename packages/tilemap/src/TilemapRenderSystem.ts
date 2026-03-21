import { System, Phase, Transform, QueryCacheKey } from "@yage/core";
import type { EngineContext, QueryResult } from "@yage/core";
import { TilemapComponent } from "./TilemapComponent.js";

/** Syncs Transform to TilemapComponent display containers. */
export class TilemapRenderSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = -1; // Before DisplaySystem (0), so tilemaps render behind sprites

  private query!: QueryResult;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.query = queryCache.register([Transform, TilemapComponent]);
  }

  update(): void {
    for (const entity of this.query) {
      const transform = entity.get(Transform);
      const tilemap = entity.get(TilemapComponent);
      if (!tilemap.enabled) continue;

      tilemap.container.position.x = transform.worldPosition.x;
      tilemap.container.position.y = transform.worldPosition.y;
      tilemap.container.rotation = transform.worldRotation;
      tilemap.container.scale.x = transform.worldScale.x;
      tilemap.container.scale.y = transform.worldScale.y;
    }
  }
}
