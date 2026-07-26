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
import type { LoadedSpeaker, MarkerToken } from "../core/types.js";
import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import {
  applyExpressionMarker,
  type AvatarPresenter,
} from "./AvatarPresenter.js";

export interface SceneFigurePresenterConfig {
  /** Map a script expression id onto your character system. */
  readonly onExpression?: (
    figure: Entity,
    expression: string | undefined,
  ) => void;
  /** Toggle a talk animation / mouth flap. */
  readonly onSpeaking?: (figure: Entity, speaking: boolean) => void;
  /** Apply the built-in talk bob (default true). */
  readonly bob?: boolean;
}

export class SceneFigurePresenter implements AvatarPresenter {
  // Explicit `| undefined` (not `?`) so reassigning `undefined` in dispose() /
  // setSpeaker() is legal under the repo's exactOptionalPropertyTypes.
  private scene: Scene | undefined;
  private speakerId: string | undefined;
  private figure: Entity | undefined;
  private actor: DialogueActor | undefined;
  private transform: Transform | undefined;
  private expression: string | undefined;
  private expressionRequested = false;
  private expressionApplied = false;
  private speaking = false;
  private speakingApplied = false;
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

  setSpeaker(speaker: LoadedSpeaker | undefined): void {
    this.releaseBob();
    this.speakerId = speaker?.id;
    const av = speaker?.avatar;
    if (!av || av.kind !== "scene" || !this.scene) {
      this.figure = undefined;
      this.actor = undefined;
      this.transform = undefined;
      this.expressionApplied = false;
      this.speakingApplied = false;
      return;
    }
    // Prefer a registered DialogueActor for the speaker; fall back to looking
    // the entity up by name (the script's `avatar.ref`).
    this.actor = actorRegistryFor(this.scene).resolve(speaker?.id);
    this.figure = this.actor?.entity ?? this.findFigure(av.ref);
    this.transform = this.figure?.tryGet(Transform);
    this.expressionApplied = false;
    this.speakingApplied = false;
  }

  setExpression(expression: string | undefined): void {
    this.expression = expression;
    this.expressionRequested = true;
    if (this.actor) {
      this.actor.setExpression(expression);
      this.expressionApplied = true;
    } else if (this.figure?.isActive) {
      this.cfg.onExpression?.(this.figure, expression);
      this.expressionApplied = true;
    } else {
      this.expressionApplied = false;
    }
  }

  /** Mid-line `[expression=…/]` reveal marker → the figure's own expression
   *  (actor or the `onExpression` callback). The Session name-matches nothing. */
  marker(marker: MarkerToken): void {
    applyExpressionMarker(this, marker);
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (this.actor) {
      this.actor.setSpeaking(speaking);
      this.speakingApplied = speaking;
    } else if (this.figure?.isActive) {
      this.cfg.onSpeaking?.(this.figure, speaking);
      this.speakingApplied = speaking;
    } else {
      if (this.figure && this.speakingApplied) {
        this.cfg.onSpeaking?.(this.figure, false);
      }
      this.speakingApplied = false;
    }
    if (!speaking) this.releaseBob();
  }

  update(dt: number): void {
    if (!this.actor && this.scene && this.speakerId) {
      const actor = actorRegistryFor(this.scene).resolve(this.speakerId);
      if (actor) {
        this.actor = actor;
        this.figure = actor.entity;
        this.transform = actor.entity.tryGet(Transform);
        if (this.expressionRequested) actor.setExpression(this.expression);
        if (this.speaking) actor.setSpeaking(true);
      }
    }
    if (this.actor && !this.actor.effectiveEnabled) {
      this.releaseBob();
      return;
    }
    if (this.figure && !this.figure.isActive) {
      if (!this.actor && this.speakingApplied) {
        this.cfg.onSpeaking?.(this.figure, false);
        this.speakingApplied = false;
      }
      this.expressionApplied = false;
      this.releaseBob();
      return;
    }
    if (!this.actor && this.figure) {
      if (this.expressionRequested && !this.expressionApplied) {
        this.cfg.onExpression?.(this.figure, this.expression);
        this.expressionApplied = true;
      }
      if (this.speaking && !this.speakingApplied) {
        this.cfg.onSpeaking?.(this.figure, true);
        this.speakingApplied = true;
      }
    }
    if (!this.speaking || !this.transform || this.cfg.bob === false) return;
    // `dt` is seconds; `bobMs` feeds the millisecond-tuned bob sine.
    this.bobMs += dt * 1000;
    const next = Math.sin(this.bobMs / 130) * 1.2;
    // Apply only the delta on top of wherever the figure is NOW, so movement
    // systems (walking NPCs, knockback…) keep full ownership of the position.
    this.transform.translate(0, next - this.bobOffset);
    this.bobOffset = next;
  }

  dispose(): void {
    this.releaseBob();
    this.speakerId = undefined;
    this.figure = undefined;
    this.actor = undefined;
    this.transform = undefined;
    this.expressionApplied = false;
    this.speakingApplied = false;
  }

  private findFigure(name: string): Entity | undefined {
    const active = this.scene?.findEntity(name);
    if (active) return active;
    for (const entity of this.scene?.getEntities() ?? []) {
      if (entity.name === name && !entity.isDestroyed) return entity;
    }
    return undefined;
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
