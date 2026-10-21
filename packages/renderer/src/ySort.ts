import type { LayerSortFn } from "./LayerDef.js";

/**
 * Built-in y-depth key: a child's y position plus its component's
 * `sortOffset` becomes its paint order. Lower keys render first (behind);
 * higher keys render on top — the classic top-down 2D depth rule, where a
 * character "in front of" a tree (higher y) draws over it.
 *
 * ```ts
 * import { ySort } from "@yagejs/renderer";
 *
 * // Depth-sort the auto-created default layer your entities already use —
 * // no per-component `layer` wiring needed.
 * class GameScene extends Scene {
 *   readonly layers: readonly LayerDef[] = [
 *     { name: "default", order: 0, sort: ySort },
 *   ];
 * }
 *
 * // A tree anchored at its top sorts by its trunk base, 96 px lower:
 * this.add(new SpriteComponent({ texture: "tree", anchor: { x: 0.5, y: 0 }, sortOffset: 96 }));
 * ```
 */
export const ySort: LayerSortFn = (item) => item.y + item.sortOffset;
