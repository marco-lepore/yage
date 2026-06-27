/**
 * InBoxAvatarPresenter — the reference **line-driven, reflowing in-box avatar**.
 * It is built ONLY from the documented presenter contract:
 *
 *  - {@link AvatarChannel.present} gives it the line, so it reads `meta.portrait`
 *    (texture key), `meta.side` (`left`/`right`, default left), and `meta.presence`
 *    (set `false` to speak from off-screen — portrait hidden, no inset);
 *  - {@link BoxLayout.setInset} reserves a column, so the box body text **reflows**
 *    around the portrait, and {@link BoxLayout.frameRect} places the sprite.
 *
 * It needs NO addon internals — that's the point: it doubles as the proof the
 * contract is sufficient to write a custom presenter (if building it ever needed
 * an internal, the contract — not the presenter — would be wrong). It is
 * opt-in: wire it through `createBoxDialogue(theme, { avatar })`, which hands
 * it the box's shared layout owner. With no avatar wired (or no `meta.portrait`),
 * behavior is unchanged.
 *
 * Portrait textures must be **preloaded** by the host (the presenter only
 * resolves `meta.portrait` to a handle), like `PortraitPresenter`.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  SpriteComponent,
  texture,
  type TextureHandle,
} from "@yagejs/renderer";
import { applyExpressionMarker, type AvatarPresenter } from "./AvatarPresenter.js";
import type { PresentedLine } from "../core/session.js";
import type { MarkerToken } from "../core/types.js";
import type { BoxLayout } from "../render/BoxLayout.js";

export interface InBoxAvatarConfig {
  /** Render layer (screen-space) — e.g. `DIALOGUE_LAYER_AVATAR`, which sits
   *  between the frame and the text so the portrait tucks behind the box edge. */
  readonly layer: string;
  /** Width (px) of the reserved avatar column; the body text reflows past it. */
  readonly width: number;
  /** Gap (px) between the avatar column and the reflowed text. Default 8. */
  readonly gap?: number;
  /** Uniform sprite scale (textures must be preloaded by the host). Default 1. */
  readonly scale?: number;
  /** Optional rounded-rect panel drawn behind the portrait (a framed look),
   *  sized to the {@link width} column. Omit for a bare sprite. */
  readonly background?: {
    readonly color: number;
    readonly alpha?: number;
    /** Corner radius (px). Default 8. */
    readonly radius?: number;
  };
  /** Vertical alignment in the box: `top` (level with the body text) or
   *  `center` (default — centred in the frame, so it sinks in a grown choice box). */
  readonly align?: "top" | "center";
}

/** Distinct inset key per instance so two in-box avatars can coexist. */
let nextId = 0;

export class InBoxAvatarPresenter implements AvatarPresenter {
  private readonly insetKey = `avatar:${nextId++}`;
  // Explicit `| undefined` (not `?`) so reassigning `undefined` is legal under
  // the repo's exactOptionalPropertyTypes.
  private scene: Scene | undefined;
  private entity: Entity | undefined;
  private sprite: SpriteComponent | undefined;
  private transform: Transform | undefined;
  /** Optional background panel (behind the portrait), its own entity so it draws
   *  under the sprite on the same layer. */
  private bgEntity: Entity | undefined;
  private bg: GraphicsComponent | undefined;
  private bgTransform: Transform | undefined;
  private side: "left" | "right" = "left";
  /** A portrait is up for the current line (from `meta.portrait` + presence). */
  private shown = false;
  /** Host-hidden gate (a cutscene hides the avatar with the rest of the UI). */
  private hidden = false;
  private readonly handles = new Map<string, TextureHandle>();

  constructor(
    private readonly layout: BoxLayout,
    private readonly cfg: InBoxAvatarConfig,
  ) {
    // Reposition whenever the box frame commits or grows. The session calls
    // avatar.present() BEFORE the chrome commits this line's frame (and a choice
    // grows it later still), so place() in present() alone would read a stale
    // rect — this follows every commit, like DialogueChrome's applyGeometry.
    this.layout.onChange(() => this.place());
  }

  mount(scene: Scene): void {
    this.scene = scene;
  }

  // Image/side/presence are line-driven via `present`, not the speaker def — so
  // setSpeaker / setExpression / setSpeaking are intentionally inert here.
  setSpeaker(): void {}
  setExpression(): void {}
  setSpeaking(): void {}

  /** Routes a mid-line `[expression=…/]` marker to its own setExpression (inert
   *  here — this avatar is portrait-by-`meta`, not expression-mapped — so it's
   *  the uniform contract, not a visible face swap). */
  marker(marker: MarkerToken): void {
    applyExpressionMarker(this, marker);
  }

  /** Read the line's `meta` to show/hide the portrait and reserve (or clear) the
   *  text-reflow inset. Called before the body text presents, so the text wraps
   *  to the narrowed region. */
  present(line: PresentedLine | undefined): void {
    const meta = line?.meta;
    const portrait = typeof meta?.["portrait"] === "string" ? (meta["portrait"] as string) : undefined;
    const visible = portrait !== undefined && meta?.["presence"] !== false;
    this.side = meta?.["side"] === "right" ? "right" : "left";
    if (visible && portrait !== undefined) {
      this.ensureSprite(portrait);
      this.applyTexture(portrait);
      this.shown = true;
      // Reserve the column (+ gap) so the body text reflows past the portrait.
      this.layout.setInset(this.insetKey, { side: this.side, width: this.cfg.width + (this.cfg.gap ?? 8) });
    } else {
      this.shown = false;
      this.layout.setInset(this.insetKey, undefined); // text reclaims the full width
    }
    this.place();
    this.applyVisibility();
  }

  /** Host-hidden gate — hide with a cutscene, restore on show (only if a
   *  portrait is still current). */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyVisibility();
  }

  update(): void {}

  dispose(): void {
    this.layout.setInset(this.insetKey, undefined);
    this.entity?.destroy();
    this.bgEntity?.destroy();
    this.entity = undefined;
    this.bgEntity = undefined;
    this.sprite = undefined;
    this.bg = undefined;
    this.transform = undefined;
    this.bgTransform = undefined;
  }

  /** Centre the portrait (+ its panel) in its reserved column, inset by the box
   *  padding so it sits inside the border like the text — at the frame's current
   *  rect, so it follows `meta.position` and a grown choice panel. */
  private place(): void {
    if (!this.transform) return;
    const frame = this.layout.frameRect();
    const pad = this.layout.padding();
    const half = this.cfg.width / 2;
    const x =
      this.side === "left"
        ? frame.x + pad + half
        : frame.x + frame.width - pad - half;
    // top: align the portrait's top with the body text top (below the nameplate);
    // center: centre it in the frame (default).
    const y =
      this.cfg.align === "top"
        ? this.layout.textRegion().y + half
        : frame.y + frame.height / 2;
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
    // Background panel first (same layer), so the portrait spawned next draws
    // on top of it.
    const bgCfg = this.cfg.background;
    if (bgCfg) {
      const bgEntity = this.scene.spawn("dlg-inbox-avatar-bg");
      this.bgTransform = bgEntity.add(new Transform());
      const w = this.cfg.width;
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
    const entity = this.scene.spawn("dlg-inbox-avatar");
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
