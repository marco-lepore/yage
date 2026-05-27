import type { Container } from "pixi.js";

/** Coordinate space a layer lives in. See `LayerDef.space`. */
export type LayerSpace = "world" | "screen";

/**
 * Depth-key function applied to a layer's children before each render.
 * Receives a Pixi `Container` and returns the **paint order key** — lower
 * values render first (behind), higher values render on top. Identical
 * semantics to writing `container.zIndex = key` by hand, but applied to
 * every child of the layer each frame.
 *
 * Default behaviour (no `sort`) is **insertion order** — entities render
 * in the order their visual containers were added. Use `ySort` for the
 * classic top-down 2D depth rule, or compose your own depth-key for
 * isometric / layered-depth setups.
 *
 * The key is written to `container.zIndex` by `DisplaySystem` after
 * transform sync, then Pixi's own render-time `sortChildren()` orders
 * the layer by zIndex — so the resulting paint order is exactly what
 * Pixi shows for any manually-zIndexed scene, no separate sort path.
 */
export type LayerSortFn = (c: Container) => number;

/**
 * Declarative layer definition attached to a Scene subclass via
 * `readonly layers = [...]`. The renderer augments `Scene` in core (via
 * `scene-augmentation.ts`) so this field is typed without core depending
 * on renderer.
 *
 * A layer's `space` controls whether cameras transform it:
 * - `"world"` (default) — cameras spawned without explicit `bindings`
 *   auto-bind the layer, so it scrolls/zooms with the world.
 * - `"screen"` — cameras skip the layer on auto-bind, so it stays fixed
 *   to the viewport. Use for HUD, menus, dialogs, or any UI you want
 *   anchored to the screen.
 *
 * UI plugins auto-provision a screen-space `"ui"` layer when no layer is
 * explicitly declared, so a single `new UIPanel(...)` keeps working with
 * zero layer wiring.
 */
export interface LayerDef {
  /**
   * Unique layer name within a scene. `"default"` is special — every
   * scene's render tree auto-creates a layer called `"default"` at order 0,
   * and any sprite/text/graphics with no explicit `layer` renders there.
   * Declaring `{ name: "default", sort, space, isRenderGroup }` configures
   * that pre-created layer (e.g. `{ name: "default", sort: ySort }` to
   * depth-sort the layer your entities are already on). The declared
   * `order` is ignored — `"default"` is the order-0 layer by definition.
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
   * - `"screen"`: excluded from auto-bindings; stays fixed to the viewport.
   *   Use for HUD, menus, dialogs, and other screen-anchored UI. Cameras
   *   can still opt in explicitly by naming the layer in their `bindings`.
   */
  space?: LayerSpace;
  /**
   * Depth-key function applied to the layer's children. When set,
   * `DisplaySystem` writes `child.zIndex = sort(child)` for every child
   * each frame, and flips `container.sortableChildren = true` so Pixi's
   * render pipeline orders the layer by zIndex. Default: unset (insertion
   * order).
   *
   * Use `ySort` for the classic top-down depth rule, or
   * `ySortBy(getOffset)` to anchor each sprite's sort key at a per-entity
   * Y offset (Godot's `y_sort_origin` pattern — matches a sprite's
   * apparent "footprint" instead of its top-left).
   *
   * Game code that manually writes `child.zIndex` on individual sprites
   * doesn't need `sort` — Pixi already sorts them once `sortableChildren`
   * is on. `sort` is for the common case where the key is a function of
   * the sprite's current state (position, depth offset, etc.) and needs
   * to be recomputed each frame.
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
