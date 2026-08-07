import { System, Phase, Transform, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { TilemapComponent } from "./TilemapComponent.js";

/** Syncs Transform to TilemapComponent display containers. */
export class TilemapRenderSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = -1; // Before DisplaySystem (0), so tilemaps render behind sprites

  private transformQuery!: QueryResult;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.transformQuery = queryCache.register([Transform, TilemapComponent]);
  }

  update(): void {
    for (const entity of this.transformQuery) {
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
