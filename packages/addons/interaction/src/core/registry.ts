/**
 * Scene-scoped live-interactable index. An `Interactable` self-registers on
 * `onAdd` and unregisters on `onDestroy`; every `Interactor` in the scene
 * iterates the same registry to build its candidate set each frame — no DI
 * registration, no all-entities scan.
 *
 * Keyed off the `Scene` via a `WeakMap`, so the registry is torn down with
 * the scene automatically (mirrors the dialogue addon's `ActorRegistry`).
 */

import type { Scene } from "@yagejs/core";
import type { Interactable } from "../Interactable.js";

export class InteractableRegistry {
  private readonly members = new Set<Interactable>();
  private nextOrder = 0;

  /** Registers `interactable` and returns its registration order (used as
   *  the focus tie-break, so it never changes for the lifetime of the instance). */
  register(interactable: Interactable): number {
    this.members.add(interactable);
    return this.nextOrder++;
  }

  unregister(interactable: Interactable): void {
    this.members.delete(interactable);
  }

  /** Whether `interactable` is still registered. Goes false when its host
   *  removes the component; a destroyed *entity* stays registered until the
   *  end-of-frame teardown, so callers pair this with an `isDestroyed` check. */
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
 * Every live `Interactable` registered in `scene`, in registration order. The
 * scene-wide read surface, independent of any one `Interactor`'s range — for
 * revealing what is interactable (an observation skill highlighting every
 * interactable actor).
 *
 * Excludes entities already destroyed (their components stay registered until
 * the end-of-frame teardown, so returning them would hand out dead targets).
 * Keeps *disabled* ones: whether a currently-ungated target should still be
 * revealed is the game's call — filter on `isEnabled()` for the interactable-
 * right-now set, and `rankInteractables()` to order a subset by proximity.
 */
export function interactablesIn(scene: Scene): readonly Interactable[] {
  const live: Interactable[] = [];
  for (const interactable of interactableRegistryFor(scene)) {
    if (!interactable.entity.isDestroyed) live.push(interactable);
  }
  return live;
}
