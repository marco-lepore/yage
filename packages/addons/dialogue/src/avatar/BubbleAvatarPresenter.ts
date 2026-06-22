/**
 * BubbleAvatarPresenter — the reference **line-driven portrait for speech
 * bubbles**, the bubble counterpart to {@link InBoxAvatarPresenter}. Like that
 * one it is built only from the documented contract: {@link AvatarChannel.present}
 * gives it the line (so it reads `meta.portrait` / `meta.side` / `meta.presence`),
 * and the shared {@link BubbleLayout} gives it the bubble size + the speaker
 * anchor, so the portrait floats beside the bubble and follows the actor.
 *
 * It reserves no text inset (a bubble grows to its own text); the portrait sits
 * to the side of the bubble. Portrait textures must be **preloaded** by the host.
 * Wire it through `createMixedDialogue(theme, { avatar: { bubble } })`.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  SpriteComponent,
  texture,
  type TextureHandle,
} from "@yagejs/renderer";
import type { AvatarPresenter } from "./AvatarPresenter.js";
import type { PresentedLine } from "../core/session.js";
import type { BubbleLayout } from "../render/BubbleLayout.js";
import type { BubbleSize } from "../render/bubbleSizing.js";

export interface BubbleAvatarConfig {
  /** World-space render layer (same as the bubble). */
  readonly layer: string;
  /** Portrait column size (px) reserved beside the bubble. */
  readonly size: number;
  /** Gap (px) between the portrait and the bubble edge. Default 8. */
  readonly gap?: number;
  /** Uniform sprite scale. Default 1. */
  readonly scale?: number;
  /** Optional rounded-rect panel behind the portrait. */
  readonly background?: {
    readonly color: number;
    readonly alpha?: number;
    readonly radius?: number;
  };
}

export class BubbleAvatarPresenter implements AvatarPresenter {
  // Explicit `| undefined` (not `?`) for exactOptionalPropertyTypes reassignment.
  private scene: Scene | undefined;
  private entity: Entity | undefined;
  private sprite: SpriteComponent | undefined;
  private transform: Transform | undefined;
  private bgEntity: Entity | undefined;
  private bg: GraphicsComponent | undefined;
  private bgTransform: Transform | undefined;
  private side: "left" | "right" = "left";
  private speakerId: string | undefined;
  /** The current line's bubble size (the anchor is re-resolved every frame). */
  private size: BubbleSize | undefined;
  private shown = false;
  private hidden = false;
  private readonly handles = new Map<string, TextureHandle>();

  constructor(
    private readonly layout: BubbleLayout,
    private readonly cfg: BubbleAvatarConfig,
  ) {}

  mount(scene: Scene): void {
    this.scene = scene;
  }

  // Line-driven (via present), so the speaker-def hooks are inert here.
  setSpeaker(): void {}
  setExpression(): void {}
  setSpeaking(): void {}

  present(line: PresentedLine | undefined): void {
    const meta = line?.meta;
    const portrait = typeof meta?.["portrait"] === "string" ? (meta["portrait"] as string) : undefined;
    const visible = portrait !== undefined && meta?.["presence"] !== false;
    this.side = meta?.["side"] === "right" ? "right" : "left";
    this.speakerId = line?.speaker?.id;
    if (visible && portrait !== undefined && line) {
      this.ensureSprite(portrait);
      this.applyTexture(portrait);
      this.size = this.layout.sizeFor(line);
      this.shown = true;
    } else {
      this.shown = false;
    }
    this.follow();
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyVisibility();
  }

  update(): void {
    this.follow(); // the bubble follows a moving actor; the portrait tracks it
  }

  dispose(): void {
    this.entity?.destroy();
    this.bgEntity?.destroy();
    this.entity = undefined;
    this.bgEntity = undefined;
    this.sprite = undefined;
    this.bg = undefined;
    this.transform = undefined;
    this.bgTransform = undefined;
  }

  /** Place the portrait beside the bubble, vertically centred on the bubble
   *  body, tracking the speaker's (moving) anchor. */
  private follow(): void {
    if (!this.transform || !this.scene || !this.size || !this.shown) return;
    const a = this.layout.anchorFor(this.scene, this.speakerId);
    const half = this.cfg.size / 2;
    const gap = this.cfg.gap ?? 8;
    const bubbleHalf = this.size.width / 2;
    const x =
      this.side === "left"
        ? a.x - bubbleHalf - gap - half
        : a.x + bubbleHalf + gap + half;
    // Bubble body spans [anchor.y - offsetY - height, anchor.y - offsetY].
    const y = a.y - this.layout.offsetY - this.size.height / 2;
    this.transform.setPosition(x, y);
    this.bgTransform?.setPosition(x, y);
  }

  private applyVisibility(): void {
    const shown = this.shown && !this.hidden;
    if (this.sprite) this.sprite.sprite.visible = shown;
    if (this.bg) this.bg.graphics.visible = shown;
  }

  private ensureSprite(initialKey: string): void {
    if (this.sprite || !this.scene) return;
    const bgCfg = this.cfg.background;
    if (bgCfg) {
      const bgEntity = this.scene.spawn("dlg-bubble-avatar-bg");
      this.bgTransform = bgEntity.add(new Transform());
      const w = this.cfg.size;
      const bg = bgEntity.add(new GraphicsComponent({ layer: this.cfg.layer }));
      bg.draw((g) =>
        g
          .roundRect(-w / 2, -w / 2, w, w, bgCfg.radius ?? 8)
          .fill({ color: bgCfg.color, alpha: bgCfg.alpha ?? 1 }),
      );
      bg.graphics.visible = false;
      this.bg = bg;
      this.bgEntity = bgEntity;
    }
    const entity = this.scene.spawn("dlg-bubble-avatar");
    this.transform = entity.add(new Transform());
    const scale = this.cfg.scale ?? 1;
    this.transform.setScale(scale, scale);
    this.sprite = entity.add(
      new SpriteComponent({
        texture: this.handle(initialKey),
        layer: this.cfg.layer,
        anchor: { x: 0.5, y: 0.5 },
        visible: false,
      }),
    );
    this.entity = entity;
  }

  private applyTexture(key: string): void {
    this.sprite?.setTexture(this.handle(key));
  }

  private handle(key: string): TextureHandle {
    let h = this.handles.get(key);
    if (!h) {
      h = texture(key);
      this.handles.set(key, h);
    }
    return h;
  }
}
