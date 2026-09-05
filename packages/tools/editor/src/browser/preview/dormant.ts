import { Transform, type Entity } from "@yagejs/core";
import {
  VisualComponent,
  type VisualOpacityModifierHandle,
} from "@yagejs/renderer";

/** One authored placement in the preview, and the active state it was authored with. */
export interface DormantPlacement {
  /** The authored placement's id, which is how a fade names it. */
  readonly id: string;
  readonly entity: Entity;
  readonly authoredActive: boolean;
}

/**
 * How much of itself a placement keeps while a reference field is waiting for
 * a target it cannot be: low enough that the placements that can be chosen are
 * the only ones the eye lands on, high enough that the level is still there to
 * navigate by.
 */
const DIMMED_ALPHA = 0.25;

/**
 * The fade each visual is wearing, so the next pass can change it instead of
 * adding a second one.
 *
 * A visual gets an entry the first time it is faded and keeps it for as long as
 * it lives. The map holds its components weakly, so a rebuilt preview drops
 * every handle it made along with the components that owned them.
 */
const fades = new WeakMap<VisualComponent, VisualOpacityModifierHandle>();

/**
 * Draw inactive placements without waking them.
 *
 * A preview entity is dormant, so nothing in the engine updates it: no system
 * queries it, `onEnable` never runs, and its components never tick. What makes
 * it visible is this pass, which every frame writes the pose its `Transform`
 * composes and the visibility its placement authored onto each render object,
 * and sets how faded each visual is through that visual's own opacity
 * modifiers. All three are recomputed from state, so a fade is never something
 * to put back.
 *
 * Fading and hiding are separate and both can apply: a fade says a placement
 * is not what a press is looking for, and hiding says the developer put it out
 * of the way.
 *
 * It writes and it fades. Enabling the entity or its components would run the
 * game logic the editor exists to keep still, and patching component behaviour
 * would follow every other scene in the page.
 */
export function synchronizeDormantVisuals(
  placements: readonly DormantPlacement[],
  /** Placements to fade. Empty whenever nothing is waiting for a target. */
  dimmed: ReadonlySet<string>,
  /**
   * Placements to draw nothing for, each one authored under a hidden one
   * included. Empty whenever the developer has hidden nothing.
   */
  hidden: ReadonlySet<string>,
): void {
  const byEntity = new Map(
    placements.map((placement) => [placement.entity, placement]),
  );
  for (const placement of placements) {
    // Every placement has one: the loader refuses an entity without a
    // Transform before an instance exists.
    const transform = placement.entity.get(Transform);
    const shown = !hidden.has(placement.id);
    const hierarchyVisible = authoredVisible(placement, byEntity);
    const fade = dimmed.has(placement.id) ? DIMMED_ALPHA : 1;
    for (const component of placement.entity.getAll()) {
      if (!(component instanceof VisualComponent)) continue;
      const object = component.renderObject;
      object.position.x = transform.worldPosition.x;
      object.position.y = transform.worldPosition.y;
      object.rotation = transform.worldRotation;
      object.scale.x = transform.worldScale.x;
      object.scale.y = transform.worldScale.y;
      // The fade goes through the component's own opacity modifiers rather
      // than onto the render object, because a subclass may reach its pixels
      // by another route: a tilemap's opacity is a colour filter, and a
      // direct write leaves it at full strength while everything around it
      // dims. The modifier is multiplied into the alpha the game asked for,
      // so a placement authored translucent stays translucent and dims from
      // there.
      const worn = fades.get(component);
      if (worn) worn.setFactor(fade);
      else if (fade !== 1)
        fades.set(component, component.modifiers.addOpacity(fade));
      // After the fade, which writes a visibility of its own that this pass
      // overrules: the component reads the engine's enabled state, and a
      // dormant entity is inactive whatever the document authored.
      object.visible =
        component.enabled && component.visible && hierarchyVisible && shown;
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
