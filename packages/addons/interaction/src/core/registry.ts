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
