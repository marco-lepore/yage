import type { Entity } from "@yagejs/core";

/** Coordinate space a layer lives in. See `LayerDef.space`. */
export type LayerSpace = "world" | "screen";

/**
 * What a layer's depth-key function reads for one child of the layer.
 *
 * `DisplaySystem` reuses one item for every child, so read its fields inside
 * the call and keep no reference to it.
 */
export interface SortItem {
  /** The child's x position in its layer, in pixels. */
  readonly x: number;
  /** The child's y position in its layer, in pixels. */
  readonly y: number;
  /**
   * The `sortOffset` of the component that draws the child; `0` for a child
   * no component owns.
   */
  readonly sortOffset: number;
  /**
   * The entity whose component draws the child. `undefined` for a container
   * added to the layer without a component.
   */
  readonly entity: Entity | undefined;
}

/**
 * Depth-key function applied to a layer's children before each render.
 * Receives one {@link SortItem} per child and returns the **paint order
 * key** — lower values render first (behind), higher values render on top.
 *
 * Default behaviour (no `sort`) is **insertion order** — entities render
 * in the order their visual containers were added. Use `ySort` for the
 * classic top-down 2D depth rule, or compose your own depth-key for
 * isometric / layered-depth setups. A key that reads another component
 * through `item.entity` costs a component lookup per child per frame.
 *
 * `DisplaySystem` writes the key to each child's Pixi `zIndex` after
 * transform sync, so on a sorted layer the key replaces any `zIndex` the
 * child's component sets.
 */
export type LayerSortFn = (item: SortItem) => number;

/**
 * Declarative layer definition attached to a Scene subclass via
 * `readonly layers = [...]`. The renderer augments `Scene` in core (via
 * `scene-augmentation.ts`) so this field is typed without core depending
 * on renderer.
 *
 * A layer's `space` controls whether cameras transform it:
 * - `"world"` (default) — cameras auto-bind the layer (unless spawned with
 *   `autoBind: false`), so it scrolls/zooms with the world.
 * - `"screen"` — cameras skip the layer on auto-bind, so it stays fixed
 *   to the viewport. Use for HUD, menus, dialogs, or any UI you want
 *   anchored to the screen.
 *
 * UI plugins auto-provision a screen-space `"ui"` layer when no layer is
 * explicitly declared, so a single `new UISurface(...)` keeps working with
 * zero layer wiring.
 */
export interface LayerDef {
  /**
   * Unique layer name within a scene. `"default"` is special — every
   * scene's render tree auto-creates a layer called `"default"` at order 0,
   * and any sprite/text/graphics with no explicit `layer` renders there.
   * Declaring `{ name: "default", order: 0, sort, space, isRenderGroup }`
   * configures that pre-created layer (e.g. `{ name: "default", order: 0,
   * sort: ySort }` to depth-sort the layer your entities are already on).
   * `order` is required, but the value declared for `"default"` is ignored
   * — `"default"` is the order-0 layer by definition.
   * Use any other name to add a separate custom layer.
   */
  name: string;
  /** Draw order within the scene. Lower values render first (behind higher values). */
  order: number;
  /**
   * Coordinate space the layer lives in. Default: `"world"`.
   *
   * - `"world"`: included in a camera's auto-bindings, so it scrolls and
   *   zooms with the camera. Use for gameplay layers (background, entities,
   *   foreground), parallax, and diegetic UI that should follow an entity.
   *   Naming the layer in a camera's `bindings` changes how it follows,
   *   not whether it does, unless the camera sets `autoBind: false`.
   * - `"screen"`: excluded from auto-bindings; stays fixed to the viewport.
   *   Use for HUD, menus, dialogs, and other screen-anchored UI. Cameras
   *   can still opt in explicitly by naming the layer in their `bindings`.
   */
  space?: LayerSpace;
  /**
   * Depth-key function applied to the layer's children. When set,
   * `DisplaySystem` computes every child's key each frame and the layer
   * draws its children in key order. Default: unset (insertion order).
   *
   * Use `ySort` for the classic top-down depth rule. A visual's
   * `sortOffset` shifts its key (Godot's `y_sort_origin` pattern — key a
   * sprite at its apparent footprint instead of its anchor).
   *
   * On a layer without `sort`, a visual's `zIndex` orders it among its
   * siblings. On a sorted layer the key decides the order instead.
   */
  sort?: LayerSortFn;
  /**
   * Promote the layer's container to a Pixi v8 render group boundary so its
   * children render as a separate pass with their own uniform scope. Default:
   * `false`.
   *
   * Why this exists: when a filter is applied to anything inside a render
   * group, Pixi composes the filter's `uWorldTransformMatrix` from the active
   * render group's transform and leaves it on the global uniform stack until
   * the group ends. Sibling render passes that read `globalUniforms` directly —
   * notably `@pixi/tilemap`'s `TilemapPipe.execute` (which pulls
   * `_activeUniforms.at(-1)`) — pick up that polluted matrix and visibly drift.
   *
   * Set `isRenderGroup: true` on layers that contain filtered content AND on
   * any sibling layer whose contents must stay unaffected (e.g. a canopy
   * tilemap above filtered entities). Both layers then sit inside their own
   * uniform scope, and the filter's transform stays scoped to its source.
   */
  isRenderGroup?: boolean;
}
