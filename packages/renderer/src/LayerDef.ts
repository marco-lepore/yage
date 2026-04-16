/**
 * Declarative layer definition attached to a Scene subclass via
 * `readonly layers = [...]`. The renderer augments `Scene` in core (via
 * `scene-augmentation.ts`) so this field is typed without core depending
 * on renderer.
 *
 * Phase 1 keeps `space` and `eventMode` as-is; Phase 2 removes them when
 * the CameraEntity + layer-bindings model ships.
 */
export interface LayerDef {
  /** Unique layer name within a scene. */
  name: string;
  /** Draw order within the scene. Lower values render first (behind higher values). */
  order: number;
  /** Whether the layer is camera-transformed ("world") or fixed to the screen ("screen"). Default: "world". */
  space?: "world" | "screen";
  /** PixiJS event mode applied to the layer container. */
  eventMode?: "none" | "passive" | "auto" | "static" | "dynamic";
  /** Whether children should self-sort by their `zIndex`. Default: false. */
  sortableChildren?: boolean;
}
