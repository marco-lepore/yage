/**
 * Declarative layer definition attached to a Scene subclass via
 * `readonly layers = [...]`. The renderer augments `Scene` in core (via
 * `scene-augmentation.ts`) so this field is typed without core depending
 * on renderer.
 *
 * Every layer a user declares on a Scene is "camera-followable": a
 * `CameraEntity` spawned without explicit `bindings` will auto-bind every
 * declared layer. To render something in screen-space, don't declare or
 * bind a layer for it — plugins like `@yagejs/ui` auto-provision their
 * own opt-out layers via `ensureLayer(def, { autoBindable: false })`.
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
  /** Whether children should self-sort by their `zIndex`. Default: false. */
  sortableChildren?: boolean;
}
