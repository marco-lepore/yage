/**
 * Diegetic speech-bubble chrome: a rounded bubble + downward tail drawn on a
 * *world* layer, repositioned every frame to sit above the speaking actor's
 * head (resolved through the {@link ActorRegistry} from the presented line's
 * speaker id). The matching body text is a {@link DialogueTextView} with an
 * origin provider tracking the same anchor — see `createBubbleDialogue`.
 *
 * Sizing is fixed from config (content-sizing a bubble is a future nicety); the
 * companion text view wraps to the same inner width so they stay aligned.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import type { PresentedLine } from "../core/session.js";
import { bubbleContentHeight } from "../render/bubbleSizing.js";
import type { ChromePresenter } from "./DialogueUiAdapter.js";

export interface BubbleChromeConfig {
  /** World-space render layer. */
  readonly layer: string;
  readonly width: number;
  /** Minimum bubble height (px). The bubble grows past this to fit its text. */
  readonly height: number;
  readonly padding: number;
  /** Gap between the actor's head anchor and the bubble's bottom edge. */
  readonly offsetY: number;
  /** Tail height (the little pointer toward the speaker). */
  readonly tail: number;
  readonly bgColor: number;
  readonly bgAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly nameColor: number;
  readonly nameSize: number;
  readonly indicatorColor: number;
  /** Body-text size + line advance — to size the bubble to its wrapped text,
   *  matching the companion `BubbleTextView`. */
  readonly textSize: number;
  readonly lineHeight: number;
  readonly bitmapFont?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly resolution?: number | undefined;
}

export class BubbleChrome implements ChromePresenter {
  private scene?: Scene | undefined;
  private root?: Entity | undefined;
  private gfx?: GraphicsComponent | undefined;
  private transform?: Transform | undefined;
  private name?: TextComponent | undefined;
  private caret?: GraphicsComponent | undefined;
  private caretTransform?: Transform | undefined;
  private actor?: DialogueActor | undefined;
  private caretVisible = false;
  private caretTime = 0;
  /** Current (content-sized) bubble height; grows per line to fit the text. */
  private currentHeight: number;

  constructor(private readonly cfg: BubbleChromeConfig) {
    this.currentHeight = cfg.height;
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const c = this.cfg;
    const root = scene.spawn("dlg-bubble");
    this.transform = root.add(new Transform());
    this.gfx = root.add(new GraphicsComponent({ layer: c.layer }));
    this.drawBubble();
    this.gfx.graphics.visible = false;

    // Name floats just above the bubble; left-aligned to the inner edge.
    const nameEntity = scene.spawn("dlg-bubble-name");
    nameEntity.add(new Transform()).setPosition(0, 0);
    this.name = nameEntity.add(
      new TextComponent(this.textOptions("", c.nameSize, c.nameColor)),
    );
    this.name.text.visible = false;

    const caretEntity = scene.spawn("dlg-bubble-caret");
    this.caretTransform = caretEntity.add(new Transform());
    this.caret = caretEntity.add(new GraphicsComponent({ layer: c.layer }));
    // Drawn once in local coords; positioned each frame via the transform.
    this.caret.draw((g) => {
      g.poly([0, 0, 7, 0, 3.5, 5]).fill({ color: c.indicatorColor, alpha: 1 });
    });
    this.caret.graphics.visible = false;

    this.root = root;
  }

  /** Re-anchor to the line's speaker, grow to fit the text, and reveal. */
  present(line: PresentedLine | undefined): void {
    this.actor = this.scene
      ? actorRegistryFor(this.scene).resolve(line?.speaker?.id)
      : undefined;
    const show = this.actor !== undefined;
    if (show && line) {
      const c = this.cfg;
      const plain = line.text.runs.map((r) => r.text).join("");
      this.currentHeight = bubbleContentHeight(plain, {
        width: c.width,
        padding: c.padding,
        minHeight: c.height,
        textSize: c.textSize,
        lineHeight: c.lineHeight,
        fontFamily: c.fontFamily,
        bitmapFont: c.bitmapFont,
      });
      this.drawBubble();
    }
    if (this.gfx) this.gfx.graphics.visible = show;
    if (this.name) {
      const label = line?.speaker?.name;
      this.name.text.visible = show && !!label;
      if (label) {
        this.name.text.style.fill = line?.speaker?.color ?? this.cfg.nameColor;
        this.name.setText(label);
      }
    }
    this.follow();
  }

