/**
 * Scene-scoped live-interactable index. An `Interactable` registers while it
 * is running and unregisters while it is not (disabled, dormant entity,
 * removed, destroyed); every `Interactor` in the scene iterates the same
 * registry to build its candidate set each frame — no DI registration, no
 * all-entities scan.
 *
 * Keyed off the `Scene` via a `WeakMap`, so the registry is torn down with
 * the scene automatically (mirrors the dialogue addon's `ActorRegistry`).
 */

import type { Scene } from "@yagejs/core";
import type { Interactable } from "../Interactable.js";

export class InteractableRegistry {
  private readonly members = new Set<Interactable>();
  private nextOrder = 0;

  /** Hands out the next registration order — the focus tie-break. Claimed
   *  once per instance, so it survives an interactable leaving the set and
   *  coming back. */
  claimOrder(): number {
    return this.nextOrder++;
  }

  /** Adds `interactable` to the candidate set every `Interactor` reads. */
  register(interactable: Interactable): void {
    this.members.add(interactable);
  }

  unregister(interactable: Interactable): void {
    this.members.delete(interactable);
  }

  /** Whether `interactable` is still registered. Goes false when its host
   *  removes the component, disables it, or deactivates the entity; a
   *  destroyed *entity* stays registered until the end-of-frame teardown, so
   *  callers pair this with an `isDestroyed` check. */
  has(interactable: Interactable): boolean {
    return this.members.has(interactable);
  }

  [Symbol.iterator](): IterableIterator<Interactable> {
    return this.members[Symbol.iterator]();
  }
}

const registries = new WeakMap<Scene, InteractableRegistry>();

/** The (lazily-created) registry for a scene. Shared by every `Interactor`. */
export function interactableRegistryFor(scene: Scene): InteractableRegistry {
  let registry = registries.get(scene);
  if (!registry) {
    registry = new InteractableRegistry();
    registries.set(scene, registry);
  }
  return registry;
}

/**
 * Every live `Interactable` registered in `scene`. The scene-wide read
 * surface, independent of any one `Interactor`'s range — for revealing what is
 * interactable (an observation skill highlighting every interactable actor).
 *
 * Excludes entities already destroyed (their components stay registered until
 * the end-of-frame teardown, so returning them would hand out dead targets)
 * and dormant ones (they leave the registry with the entity). Keeps targets
 * whose `isEnabled()` gate reads false: whether a currently-ungated target
 * should still be revealed is the game's call — filter on `isEnabled()` for
 * the interactable-right-now set, and `rankInteractables()` to order a subset
 * by proximity.
 *
 * Ordered by registration; one that went dormant and came back sits at the
 * end. Rank the result when order carries meaning.
 */
export function interactablesIn(scene: Scene): readonly Interactable[] {
  const live: Interactable[] = [];
  for (const interactable of interactableRegistryFor(scene)) {
    if (!interactable.entity.isDestroyed) live.push(interactable);
  }
  return live;
}
