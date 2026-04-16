import type { EventMode } from "pixi.js";

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
  /**
   * Unique layer name within a scene. `"default"` is reserved — every
   * scene's render tree auto-creates a world-space layer called `"default"`
   * at order 0, and declaring a `LayerDef` with that name currently has
   * no effect. Use any other name if you need a custom layer, or rely on
   * the auto-default when no specific layer is required.
   */
  name: string;
  /** Draw order within the scene. Lower values render first (behind higher values). */
  order: number;
  /** Whether the layer is camera-transformed ("world") or fixed to the screen ("screen"). Default: "world". */
  space?: "world" | "screen";
  /** PixiJS event mode applied to the layer container. */
  eventMode?: EventMode;
  /** Whether children should self-sort by their `zIndex`. Default: false. */
  sortableChildren?: boolean;
}