  setNameplate(name: string | undefined): void {
    // No speaker (e.g. conversation end) → hide the whole bubble.
    if (name === undefined) {
      this.actor = undefined;
      if (this.gfx) this.gfx.graphics.visible = false;
      if (this.name) this.name.text.visible = false;
      this.setContinueVisible(false);
    }
  }

  setContinueVisible(visible: boolean): void {
    this.caretVisible = visible && this.actor !== undefined;
    if (this.caret) this.caret.graphics.visible = this.caretVisible;
    this.caretTime = 0;
  }

  /** Hide the whole bubble (used by a composite chrome when a box line plays). */
  setVisible(visible: boolean): void {
    if (visible) return; // shown on the next `present`
    this.actor = undefined;
    if (this.gfx) this.gfx.graphics.visible = false;
    if (this.name) this.name.text.visible = false;
    this.setContinueVisible(false);
  }

  update(dt: number): void {
    this.follow();
    if (this.caret && this.caretVisible) {
      this.caretTime += dt;
      this.caret.graphics.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.caretTime / 260));
    }
  }

  dispose(): void {
    this.root?.destroy();
    this.name?.entity.destroy();
    this.caret?.entity.destroy();
    this.root = undefined;
    this.gfx = undefined;
    this.transform = undefined;
    this.name = undefined;
    this.caret = undefined;
    this.caretTransform = undefined;
  }

  /** Move the bubble + name + caret to sit above the active actor's head. */
  private follow(): void {
    if (!this.actor) return;
    const a = this.actor.anchorWorld();
    const c = this.cfg;
    const h = this.currentHeight;
    this.transform?.setPosition(a.x, a.y);
    // Name: top-left corner of the bubble, lifted by the (grown) bubble height.
    this.name?.entity
      .tryGet(Transform)
      ?.setPosition(a.x - c.width / 2 + c.padding, a.y - (c.offsetY + h) - c.nameSize - 1);
    // Caret: bottom-right interior of the bubble (anchored near the bottom edge).
    this.caretTransform?.setPosition(a.x + c.width / 2 - c.padding - 7, a.y - c.offsetY - c.padding - 2);
  }

  private drawBubble(): void {
    const c = this.cfg;
    const h = this.currentHeight;
    const x = -c.width / 2;
    const y = -(c.offsetY + h);
    this.gfx?.draw((g) => {
      g.roundRect(x, y, c.width, h, c.cornerRadius)
        .fill({ color: c.bgColor, alpha: c.bgAlpha })
        .stroke({ color: c.borderColor, alpha: 1, width: 2 });
      // Tail pointing down toward the speaker (anchor at local 0,0).
      g.poly([-c.tail, -c.offsetY, c.tail, -c.offsetY, 0, -c.offsetY + c.tail]).fill({
        color: c.bgColor,
        alpha: c.bgAlpha,
      });
    });
  }

  private styleFor(size: number, color: number): TextStyle {
    const style: TextStyle = { fontSize: size, fill: color };
    if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    return style;
  }

  private textOptions(text: string, size: number, color: number): TextComponentOptions {
    const style = this.styleFor(size, color);
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    const base: TextComponentOptions = { text, style, layer: this.cfg.layer, anchor: { x: 0, y: 0 } };
    if (this.cfg.bitmapFont) base.bitmap = true;
    // `exactOptionalPropertyTypes` rejects `resolution: undefined`; omit when unset.
    else if (this.cfg.resolution !== undefined) base.resolution = this.cfg.resolution;
    return base;
  }
}
