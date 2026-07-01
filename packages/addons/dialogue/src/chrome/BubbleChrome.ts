/**
 * Diegetic speech-bubble chrome: a rounded bubble + downward tail drawn on a
 * *world* layer, repositioned every frame to sit above the speaking actor's
 * head. The per-line size, the speaker→world anchor (incl. the missing-actor
 * fallback), and the inner-top-left origin all come from the shared
 * {@link BubbleLayout} — the single owner the companion {@link BubbleTextView}
 * and {@link BubbleChoicePresenter} read too, so they can never drift. This
 * class keeps only the bubble's *drawing* config (colours, tail, caret, name).
 *
 * The bubble is content-sized per line (see {@link BubbleLayout.sizeFor}); the
 * companion text view wraps to the same inner width so they stay aligned. With a
 * textured {@link BubbleChromeConfig.frame}, the body renders as a nine-slice
 * stretched to that same per-line size (the tail stays a drawn triangle).
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  createNineSlice,
  GraphicsComponent,
  TextComponent,
  type NineSliceSprite,
} from "@yagejs/renderer";
import type { PresentedLine } from "../core/session.js";
import type { BubbleLayout } from "../render/BubbleLayout.js";
import { caretAlpha, drawCaret } from "./caret.js";
import type { ChromePresenter, DiagnosticSink } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";
import {
  DEFAULT_CARET_SIZE,
  DEFAULT_TAIL_LEAN,
  type CaretTheme,
  type NineSliceFrame,
} from "../factory/theme.js";

export interface BubbleChromeConfig extends FontConfig {
  /** World-space render layer. */
  readonly layer: string;
  /** Tail height (the little pointer toward the speaker). */
  readonly tail: number;
  /** Tail tip offset from the speaker anchor (the asymmetric "lean"). */
  readonly tailLean?: { readonly x: number; readonly y: number } | undefined;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  /** Continue-caret blink + size (built-in defaults when omitted). */
  readonly caret?: CaretTheme | undefined;
  /** Optional textured nine-slice for the bubble body (the `"default"` style's
   *  `bubble`). Resized per line; omit for the drawn Graphics bubble. */
  readonly frame?: NineSliceFrame | undefined;
}

export class BubbleChrome implements ChromePresenter {
  private scene?: Scene | undefined;
  private root?: Entity | undefined;
  private gfx?: GraphicsComponent | undefined;
  private transform?: Transform | undefined;
  /** Nine-slice body sprite (child of {@link gfx}) when textured; resized per
   *  line. The tail stays a drawn triangle on {@link gfx}. */
  private bubbleSlice?: NineSliceSprite | undefined;
  private name?: TextComponent | undefined;
  private nameTransform?: Transform | undefined;
  private caret?: GraphicsComponent | undefined;
  private caretTransform?: Transform | undefined;
  private caretTime = 0;
  /** Current (content-sized) bubble size; recomputed per line from the layout. */
  private currentWidth: number;
  private currentHeight: number;
  // Master visibility + content sub-state; rendered = visible && hasLine.
  private visible = false; // master (from setVisible)
  private hasLine = false; // a line is up (from present)
  private nameShown = false; // the speaker has a name to show
  private caretShown = false; // continue caret requested
  /** Speaker id of the line on screen — re-resolved each frame by `follow()` so
   *  the bubble tracks a live actor and falls back when one is missing. */
  private speakerId: string | undefined;

  constructor(
    private readonly cfg: BubbleChromeConfig,
    private readonly layout: BubbleLayout,
  ) {
    this.currentWidth = 0;
    this.currentHeight = 0;
  }

