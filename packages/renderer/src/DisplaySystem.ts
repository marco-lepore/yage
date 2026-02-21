import {
  System,
  Phase,
  Transform,
  QueryCacheKey,
} from "@yage/core";
import type { EngineContext, QueryResult } from "@yage/core";
import type { Container } from "pixi.js";
import { CameraKey, StageKey } from "./types.js";
import type { Camera } from "./Camera.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";

/** Syncs Transform components to PixiJS display objects and applies the camera. */
export class DisplaySystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 0;

  private spriteQuery!: QueryResult;
  private graphicsQuery!: QueryResult;
  private animatedSpriteQuery!: QueryResult;
  private camera!: Camera;
  private stage!: Container;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.spriteQuery = queryCache.register([Transform, SpriteComponent]);
    this.graphicsQuery = queryCache.register([Transform, GraphicsComponent]);
    this.animatedSpriteQuery = queryCache.register([Transform, AnimatedSpriteComponent]);

    this.camera = context.resolve(CameraKey);
    this.stage = context.resolve(StageKey);
  }

  update(dt: number): void {
    // 1. Update camera state (follow, shake, zoom)
    this.camera.update(dt);

    // 2. Sync transforms to display objects
    for (const entity of this.spriteQuery) {
      const transform = entity.get(Transform);
      const sprite = entity.get(SpriteComponent);
      if (!sprite.enabled) continue;
      this.syncDisplayObject(transform, sprite.sprite);
    }

    for (const entity of this.graphicsQuery) {
      const transform = entity.get(Transform);
      const graphics = entity.get(GraphicsComponent);
      if (!graphics.enabled) continue;
      this.syncDisplayObject(transform, graphics.graphics);
    }

    for (const entity of this.animatedSpriteQuery) {
      const transform = entity.get(Transform);
      const anim = entity.get(AnimatedSpriteComponent);
      if (!anim.enabled) continue;
      this.syncDisplayObject(transform, anim.animatedSprite);
    }

    // 3. Apply camera transform to stage
    const cam = this.camera;
    const effPos = cam.effectivePosition;
    this.stage.position.x = cam.viewportWidth / 2 - effPos.x * cam.zoom;
    this.stage.position.y = cam.viewportHeight / 2 - effPos.y * cam.zoom;
    this.stage.scale.x = cam.zoom;
    this.stage.scale.y = cam.zoom;
    this.stage.rotation = -cam.rotation;
  }

  private syncDisplayObject(
    transform: Transform,
    displayObject: Container,
  ): void {
    displayObject.position.x = transform.position.x;
    displayObject.position.y = transform.position.y;
    displayObject.rotation = transform.rotation;
    displayObject.scale.x = transform.scale.x;
    displayObject.scale.y = transform.scale.y;
  }
}
