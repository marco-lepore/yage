import { System, Phase, Transform, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult, Scene } from "@yagejs/core";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import { SceneRenderTreeProviderKey } from "./SceneRenderTree.js";
import { CameraComponent } from "./CameraComponent.js";
import { SpriteComponent } from "./SpriteComponent.js";
import { GraphicsComponent } from "./GraphicsComponent.js";
import { AnimatedSpriteComponent } from "./AnimatedSpriteComponent.js";
import { TextComponent } from "./TextComponent.js";
import { SplitTextComponent } from "./SplitTextComponent.js";
import {
  SortGroupComponent,
  sortGroupForContainer,
} from "./SortGroupComponent.js";
import type { Container } from "pixi.js";
import type { VisualComponent } from "./VisualComponent.js";

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
  private textQuery!: QueryResult;
  private splitTextQuery!: QueryResult;
  private cameraQuery!: QueryResult;
  private sortGroupQuery!: QueryResult;
  private treeProvider!: SceneRenderTreeProvider;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.spriteQuery = queryCache.register([Transform, SpriteComponent]);
    this.graphicsQuery = queryCache.register([Transform, GraphicsComponent]);
    this.animatedSpriteQuery = queryCache.register([
      Transform,
      AnimatedSpriteComponent,
    ]);
    this.textQuery = queryCache.register([Transform, TextComponent]);
    this.splitTextQuery = queryCache.register([Transform, SplitTextComponent]);
    this.cameraQuery = queryCache.register([CameraComponent]);
    this.sortGroupQuery = queryCache.register([SortGroupComponent]);
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

    for (const entity of this.textQuery) {
      const transform = entity.get(Transform);
      const text = entity.get(TextComponent);
      if (!text.enabled) continue;
      this.syncDisplayObject(transform, text.text);
    }

    for (const entity of this.splitTextQuery) {
      const transform = entity.get(Transform);
      const splitText = entity.get(SplitTextComponent);
      if (!splitText.enabled) continue;
      this.syncDisplayObject(transform, splitText.splitText);
    }

    // 2. Apply per-layer depth keys. Runs AFTER authoritative transform sync so
    //    position-based depth keys see the frame's current values.
    //    Order vs. camera transforms doesn't matter — we're writing
    //    `zIndex`, which Pixi's render-time `sortChildren()` consumes;
    //    the camera transform on the layer container is independent.
    this.applyLayerSort();

    // 3. Apply render-only modifiers after sorting. Transient shake and punch
    //    offsets do not change an entity's stable depth key.
    this.applyVisualModifiers();

    // 4. Apply camera transforms to layers
    this.applyCameraTransforms();
  }

  private applyVisualModifiers(): void {
    for (const entity of this.spriteQuery) {
      const visual = entity.get(SpriteComponent);
      if (visual.enabled) this.applyModifiers(visual);
    }
    for (const entity of this.graphicsQuery) {
      const visual = entity.get(GraphicsComponent);
      if (visual.enabled) this.applyModifiers(visual);
    }
    for (const entity of this.animatedSpriteQuery) {
      const visual = entity.get(AnimatedSpriteComponent);
      if (visual.enabled) this.applyModifiers(visual);
    }
    for (const entity of this.textQuery) {
      const visual = entity.get(TextComponent);
      if (visual.enabled) this.applyModifiers(visual);
    }
    for (const entity of this.splitTextQuery) {
      const visual = entity.get(SplitTextComponent);
      if (visual.enabled) this.applyModifiers(visual);
    }
  }

  private applyModifiers(visual: VisualComponent): void {
    const modifiers = visual.modifiers;
    if (!modifiers.hasTransformModifiers) return;
    const displayObject = visual.renderObject as Container;
    displayObject.position.x += modifiers.positionOffset.x;
    displayObject.position.y += modifiers.positionOffset.y;
    displayObject.rotation += modifiers.rotationOffset;
    displayObject.scale.x *= modifiers.scaleFactor.x;
    displayObject.scale.y *= modifiers.scaleFactor.y;
  }

  /**
   * Per-frame depth-key hook. For every layer with a `sort` fn, writes
   * `child.zIndex = sort(child)` on every direct child. The layer's
   * container already has `sortableChildren = true` (set in `RenderLayer`),
   * so Pixi's render-pipeline sort runs at frame end and orders the
   * children by zIndex — no custom sort path on our side. Pixi's
   * `zIndex` setter marks `sortDirty` automatically, so we don't need
   * to flip it ourselves.
   *
   * A `SortGroupComponent`'s container is a direct child of the layer too, but
   * sorting it by its own (origin) position would be meaningless — it's keyed
   * off the group's anchor instead, so the whole group sorts as one unit. The
   * group's members are nested inside it, so this layer-level pass never
   * touches them; an optional `innerSort` re-keys them in a second pass.
   *
   * Layers without a `sort` keep insertion order.
   */
  private applyLayerSort(): void {
    // Pass 1: key every sorted layer's direct children. A group container is
    // keyed off its anchor (so the whole group sorts as one unit); everything
    // else by the layer's depth-key fn. `sortGroupForContainer` is an O(1)
    // registry lookup — no per-frame allocation in this hot path.
    for (const [, tree] of this.treeProvider.allTrees()) {
      for (const layer of tree.getAll()) {
        const sort = layer.sort;
        if (!sort) continue;
        for (const child of layer.container.children) {
          const group = sortGroupForContainer(child);
          child.zIndex = group ? group.resolveSortKey(sort) : sort(child);
        }
      }
    }

    // Pass 2: intra-group member ordering. A group with an `innerSort` re-keys
    // its own members each frame (independent of whether its layer has a sort);
    // groups without one keep insertion order and honour a manual `zIndex`.
    for (const entity of this.sortGroupQuery) {
      const group = entity.get(SortGroupComponent);
      const inner = group.innerSort;
      if (!inner) continue;
      for (const member of group.container.children) {
        member.zIndex = inner(member);
      }
    }
  }

  /**
   * Apply per-layer camera transforms for every live scene.
   *
   * Layers are reset to identity first so disabling or destroying the last
   * camera cannot leave stale transforms behind on a scene's containers.
   *
   * Within a scene, enabled cameras are sorted by ascending `priority`; when
   * multiple cameras bind the same layer, the later write wins, so the
   * highest-priority camera fully overwrites translation, scale, and rotation
   * rather than blending with earlier cameras.
   *
   * Each binding's three ratios (`translateRatio`, `rotateRatio`, `scaleRatio`)
   * independently blend from identity (`0`) to full camera effect (`1`). All
   * default to `1`, matching the classic "this layer follows the camera"
   * behavior. Parallax is `translateRatio < 1`; a billboard layer is
   * `rotateRatio: 0, scaleRatio: 0`.
   */
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
      const scene = entity.tryScene;
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

          const translateRatio = binding.translateRatio ?? 1;
          const rotateRatio = binding.rotateRatio ?? 1;
          const scaleRatio = binding.scaleRatio ?? 1;

          // Blend each axis from identity toward full camera effect. When
          // all three ratios are 1 (the default), this reduces to the
          // classic camera transform exactly.
          const effScale = 1 + (cam.effectiveZoom - 1) * scaleRatio;
          const effRot = cam.effectiveRotation * rotateRatio;
          const translated = pos
            .scale(effScale * translateRatio)
            .rotate(-effRot);

          const c = layer.container;
          c.position.x = cam.viewportWidth / 2 - translated.x;
          c.position.y = cam.viewportHeight / 2 - translated.y;
          c.scale.set(effScale);
          c.rotation = -effRot;
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