  /** Route the missing-actor warning to the engine Logger (the layout owns the
   *  shared anchor resolver). */
  setDiagnostics(warn: DiagnosticSink): void {
    this.layout.setDiagnostics(warn);
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const c = this.cfg;
    const root = scene.spawn("dlg-bubble");
    this.transform = root.add(new Transform());
    this.gfx = root.add(new GraphicsComponent({ layer: c.layer }));
    if (c.frame) {
      // Textured body: a nine-slice child of the bubble graphics, resized +
      // positioned per line in drawBubble. createNineSlice keeps the addon off a
      // direct pixi.js import.
      const slice = createNineSlice({
        texture: c.frame.texture,
        leftWidth: c.frame.insets.left,
        topHeight: c.frame.insets.top,
        rightWidth: c.frame.insets.right,
        bottomHeight: c.frame.insets.bottom,
        width: this.currentWidth,
        height: this.currentHeight,
      });
      this.gfx.graphics.addChild(slice);
      this.bubbleSlice = slice;
    }
    this.drawBubble();
    this.gfx.graphics.visible = false;

    // Name floats just above the bubble; left-aligned to the inner edge.
    const nameEntity = scene.spawn("dlg-bubble-name");
    this.nameTransform = nameEntity.add(new Transform());
    this.name = nameEntity.add(
      new TextComponent(makeTextOptions(c, "", c.nameSize, c.nameColor, c.layer)),
    );
    this.name.text.visible = false;

    const caretEntity = scene.spawn("dlg-bubble-caret");
    this.caretTransform = caretEntity.add(new Transform());
    this.caret = caretEntity.add(new GraphicsComponent({ layer: c.layer }));
    // Drawn once in local coords; positioned each frame via the transform.
    this.caret.draw((g) => drawCaret(g, c.indicatorColor, c.caret?.size));
    this.caret.graphics.visible = false;

    this.root = root;
  }

  /** Re-anchor to the line's speaker, grow to fit the text, and reveal. The
   *  bubble stays visible even when the speaker has no live actor — the layout
   *  anchors it at the last-known / fallback position instead of vanishing. */
  present(line: PresentedLine | undefined): void {
    this.hasLine = line !== undefined;
    this.speakerId = line?.speaker?.id;
    if (line) {
      const size = this.layout.sizeFor(line);
      this.currentWidth = size.width;
      this.currentHeight = size.height;
      this.drawBubble();
      const label = line.speaker?.name;
      this.nameShown = label !== undefined && label.length > 0;
      if (label && this.name) {
        this.name.text.style.fill = line.speaker?.color ?? this.cfg.nameColor;
        this.name.setText(label);
      }
    } else {
      this.nameShown = false;
    }
    this.apply();
    this.follow();
  }

  setNameplate(name: string | undefined): void {
    // The bubble owns its own nameplate (set from present's speaker); this
    // handles only the "no name" (undefined) clear. Visibility is governed by
    // setVisible, never by the nameplate.
    if (name === undefined) {
      this.nameShown = false;
      this.apply();
    }
  }

  setContinueVisible(visible: boolean): void {
    // no `actor !== undefined` gate — the caret shows for a missing-actor
    // line too (the bubble is at the fallback anchor, not hidden).
    this.caretShown = visible;
    this.caretTime = 0;
    this.apply();
  }

  /** Show or hide the whole bubble — state-preserving: the line, name, and
   *  caret content survive a hide, so showing again restores them in place
   *  (used by a composite chrome to hide the bubble while a box line plays). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.apply();
  }

  /** Render each piece = master-visible AND a line is up AND its content present. */
  private apply(): void {
    if (this.gfx) this.gfx.graphics.visible = this.visible && this.hasLine;
    if (this.name) {
      this.name.text.visible = this.visible && this.hasLine && this.nameShown;
    }
    if (this.caret) {
      this.caret.graphics.visible = this.visible && this.hasLine && this.caretShown;
    }
  }

  update(dt: number): void {
    this.follow();
    // Read pixi's `visible` directly — a parallel boolean could desync (e.g.
    // keep animating a caret that `setVisible(false)` hid).
    const gfx = this.caret?.graphics;
    if (gfx?.visible) {
      // `dt` is seconds; `caretTime` feeds the millisecond `caretAlpha` blink.
      this.caretTime += dt * 1000;
      gfx.alpha = caretAlpha(this.caretTime, this.cfg.caret?.blinkMs);
    }
  }

