import { Component, Transform, serializable } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Container } from "pixi.js";
import type { LayerSortFn } from "./LayerDef.js";
import type { SceneRenderTree } from "./SceneRenderTree.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";

/**
 * Contract every single-display-object visual component satisfies: a layer
 * name plus the Pixi object it renders. `SortGroupComponent` uses this to
 * gather a subtree's visuals into its container without importing the concrete
 * component classes (which would create an import cycle).
 */
export interface LayerRenderable {
  /** Name of the layer this component renders into. */
  readonly layerName: string;
  /** The underlying Pixi display object. */
  readonly renderObject: Container;
}

/**
 * Duck-typed check for {@link LayerRenderable}. Visual components expose a
 * `renderObject` getter; nothing else in the engine does, so a positive match
 * is reliable without an `instanceof` against five concrete classes.
 */
function isLayerRenderable(
  component: Component,
): component is Component & LayerRenderable {
  const candidate = component as Partial<LayerRenderable>;
  return (
    typeof candidate.layerName === "string" && candidate.renderObject != null
  );
}

/**
 * Resolve the Pixi container a visual should render into: the nearest ancestor
 * {@link SortGroupComponent} bound to the same layer, or the layer container
 * itself when there is no enclosing group. Walks the entity hierarchy starting
 * at `entity` (inclusive), so a visual on a group-owning entity joins that
 * group.
 *
 * @internal Used by the visual components' `onAdd`.
 */
export function resolveRenderParent(
  entity: Entity,
  layerName: string,
  tree: SceneRenderTree,
): Container {
  let current: Entity | null = entity;
  while (current) {
    const group = current.tryGet(SortGroupComponent);
    if (group && group.layer === layerName) return group.container;
    current = current.parent;
  }
  return tree.get(layerName).container;
}

/** Options for {@link SortGroupComponent}. */
export interface SortGroupComponentOptions {
  /**
   * Layer the group renders into. Visuals in the entity's subtree that target
   * this same layer are gathered into the group; visuals targeting a different
   * layer are left alone (so a child's shadow can still live on a separate
   * `"ground"` layer). Default: `"default"`.
   */
  layer?: string;
  /**
   * Optional depth key for ordering the group's own members. Default (unset):
   * members keep insertion order, and any member's manually-set `zIndex` is
   * honoured — a real stacking context, matching Unity's `SortingGroup`. Pass
   * `ySort` (or any {@link LayerSortFn}) to instead order members by position
   * among themselves, while the group as a whole still sorts as one unit
   * against the rest of the layer.
   */
  innerSort?: LayerSortFn;
}

/** Serialisable snapshot of a {@link SortGroupComponent}. */
export interface SortGroupData {
  layer: string;
}

/**
 * Renders an entity's subtree of visuals as a single depth unit.
 *
 * Under a layer `sort` (e.g. `ySort`) every sprite is otherwise a flat child of
 * the layer with its own independent depth key, so a multi-part entity — a body
 * plus an offset held item, or a parent plus child entities — can be split when
 * an unrelated entity's key falls between its parts. A `SortGroupComponent`
 * gives the entity its own Pixi sub-container: the members sort *within* the
 * group, and the group sorts as **one unit** against the rest of the layer
 * (keyed off the group-owning entity's own sprite, falling back to its
 * `Transform` position when it has no sprite of its own).
 *
 * The group container is kept at identity/origin, so members hold their normal
 * world transforms — adding a group changes paint **order** only, never
 * position, rotation, or scale (those stay composed by the ECS `Transform`).
 *
 * ```ts
 * class Knight extends Entity {
 *   setup() {
 *     this.add(new Transform({ position: { x: 200, y: 200 } }));
 *     this.add(new SortGroupComponent({ layer: "world" }));
 *     this.add(new SpriteComponent({ texture: "knight-body", layer: "world" }));
 *     // Child sprites on the "world" layer join the group automatically:
 *     this.spawnChild("weapon", Weapon); // a sprite offset toward the camera
 *     this.spawnChild("plume", Plume);
 *   }
 * }
 * ```
 *
 * Add the component **before** the visuals it should capture (it also re-homes
 * any already-present subtree visuals when added late, and after save/load).
 * A `SortGroupComponent` on a descendant entity starts its own independent
 * unit rather than nesting inside the ancestor's.
 */
