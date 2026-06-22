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
import { SpriteComponent, texture, type TextureHandle } from "@yagejs/renderer";
import type { AvatarPresenter } from "./AvatarPresenter.js";
import type { PresentedLine } from "../core/session.js";
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
    this.entity = undefined;
    this.sprite = undefined;
    this.transform = undefined;
  }

  /** Centre the sprite in its reserved column at the frame's current rect (so it
   *  follows `meta.position` and a grown choice panel). */
  private place(): void {
    if (!this.transform) return;
    const frame = this.layout.frameRect();
    const half = this.cfg.width / 2;
    const x = this.side === "left" ? frame.x + half : frame.x + frame.width - half;
    this.transform.setPosition(x, frame.y + frame.height / 2);
  }

  private applyVisibility(): void {
    if (this.sprite) this.sprite.sprite.visible = this.shown && !this.hidden;
  }

  private ensureSprite(initialKey: string): void {
    if (this.sprite || !this.scene) return;
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
