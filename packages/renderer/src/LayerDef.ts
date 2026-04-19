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
  space?: "world" | "screen";
  /** Whether children should self-sort by their `zIndex`. Default: false. */
  sortableChildren?: boolean;
}
