import {
  System,
  Phase,
  Transform,
  QueryCacheKey,
  ErrorBoundaryKey,
} from "@yagejs/core";
import type {
  EngineContext,
  ErrorBoundary,
  QueryResult,
  Scene,
} from "@yagejs/core";
import type { SceneRenderTreeProvider } from "./SceneRenderTree.js";
import { SceneRenderTreeProviderKey } from "./SceneRenderTree.js";
import { CameraComponent } from "./CameraComponent.js";
import {
  SortGroupComponent,
  sortGroupForContainer,
} from "./SortGroupComponent.js";
import type { Container } from "pixi.js";
import { VisualComponent } from "./VisualComponent.js";
import { attributed } from "./internal/attribution.js";

/**
 * Syncs Transform components to PixiJS display objects and applies
 * camera-based per-layer transforms. Each scene's CameraEntity bindings
 * determine which layers receive the camera transform; unbound layers
 * stay at identity (screen-space behavior).
 */
export class DisplaySystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 0;

  private visualQuery!: QueryResult;
  private cameraQuery!: QueryResult;
  private sortGroupQuery!: QueryResult;
  private treeProvider!: SceneRenderTreeProvider;
  private boundary: ErrorBoundary | undefined;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.visualQuery = queryCache.register([Transform, VisualComponent]);
    this.cameraQuery = queryCache.register([CameraComponent]);
    this.sortGroupQuery = queryCache.register([SortGroupComponent]);
    this.treeProvider = context.resolve(SceneRenderTreeProviderKey);
    this.boundary = context.tryResolve(ErrorBoundaryKey);
  }

  update(): void {
    // 1. Sync transforms to display objects. One entity can carry several
    //    visuals of different classes (a background plus a label), so every
    //    assignable component is synced, not just the first.
    for (const entity of this.visualQuery) {
      const transform = entity.get(Transform);
      for (const visual of entity.getAll(VisualComponent)) {
        if (!visual.effectiveEnabled) continue;
        this.syncDisplayObject(transform, visual.renderObject as Container);
      }
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
    for (const entity of this.visualQuery) {
      for (const visual of entity.getAll(VisualComponent)) {
        if (visual.effectiveEnabled) this.applyModifiers(visual);
      }
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
    for (const [scene, tree] of this.treeProvider.allTrees()) {
      for (const layer of tree.getAll()) {
        const sort = layer.sort;
        if (!sort) continue;
        const info = {
          kind: "Layer depth-key function",
          scene: scene.name,
          event: layer.name,
        };
        for (const child of layer.container.children) {
          const group = sortGroupForContainer(child);
          child.zIndex = attributed(this.boundary, info, () =>
            group ? group.resolveSortKey(sort) : sort(child),
          );
        }
      }
    }

    // Pass 2: intra-group member ordering. A group with an `innerSort` re-keys
    // its own members each frame (independent of whether its layer has a sort);
    // groups without one keep insertion order and honour a manual `zIndex`. A
    // disabled group is skipped, matching the visual sync pass.
    for (const entity of this.sortGroupQuery) {
      const group = entity.get(SortGroupComponent);
      const inner = group.innerSort;
      if (!inner || !group.effectiveEnabled) continue;
      const info = {
        kind: "Sort group innerSort function",
        entity: entity.name,
      };
      for (const member of group.container.children) {
        member.zIndex = attributed(this.boundary, info, () => inner(member));
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
