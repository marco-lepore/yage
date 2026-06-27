/**
 * A component you drop on any world entity to make it a dialogue *actor*: it
 * self-registers under a logical `speaker` id (see {@link ActorRegistry}) so
 * presenters can find "where is whoever is speaking" without an external map.
 * It owns the per-entity translation of dialogue intent — expression + speaking
 * — into whatever the entity's character system supports (swap an animation
 * clip, tint, toggle a talk loop) via callbacks, and exposes a head/anchor
 * point for diegetic bubbles to position against.
 */

import { Component, Transform, type Entity } from "@yagejs/core";
import { actorRegistryFor } from "./ActorRegistry.js";

export interface DialogueActorOptions {
  /** Logical speaker id this entity answers to (matches the script). */
  readonly speaker: string;
  /** Offset from the entity transform to the bubble anchor (head), in px. */
  readonly anchor?: { readonly x: number; readonly y: number };
  /** Map a script expression id onto this entity's character system. */
  readonly onExpression?: (entity: Entity, expression: string | undefined) => void;
  /** Toggle a talk animation / mouth flap. */
  readonly onSpeaking?: (entity: Entity, speaking: boolean) => void;
}

export class DialogueActor extends Component {
  constructor(private readonly opts: DialogueActorOptions) {
    super();
  }

  get speaker(): string {
    return this.opts.speaker;
  }

  onAdd(): void {
    actorRegistryFor(this.scene).register(this.opts.speaker, this);
  }

  onDestroy(): void {
    actorRegistryFor(this.scene).unregister(this.opts.speaker, this);
  }

  /** Bubble anchor in world space: the entity position plus the configured offset. */
  anchorWorld(): { x: number; y: number } {
    const t = this.entity.tryGet(Transform);
    const p = t?.position ?? { x: 0, y: 0 };
    const a = this.opts.anchor ?? { x: 0, y: 0 };
    return { x: p.x + a.x, y: p.y + a.y };
  }

  setExpression(expression: string | undefined): void {
    this.opts.onExpression?.(this.entity, expression);
  }

  setSpeaking(speaking: boolean): void {
    this.opts.onSpeaking?.(this.entity, speaking);
  }
}
