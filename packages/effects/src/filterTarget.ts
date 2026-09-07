/**
 * Coordinate conversion shared by the presets that take a host-local point or
 * length. A filter shader works in the pixels of the rasterized region Pixi
 * allocates for the filter target, which is neither the canvas nor the virtual
 * play rect: it moves with the content, the camera and the fit transform's
 * letterbox bars. These helpers turn the host's own coordinates into that
 * space so a game never has to reason about it.
 *
 * @internal
 */

import type { Container, FilterSystem } from "pixi.js";

/** World-space magnitudes of a filter target's local axes. */
export interface TargetScale {
  readonly scaleX: number;
  readonly scaleY: number;
  /** Mean of `scaleX` and `scaleY` — the factor for radii and other lengths. */
  readonly sizeScale: number;
}

/** Shared by every no-target call, hence frozen. */
const IDENTITY_SCALE: TargetScale = Object.freeze({
  scaleX: 1,
  scaleY: 1,
  sizeScale: 1,
});

/**
 * Axis magnitudes of `target`'s world transform. Identity when the effect has
 * no target yet. `Math.hypot` collapses to `|a|` / `|d|` in the axis-aligned
 * case the fit transform and camera zoom actually produce, and stays finite
 * under rotation.
 */
export function targetScale(target: Container | undefined): TargetScale {
  const wt = target?.worldTransform;
  if (!wt) return IDENTITY_SCALE;
  const scaleX = Math.hypot(wt.a, wt.b);
  const scaleY = Math.hypot(wt.c, wt.d);
  return { scaleX, scaleY, sizeScale: (scaleX + scaleY) * 0.5 };
}

/**
 * Project a target-local point into the rasterized filter region's pixel
 * space: the world position minus the region's world origin.
 *
 * That origin lives on `filterManager._activeFilterData.bounds.minX/minY` and
 * reads as (0, 0) when absent. It is NOT on `input.frame.x/y`, which Pixi's
 * TexturePool always resets to 0 on allocation. Using `worldTransform.tx/ty`
 * instead fails on component-scope sprites whose box starts at
 * `position - anchor * size`, and using `0` fails the moment the fit transform
 * produces letterbox bars. The internal `_activeFilterData.bounds` is the only
 * frame that is always correct — accept the underscore-prefixed access; it is
 * stable in Pixi v8.
 */
export function toFilterRegion(
  target: Container,
  filterManager: FilterSystem,
  x: number,
  y: number,
  out: { x: number; y: number },
): void {
  const wt = target.worldTransform;
  const worldX = wt.a * x + wt.c * y + wt.tx;
  const worldY = wt.b * x + wt.d * y + wt.ty;
  const bounds = (
    filterManager as unknown as {
      _activeFilterData?: { bounds?: { minX: number; minY: number } };
    }
  )._activeFilterData?.bounds;
  out.x = worldX - (bounds?.minX ?? 0);
  out.y = worldY - (bounds?.minY ?? 0);
}
