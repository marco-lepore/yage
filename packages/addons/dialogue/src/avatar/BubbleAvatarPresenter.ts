/**
 * BubbleAvatarPresenter — the reference **line-driven portrait INSIDE the speech
 * bubble**, the bubble counterpart to {@link InBoxAvatarPresenter}. Built only
 * from the documented contract: {@link AvatarChannel.present} gives it the line
 * (so it reads `meta.portrait` / `meta.side` / `meta.presence`), and it reserves
 * a portrait column on the shared {@link BubbleLayout} (`setPortraitInset`) — so
 * the bubble **grows** to contain the portrait and its body text **reflows** past
 * it, and the whole thing follows the speaker's actor.
 *
 * Portrait textures must be **preloaded** by the host. Wire it through
 * `createMixedDialogue(theme, { avatar: { bubble } })`.
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
  private shown = false;
  private hidden = false;
  private readonly handles = new Map<string, TextureHandle>();

  constructor(
    private readonly layout: BubbleLayout,
    private readonly cfg: BubbleAvatarConfig,
  ) {
    // Follow the active bubble content rect — a say bubble (sized after this
    // avatar presents) or a choice panel (committed later still). Both notify.
    this.layout.onChange(() => this.follow());
  }

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
      // Reserve the column BEFORE the chrome/text/choices size the bubble, so it
      // grows to contain the portrait and the text/rows reflow past it.
      const gap = this.cfg.gap ?? 8;
      this.layout.setPortraitInset({ side: this.side, width: this.cfg.size + gap, height: this.cfg.size });
      this.ensureSprite(portrait);
      this.applyTexture(portrait);
      this.shown = true;
    } else {
      this.layout.setPortraitInset(undefined); // bubble reclaims its full width
      this.shown = false;
    }
    this.follow(); // re-runs via onChange once the bubble/panel size is committed
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

  /** Place the portrait in its reserved column INSIDE the active bubble (say
   *  bubble or choice panel), vertically centred on the body, tracking the
   *  speaker's (moving) anchor. */
  private follow(): void {
    const size = this.layout.activeSize();
    if (!this.transform || !this.scene || !size || !this.shown) return;
    const a = this.layout.anchorFor(this.scene, this.speakerId);
    const pad = this.layout.padding;
    const half = this.cfg.size / 2;
    const x =
      this.side === "left"
        ? a.x - size.width / 2 + pad + half
        : a.x + size.width / 2 - pad - half;
    // Bubble body spans [anchor.y - offsetY - height, anchor.y - offsetY].
    const y = a.y - this.layout.offsetY - size.height / 2;
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
