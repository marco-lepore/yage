import {
  System,
  Phase,
  Transform,
  QueryCacheKey,
} from "@yagejs/core";
import type { EngineContext, QueryResult, Scene } from "@yagejs/core";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import { SceneRenderTreeProviderKey } from "./SceneRenderTree.js";
import { CameraComponent } from "./CameraComponent.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import type { Container } from "pixi.js";

/**
 * Syncs Transform components to PixiJS display objects and applies
 * camera-based per-layer transforms. Each scene's CameraEntity bindings
 * determine which layers receive the camera transform; unbound layers
 * stay at identity (screen-space behavior).
 */
export class DisplaySystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 0;

  private spriteQuery!: QueryResult;
  private graphicsQuery!: QueryResult;
  private animatedSpriteQuery!: QueryResult;
  private cameraQuery!: QueryResult;
  private treeProvider!: SceneRenderTreeProvider;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.spriteQuery = queryCache.register([Transform, SpriteComponent]);
    this.graphicsQuery = queryCache.register([Transform, GraphicsComponent]);
    this.animatedSpriteQuery = queryCache.register([
      Transform,
      AnimatedSpriteComponent,
    ]);
    this.cameraQuery = queryCache.register([CameraComponent]);
    this.treeProvider = context.resolve(SceneRenderTreeProviderKey);
  }

  update(): void {
    // 1. Sync transforms to display objects
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

    // 2. Apply camera transforms to layers
    this.applyCameraTransforms();
  }

  private applyCameraTransforms(): void {
    // Reset every live scene's layers to identity. This must cover scenes
    // even when they have no active camera — otherwise layers keep the last
    // transform after the final camera is destroyed/disabled.
    for (const [, tree] of this.treeProvider.allTrees()) {
      for (const layer of tree.getAll()) {
        const c = layer.container;
        c.position.set(0, 0);
        c.scale.set(1, 1);
        c.rotation = 0;
      }
    }

    const camerasByScene = new Map<Scene, CameraComponent[]>();
    for (const entity of this.cameraQuery) {
      const cam = entity.get(CameraComponent);
      const scene = entity.scene;
      if (!scene || !cam.enabled) continue;
      const list = camerasByScene.get(scene);
      if (list) list.push(cam);
      else camerasByScene.set(scene, [cam]);
    }

    for (const [scene, cameras] of camerasByScene) {
      const tree = this.treeProvider.getTree(scene);
      if (!tree) continue;

      cameras.sort((a, b) => a.priority - b.priority);

      for (const cam of cameras) {
        const bindings = cam.getResolvedBindings(tree);
        const pos = cam.effectivePosition;

        for (const binding of bindings) {
          const layer = tree.tryGet(binding.layer);
          if (!layer) continue;

          const c = layer.container;
          const ratio = binding.translateRatio ?? 1;
          c.position.x = cam.viewportWidth / 2 - pos.x * cam.zoom * ratio;
          c.position.y = cam.viewportHeight / 2 - pos.y * cam.zoom * ratio;
          c.scale.set(cam.zoom);
          c.rotation = -cam.rotation;
        }
      }
    }
  }

  private syncDisplayObject(
    transform: Transform,
    displayObject: Container,
  ): void {
    displayObject.position.x = transform.worldPosition.x;
    displayObject.position.y = transform.worldPosition.y;
    displayObject.rotation = transform.worldRotation;
    displayObject.scale.x = transform.worldScale.x;
    displayObject.scale.y = transform.worldScale.y;
  }
}
