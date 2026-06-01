/**
 * Scene-scoped speaker → live entity index. A {@link DialogueActor} self-
 * registers under its logical speaker id; presenters resolve a speaker to a
 * world entity through here instead of carrying an external map. Scripts always
 * speak in *logical* ids (invariant) — instance selection happens here, never
 * in the script.
 *
 * The registry is keyed off the `Scene` via a WeakMap, so it needs no service
 * registration and is torn down with the scene. D2 (multiple live entities per
 * speaker) is punted: last registration wins.
 */

import type { Scene } from "@yagejs/core";
import type { DialogueActor } from "./DialogueActor.js";

export class ActorRegistry {
  private readonly actors = new Map<string, DialogueActor>();

  register(speaker: string, actor: DialogueActor): void {
    this.actors.set(speaker, actor);
  }

  unregister(speaker: string, actor: DialogueActor): void {
    if (this.actors.get(speaker) === actor) this.actors.delete(speaker);
  }

  resolve(speaker: string | undefined): DialogueActor | undefined {
    return speaker ? this.actors.get(speaker) : undefined;
  }
}

const registries = new WeakMap<Scene, ActorRegistry>();

/** The (lazily-created) registry for a scene. Shared by actors + presenters. */
export function actorRegistryFor(scene: Scene): ActorRegistry {
  let registry = registries.get(scene);
  if (!registry) {
    registry = new ActorRegistry();
    registries.set(scene, registry);
  }
  return registry;
}
