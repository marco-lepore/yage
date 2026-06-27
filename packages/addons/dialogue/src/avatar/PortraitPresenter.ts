/**
 * Portrait avatar: a sprite that sits beside the box on the left or right.
 * Expression variants are just different textures (from the speaker's
 * `avatar.expressions` map); "speaking" adds a gentle talk bob. Textures must
 * be preloaded by the host scene — the presenter only resolves handles.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { SpriteComponent, texture, type TextureHandle } from "@yagejs/renderer";
import type { AvatarRef, MarkerToken, SpeakerDef } from "../core/types.js";
import { applyExpressionMarker, type AvatarPresenter } from "./AvatarPresenter.js";

export interface PortraitPresenterConfig {
  readonly layer: string;
  /** Centre X for a left-side portrait (screen px). */
  readonly leftX: number;
  /** Centre X for a right-side portrait (screen px). */
  readonly rightX: number;
  /** Centre Y (screen px). */
  readonly y: number;
  /** Uniform sprite scale. */
  readonly scale: number;
}

export class PortraitPresenter implements AvatarPresenter {
  // Explicit `| undefined` (not `?`) so reassigning `undefined` in dispose() /
  // setSpeaker() is legal under the repo's exactOptionalPropertyTypes.
  private scene: Scene | undefined;
  private entity: Entity | undefined;
  private sprite: SpriteComponent | undefined;
  private transform: Transform | undefined;
  private current: AvatarRef | undefined;
  private speaking = false;
  private bobMs = 0;
  private baseX = 0;
  private baseY = 0;
  /** Host-hidden gate — a cutscene hides the portrait with the rest of the
   *  UI. Composes with "is a portrait speaker active": shown = current && !hidden. */
  private hidden = false;
  private readonly handles = new Map<string, TextureHandle>();

  constructor(private readonly cfg: PortraitPresenterConfig) {}

  mount(scene: Scene): void {
    this.scene = scene;
  }

  setSpeaker(speaker: SpeakerDef | undefined): void {
    const av = speaker?.avatar;
    if (!av || av.kind !== "portrait") {
      this.hide();
      this.current = undefined;
      return;
    }
    this.current = av;
    this.ensureSprite(av.ref);
    this.baseX = av.side === "right" ? this.cfg.rightX : this.cfg.leftX;
    this.baseY = this.cfg.y;
    this.transform?.setPosition(this.baseX, this.baseY);
    this.applyTexture(av.ref);
    this.applyVisibility();
  }

  /** Host-hidden gate — hide the portrait during a cutscene, restore on
   *  show. Composes with the active-speaker state, so showing again only
   *  re-reveals the portrait if a portrait speaker is still current. */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (this.sprite) {
      this.sprite.sprite.visible = this.current !== undefined && !this.hidden;
    }
  }

  setExpression(expression: string | undefined): void {
    if (!this.current) return;
    const variant = expression ? this.current.expressions?.[expression] : undefined;
    this.applyTexture(variant ?? this.current.ref);
  }

  /** Interpret a mid-line `[expression=…/]` reveal marker as a face swap (the
   *  Session name-matches nothing — the presenter owns the convention). */
  marker(marker: MarkerToken): void {
    applyExpressionMarker(this, marker);
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking;
    if (!speaking) {
      this.bobMs = 0;
      this.transform?.setPosition(this.baseX, this.baseY);
    }
  }

  update(dt: number): void {
    if (!this.speaking || !this.transform) return;
    this.bobMs += dt;
    this.transform.setPosition(this.baseX, this.baseY + Math.sin(this.bobMs / 110) * 1.5);
  }

  dispose(): void {
    this.entity?.destroy();
    this.entity = undefined;
    this.sprite = undefined;
    this.transform = undefined;
  }

  private ensureSprite(initialPath: string): void {
    if (this.sprite || !this.scene) return;
    const entity = this.scene.spawn("dlg-portrait");
    this.transform = entity.add(new Transform());
    this.transform.setScale(this.cfg.scale, this.cfg.scale);
    this.sprite = entity.add(
      new SpriteComponent({
        texture: this.handle(initialPath),
        layer: this.cfg.layer,
        anchor: { x: 0.5, y: 0.5 },
        visible: false,
      }),
    );
    this.entity = entity;
  }

  private applyTexture(path: string): void {
    this.sprite?.setTexture(this.handle(path));
  }

  private handle(path: string): TextureHandle {
    let h = this.handles.get(path);
    if (!h) {
      h = texture(path);
      this.handles.set(path, h);
    }
    return h;
  }

  private hide(): void {
    if (this.sprite) this.sprite.sprite.visible = false;
  }
}
