/**
 * Declarative layer definition attached to a Scene subclass via
 * `readonly layers = [...]`. The renderer augments `Scene` in core (via
 * `scene-augmentation.ts`) so this field is typed without core depending
 * on renderer.
 *
 * Camera behavior is determined by `CameraEntity` bindings. A camera
 * with explicit `bindings` only transforms the layers it names. A camera
 * without explicit bindings auto-binds every layer except those marked
 * `screenSpace: true` (e.g. HUD/UI layers).
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
  /**
   * If true, cameras with auto-bindings (no explicit `bindings` option) skip
   * this layer, so it stays at identity transform (screen-space). A camera
   * can still transform this layer by naming it in explicit `bindings`.
   * Default: false.
   */
  screenSpace?: boolean;
}
