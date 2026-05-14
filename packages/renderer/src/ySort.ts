import type { Container } from "pixi.js";
import type { LayerSortFn } from "./LayerDef.js";

/**
 * Built-in y-sort comparator: lower-y renders first (behind), higher-y on top.
 * Matches the classic top-down 2D depth rule — characters "in front of" a
 * tree (higher `position.y`) draw over it.
 *
 * ```ts
 * import { ySort } from "@yagejs/renderer";
 *
 * class GameScene extends Scene {
 *   readonly layers: readonly LayerDef[] = [
 *     { name: "characters", order: 0, sort: ySort },
 *   ];
 * }
 * ```
 */
export const ySort: LayerSortFn = (a: Container, b: Container) =>
  a.position.y - b.position.y;

/**
 * Y-sort with a per-container offset, the way Godot's `y_sort_origin`
 * shifts a sprite's apparent "footprint" for depth comparisons. Use when
 * a sprite's anchor is set to its top (so the visual base sits well
 * below `position.y`) and the raw `position.y` produces wrong overlaps —
 * a player whose feet are at the bottom of the sprite should pass
 * *behind* a tree whose trunk is at the bottom of its own sprite, not
 * be sorted by the headtop.
 *
 * `offsetOf(container)` is called once per child per frame; cheap data
 * (a getter / a property read) keeps the per-frame cost negligible. The
 * comparator falls through to plain `position.y` when `offsetOf` returns
 * `undefined`, so mixed-content layers work without every child having
 * a depth offset.
 *
 * ```ts
 * import { ySortBy } from "@yagejs/renderer";
 *
 * // Read the offset off a custom property (containers are extensible).
 * const sort = ySortBy((c) => (c as { depthOffset?: number }).depthOffset);
 *
 * // Then per-sprite:
 * sprite.sprite.depthOffset = 32; // pivot for sort lives 32 px below `position.y`
 * ```
 */
export function ySortBy(
  offsetOf: (c: Container) => number | undefined,
): LayerSortFn {
  return (a, b) => {
    const ay = a.position.y + (offsetOf(a) ?? 0);
    const by = b.position.y + (offsetOf(b) ?? 0);
    return ay - by;
  };
}