  dispose(): void {
    this.root?.destroy();
    this.name?.entity.destroy();
    this.caret?.entity.destroy();
    this.root = undefined;
    this.gfx = undefined;
    this.transform = undefined;
    this.bubbleSlice = undefined;
    this.name = undefined;
    this.nameTransform = undefined;
    this.caret = undefined;
    this.caretTransform = undefined;
  }

  /** Move the bubble + name + caret to sit above the speaker — its live actor,
   *  or the last-known / fallback anchor when the actor is missing. */
  private follow(): void {
    if (!this.scene || !this.hasLine) return;
    const a = this.layout.anchorFor(this.scene, this.speakerId);
    const c = this.cfg;
    const padding = this.layout.padding;
    const offsetY = this.layout.offsetY;
    const w = this.currentWidth;
    const h = this.currentHeight;
    const caretSize = c.caret?.size ?? DEFAULT_CARET_SIZE;
    this.transform?.setPosition(a.x, a.y);
    // Name: top-left corner of the bubble, lifted by the (grown) bubble height.
    this.nameTransform?.setPosition(a.x - w / 2 + padding, a.y - (offsetY + h) - c.nameSize - 1);
    // Caret: bottom-right interior of the bubble (anchored near the bottom edge).
    this.caretTransform?.setPosition(
      a.x + w / 2 - padding - caretSize.width,
      a.y - offsetY - padding - caretSize.height + 3,
    );
  }

  private drawBubble(): void {
    const c = this.cfg;
    const offsetY = this.layout.offsetY;
    const w = this.currentWidth;
    const h = this.currentHeight;
    const L = -w / 2;
    const R = w / 2;
    const T = -(offsetY + h); // top edge
    const B = -offsetY; // bottom edge (the tail hangs below it to the speaker)
    const half = c.tail; // tail base half-width
    const lean = c.tailLean ?? DEFAULT_TAIL_LEAN;
    const tipX = lean.x; // slight lean
    const tipY = lean.y; // just above the actor's head anchor (local 0,0)
    this.gfx?.graphics.clear(); // re-drawn per line at a new size — don't accumulate

    if (this.bubbleSlice) {
      // Textured body: stretch the nine-slice to the content size and place it
      // at the bubble's top-left; draw only the tail triangle (the nine-slice is
      // a rectangle and can't carry the pointer).
      this.bubbleSlice.position.set(L, T);
      this.bubbleSlice.width = w;
      this.bubbleSlice.height = h;
      this.gfx?.draw((g) => {
        g.poly([-half, B, half, B, tipX, tipY]).fill({ color: c.frameColor, alpha: c.frameAlpha });
      });
      return;
    }

    const r = Math.max(0, Math.min(c.cornerRadius, w / 2 - 1, h / 2 - 1));
    // One closed silhouette (rounded rect + a tail notch on the bottom edge), so
    // the border flows around the tail instead of cutting across it.
    this.gfx?.draw((g) => {
      g.moveTo(L + r, T)
        .lineTo(R - r, T)
        .arcTo(R, T, R, T + r, r) // top-right
        .lineTo(R, B - r)
        .arcTo(R, B, R - r, B, r) // bottom-right
        .lineTo(half, B) // along the bottom edge to the tail base
        .lineTo(tipX, tipY) // down to the tail tip
        .lineTo(-half, B) // back up to the tail base
        .lineTo(L + r, B)
        .arcTo(L, B, L, B - r, r) // bottom-left
        .lineTo(L, T + r)
        .arcTo(L, T, L + r, T, r) // top-left
        .closePath()
        .fill({ color: c.frameColor, alpha: c.frameAlpha })
        .stroke({ color: c.borderColor, alpha: 1, width: 2 });
    });
  }
}
