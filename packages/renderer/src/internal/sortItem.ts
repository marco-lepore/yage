import type { Entity } from "@yagejs/core";
import type { SortItem } from "../LayerDef.js";
import type { DisplayContainer } from "../public-types.js";
import type { SortSource } from "../SortGroupComponent.js";

/**
 * The one {@link SortItem} the depth-sort pass refills for every child, so a
 * frame's sort allocates nothing.
 * @internal
 */
export class SortItemBuffer implements SortItem {
  x = 0;
  y = 0;
  sortOffset = 0;
  entity: Entity | undefined = undefined;

  set(
    x: number,
    y: number,
    sortOffset: number,
    entity: Entity | undefined,
  ): this {
    this.x = x;
    this.y = y;
    this.sortOffset = sortOffset;
    this.entity = entity;
    return this;
  }

  /** Describe `child`, drawn by `source` when a component owns it. */
  fill(child: DisplayContainer, source: SortSource | undefined): this {
    return this.set(
      child.position.x,
      child.position.y,
      source?.sortOffset ?? 0,
      source?.entity,
    );
  }
}
