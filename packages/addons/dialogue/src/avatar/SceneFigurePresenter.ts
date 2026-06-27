/**
 * Scene-figure avatar: instead of a portrait, the "avatar" is an entity that
 * already exists in the world (an NPC standing in the shop, say). The speaker's
 * `avatar.ref` is that entity's name. This presenter is the communication seam
 * the design calls for — it doesn't know about your character system, so it
 * takes callbacks to translate expression/speaking into whatever the figure
 * supports (swap an AnimatedSprite clip, tint, toggle a talk loop). Out of the
 * box it does a subtle talk bob on the figure's Transform.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import type { MarkerToken, SpeakerDef } from "../core/types.js";
import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import { applyExpressionMarker, type AvatarPresenter } from "./AvatarPresenter.js";

export interface SceneFigurePresenterConfig {
  /** Map a script expression id onto your character system. */
  readonly onExpression?: (figure: Entity, expression: string | undefined) => void;
  /** Toggle a talk animation / mouth flap. */
  readonly onSpeaking?: (figure: Entity, speaking: boolean) => void;
  /** Apply the built-in talk bob (default true). */
  readonly bob?: boolean;
}

export class SceneFigurePresenter implements AvatarPresenter {
  // Explicit `| undefined` (not `?`) so reassigning `undefined` in dispose() /
  // setSpeaker() is legal under the repo's exactOptionalPropertyTypes.
  private scene: Scene | undefined;
  private figure: Entity | undefined;
  private actor: DialogueActor | undefined;
  private transform: Transform | undefined;
  private speaking = false;
  private bobMs = 0;
  /** Bob displacement currently applied to the figure's Transform. The bob is
   *  a *relative* offset (delta-translated each frame), so external movement —
   *  an NPC walking mid-line — is preserved instead of being pinned back to a
   *  position captured at setSpeaker time. */
  private bobOffset = 0;

  constructor(private readonly cfg: SceneFigurePresenterConfig = {}) {}

  mount(scene: Scene): void {
    this.scene = scene;
  }

  setSpeaker(speaker: SpeakerDef | undefined): void {
    this.releaseBob();
    const av = speaker?.avatar;
    if (!av || av.kind !== "scene" || !this.scene) {
      this.figure = undefined;
      this.actor = undefined;
      this.transform = undefined;
      return;
    }
    // Prefer a registered DialogueActor for the speaker; fall back to looking
    // the entity up by name (the script's `avatar.ref`).
    this.actor = actorRegistryFor(this.scene).resolve(speaker?.id);
    this.figure = this.actor?.entity ?? this.scene.findEntity(av.ref);
    this.transform = this.figure?.tryGet(Transform);
  }

  setExpression(expression: string | undefined): void {
    if (this.actor) this.actor.setExpression(expression);
    else if (this.figure) this.cfg.onExpression?.(this.figure, expression);
  }

  /** Mid-line `[expression=…/]` reveal marker → the figure's own expression
   *  (actor or the `onExpression` callback). The Session name-matches nothing. */
  marker(marker: MarkerToken): void {
    applyExpressionMarker(this, marker);
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (this.actor) this.actor.setSpeaking(speaking);
    else if (this.figure) this.cfg.onSpeaking?.(this.figure, speaking);
    if (!speaking) this.releaseBob();
  }

  update(dt: number): void {
    if (!this.speaking || !this.transform || this.cfg.bob === false) return;
    this.bobMs += dt;
    const next = Math.sin(this.bobMs / 130) * 1.2;
    // Apply only the delta on top of wherever the figure is NOW, so movement
    // systems (walking NPCs, knockback…) keep full ownership of the position.
    this.transform.translate(0, next - this.bobOffset);
    this.bobOffset = next;
  }

  dispose(): void {
    this.releaseBob();
    this.figure = undefined;
    this.transform = undefined;
  }

  /** Remove only the residual bob displacement — never teleport to a captured
   *  base, which would undo legitimate movement since speaking began. */
  private releaseBob(): void {
    if (this.transform && this.bobOffset !== 0) {
      this.transform.translate(0, -this.bobOffset);
    }
    this.bobOffset = 0;
    this.bobMs = 0;
  }
}
