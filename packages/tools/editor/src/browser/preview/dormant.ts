import { Transform, type Entity } from "@yagejs/core";
import { VisualComponent } from "@yagejs/renderer";

/** One authored placement in the preview, and the active state it was authored with. */
export interface DormantPlacement {
  readonly entity: Entity;
  readonly authoredActive: boolean;
}

/**
 * Draw inactive placements without waking them.
 *
 * A preview entity is dormant, so nothing in the engine updates it: no system
 * queries it, `onEnable` never runs, and its components never tick. What makes
 * it visible is this pass, which writes the pose its `Transform` composes and
 * the visibility its placement authored onto each render object every frame.
 *
 * It only writes. Enabling the entity or its components would run the game
 * logic the editor exists to keep still, and patching component behaviour
 * would follow every other scene in the page.
 */
export function synchronizeDormantVisuals(
  placements: readonly DormantPlacement[],
): void {
  const byEntity = new Map(
    placements.map((placement) => [placement.entity, placement]),
  );
  for (const placement of placements) {
    // Every placement has one: the loader refuses an entity without a
    // Transform before an instance exists.
    const transform = placement.entity.get(Transform);
    const hierarchyVisible = authoredVisible(placement, byEntity);
    for (const component of placement.entity.getAll()) {
      if (!(component instanceof VisualComponent)) continue;
      const object = component.renderObject;
      object.position.x = transform.worldPosition.x;
      object.position.y = transform.worldPosition.y;
      object.rotation = transform.worldRotation;
      object.scale.x = transform.worldScale.x;
      object.scale.y = transform.worldScale.y;
      object.visible =
        component.enabled && component.visible && hierarchyVisible;
    }
  }
}

/**
 * Whether the document says this placement should be seen: a placement
 * authored inactive hides its children too, the way deactivating a live entity
 * would. The walk is over authored state, not engine state — every entity here
 * is inactive.
 */
function authoredVisible(
  placement: DormantPlacement,
  byEntity: ReadonlyMap<Entity, DormantPlacement>,
): boolean {
  let current: Entity | null = placement.entity;
  while (current) {
    const found = byEntity.get(current);
    if (found && !found.authoredActive) return false;
    current = current.parent;
  }
  return true;
}