@serializable
export class SortGroupComponent extends Component {
  /** The group's Pixi container. Kept at identity; holds the member visuals. */
  readonly container: Container;
  /** Layer this group renders into. */
  readonly layer: string;
  /** Depth key for intra-group member order, or `undefined` for insertion order. */
  innerSort: LayerSortFn | undefined;
  /** Lazily-created stand-in used for the group's sort key when the owning
   * entity has no sprite of its own. */
  private _proxy: Container | undefined;

  constructor(options?: SortGroupComponentOptions) {
    super();
    this.layer = options?.layer ?? "default";
    this.innerSort = options?.innerSort;
    this.container = new Container();
    this.container.label = `sort-group:${this.layer}`;
    // Members order by their own zIndex; default 0 keeps stable insertion order
    // and lets a member opt above/below its siblings with a manual zIndex.
    this.container.sortableChildren = true;
  }

  onAdd(): void {
    const tree = this.use(SceneRenderTreeKey);
    // Each group is its own unit at the layer level — even a group nested under
    // another entity's group. Transform parenting (ECS) and sort grouping
    // stay independent.
    tree.get(this.layer).container.addChild(this.container);
    this.regroup();
  }

  /** Re-home the subtree once parent/child links exist (save/load restore). */
  afterRestore(): void {
    this.regroup();
  }

  onDestroy(): void {
    // Return members to the layer so removing the grouping doesn't orphan
    // sprites; on scene teardown they're destroyed by their own components
    // immediately after. Destroy only the wrapper, never its (borrowed) children.
    const layerContainer = this.tryLayerContainer();
    if (layerContainer) {
      for (const child of [...this.container.children]) {
        layerContainer.addChild(child);
      }
    } else {
      this.container.removeChildren();
    }
    this.container.destroy({ children: false });
  }

  /**
   * Compute this group's depth key under the layer `sort`. Samples the
   * group-owning entity's own visual (so `ySort`/`ySortBy` read a real sprite's
   * position and offset); falls back to a proxy at the entity's `Transform`
   * world position when the owner renders nothing itself.
   *
   * @internal Called by `DisplaySystem` each Render phase.
   */
  resolveSortKey(sort: LayerSortFn): number {
    const sample = this.findSample();
    if (sample) return sort(sample);

    const proxy = (this._proxy ??= new Container());
    const transform = this.entity.tryGet(Transform);
    if (transform) {
      const world = transform.worldPosition;
      proxy.position.set(world.x, world.y);
    }
    return sort(proxy);
  }

  /** The owning entity's own visual on this layer, if currently in the group. */
  private findSample(): Container | undefined {
    for (const component of this.entity.getAll()) {
      if (
        isLayerRenderable(component) &&
        component.layerName === this.layer &&
        component.renderObject.parent === this.container
      ) {
        return component.renderObject;
      }
    }
    return undefined;
  }

  /** Gather every subtree visual on this layer into the group container. */
  private regroup(): void {
    this.collect(this.entity, true);
  }

  private collect(entity: Entity, isRoot: boolean): void {
    if (!isRoot && entity.tryGet(SortGroupComponent)?.layer === this.layer) {
      // A descendant group owns its own subtree as a separate unit.
      return;
    }
    for (const component of entity.getAll()) {
      if (component === this) continue;
      if (isLayerRenderable(component) && component.layerName === this.layer) {
        this.container.addChild(component.renderObject);
      }
    }
    for (const child of entity.children.values()) {
      this.collect(child, false);
    }
  }

  private tryLayerContainer(): Container | undefined {
    if (!this.entity.tryScene) return undefined;
    return this.use(SceneRenderTreeKey).tryGet(this.layer)?.container;
  }

  serialize(): SortGroupData {
    return { layer: this.layer };
  }

  static fromSnapshot(data: SortGroupData): SortGroupComponent {
    return new SortGroupComponent({ layer: data.layer });
  }
}
