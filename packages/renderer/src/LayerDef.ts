import type { Container } from "pixi.js";

/** Coordinate space a layer lives in. See `LayerDef.space`. */
export type LayerSpace = "world" | "screen";

/**
 * Comparator applied to a layer's children before each render. Receives
 * the bare Pixi `Container`s sitting directly inside the layer; return a
 * negative number to render `a` first (behind), positive to render
 * `b` first.
 *
 * Default behaviour (no `sort`) is **insertion order** — entities render
 * in the order their visual containers were added. Use `ySort` for the
 * classic top-down 2D depth rule, or compose your own comparator for
 * isometric / layered-depth setups.
 */
export type LayerSortFn = (a: Container, b: Container) => number;

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
   * Unique layer name within a scene. `"default"` is reserved — every
   * scene's render tree auto-creates a layer called `"default"` at
   * order 0, and declaring a `LayerDef` with that name currently has
   * no effect. Use any other name if you need a custom layer, or rely on
   * the auto-default when no specific layer is required.
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
  /** Whether children should self-sort by their `zIndex`. Default: false. */
  sortableChildren?: boolean;
  /**
   * Comparator applied to the layer's children before each render.
   * `DisplaySystem` mutates `container.children` directly with this
   * comparator each frame, after syncing transforms so position-based
   * comparisons see the current frame's values, before camera
   * transforms.
   *
   * Default: unset (insertion order). Use `ySort` for the classic
   * top-down depth rule, or `ySortBy(getOffset)` to anchor each sprite's
   * sort key at a per-entity Y offset (think Godot's `y_sort_origin` —
   * matches a sprite's apparent "footprint" instead of its top-left).
   *
   * Note: this hook does NOT flip `sortableChildren`. Pixi v8's render
   * pipeline would otherwise call `container.sortChildren()` at render
   * time and re-order by `zIndex`, undoing our custom sort on any frame
   * where a child was just added. Set `sortableChildren: true` only if
   * you actually want Pixi's zIndex-based auto-sort INSTEAD of the
   * custom comparator.
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
