import { System, Phase, Transform, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { TilemapComponent } from "./TilemapComponent.js";

/** Syncs authoritative transforms and render-only modifiers to tilemaps. */
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

      const modifiers = tilemap.modifiers;
      tilemap.container.position.x =
        transform.worldPosition.x + modifiers.positionOffset.x;
      tilemap.container.position.y =
        transform.worldPosition.y + modifiers.positionOffset.y;
      tilemap.container.rotation =
        transform.worldRotation + modifiers.rotationOffset;
      tilemap.container.scale.x =
        transform.worldScale.x * modifiers.scaleFactor.x;
      tilemap.container.scale.y =
        transform.worldScale.y * modifiers.scaleFactor.y;
    }
  }
}
