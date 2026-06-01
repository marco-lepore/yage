/**
 * A diegetic choice list: the options float in their own bubble panel over the
 * speaking actor (resolved via the {@link ActorRegistry} from the choice's
 * `context.speaker`), with their own background — so a bubble choice never
 * leans on the box frame (the source of the "frameless options" glitch). Pairs
 * with {@link BubbleChrome}/{@link BubbleTextView}; keyboard nav is Session-
 * driven, pointer hover/click come back via `onChoiceChosen` (world coords).
 *
 * The actor is static while a focused choice is up (the player is frozen), so
 * the panel is placed once on `present` rather than followed each frame.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import { actorRegistryFor } from "../actor/index.js";
import type { ChoiceContext, PresentedChoice } from "../core/session.js";
import type { ChoicePresenter } from "./DialogueUiAdapter.js";

export interface BubbleChoiceConfig {
  /** World-space render layer (same as the bubble). */
  readonly layer: string;
  readonly width: number;
  readonly padding: number;
  /** Gap between the actor's head anchor and the panel's bottom edge. */
  readonly offsetY: number;
  readonly tail: number;
  readonly choiceSize: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly highlightColor: number;
  /** Colour for the optional prompt header rendered inside the panel. */
  readonly promptColor: number;
  readonly bgColor: number;
  readonly bgAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  readonly bitmapFont?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly resolution?: number | undefined;
}

interface Row {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

const GAP = 4;

export class BubbleChoicePresenter implements ChoicePresenter {
  readonly pointerSpace = "world" as const;

  private scene?: Scene | undefined;
  private bg?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private highlightBar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private prompt?: { entity: Entity; comp: TextComponent } | undefined;
  private rows: Row[] = [];
  private selected = -1;

  onChoiceChosen?: (position: number) => void;

  constructor(private readonly cfg: BubbleChoiceConfig) {}

  /** This panel is self-contained (own bg + prompt header), so it owns the
   *  prompt — the Session hides the chrome/body prompt for these choices. */
  ownsPrompt(): boolean {
    return true;
  }

  mount(scene: Scene): void {
    this.scene = scene;
    const bg = scene.spawn("dlg-bchoice-bg");
    bg.add(new Transform()).setPosition(0, 0);
    this.bg = { entity: bg, gfx: bg.add(new GraphicsComponent({ layer: this.cfg.layer })) };
    const hl = scene.spawn("dlg-bchoice-hl");
    hl.add(new Transform()).setPosition(0, 0);
    this.highlightBar = { entity: hl, gfx: hl.add(new GraphicsComponent({ layer: this.cfg.layer })) };
  }

  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void {
    this.clear();
    if (!this.scene) return;
    const c = this.cfg;
    const actor = actorRegistryFor(this.scene).resolve(context?.speaker?.id);
    const a = actor?.anchorWorld() ?? { x: 0, y: 0 };
    const innerW = c.width - 2 * c.padding;

    // Optional prompt header inside the same panel (one bubble, not two).
    const promptStr =
      context?.prompt && context.prompt.length > 0
        ? context.prompt.runs.map((r) => r.text).join("")
        : "";
    let promptH = 0;
    if (promptStr) {
      const e = this.scene.spawn("dlg-bchoice-prompt");
      e.add(new Transform());
      const comp = e.add(new TextComponent(this.textOptions(promptStr, c.promptColor, innerW)));
      comp.text.visible = true;
      promptH = Math.ceil(comp.text.height);
      this.prompt = { entity: e, comp };
    }

    const n = choices.length;
    const lineH = c.choiceSize + GAP;
    const headH = promptH > 0 ? promptH + GAP : 0;
    const h = c.padding + headH + n * lineH + c.padding;
    const left = a.x - c.width / 2;
    const bottom = a.y - c.offsetY;
    const top = bottom - h;

    this.drawPanel(left, top, h, a.x, bottom);
    this.prompt?.entity.get(Transform).setPosition(left + c.padding, top + c.padding);

    const optionsTop = top + c.padding + headH;
    choices.forEach((choice, i) => {
      const rowY = optionsTop + i * lineH;
      const entity = this.scene!.spawn("dlg-bchoice");
      entity.add(new Transform()).setPosition(left + c.padding + 4, rowY);
      const comp = entity.add(new TextComponent(this.textOptions(choice.label, c.choiceColor)));
      comp.text.visible = true;
      this.rows.push({
        entity,
        comp,
        x0: left + c.padding,
        x1: left + c.width - c.padding,
        y0: rowY,
        y1: rowY + lineH,
      });
    });
    this.highlight(0);
  }

  highlight(position: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(this.rows.length - 1, position));
    this.rows.forEach((row, i) => {
      row.comp.text.style.fill = i === this.selected ? this.cfg.choiceSelectedColor : this.cfg.choiceColor;
    });
    this.drawHighlight();
  }

  /** {@link ChoicePresenter}: which option a *world* point falls in. */
  choiceAtPoint(x: number, y: number): number | undefined {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return i;
    }
    return undefined;
  }

  clear(): void {
    for (const r of this.rows) r.entity.destroy();
    this.rows = [];
    this.prompt?.entity.destroy();
    this.prompt = undefined;
    this.selected = -1;
    this.bg?.gfx.draw((g) => g.clear());
    this.highlightBar?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.bg?.entity.destroy();
    this.highlightBar?.entity.destroy();
    this.bg = undefined;
    this.highlightBar = undefined;
  }

  private drawPanel(left: number, top: number, h: number, tailX: number, bottom: number): void {
    const c = this.cfg;
    this.bg?.gfx.draw((g) => {
      g.clear();
      g.roundRect(left, top, c.width, h, c.cornerRadius)
        .fill({ color: c.bgColor, alpha: c.bgAlpha })
        .stroke({ color: c.borderColor, alpha: 1, width: 2 });
      g.poly([tailX - c.tail, bottom, tailX + c.tail, bottom, tailX, bottom + c.tail]).fill({
        color: c.bgColor,
        alpha: c.bgAlpha,
      });
    });
  }

  private drawHighlight(): void {
    const row = this.rows[this.selected];
    if (!this.highlightBar || !row) return;
    this.highlightBar.gfx.draw((g) => {
      g.clear();
      g.roundRect(row.x0, row.y0, row.x1 - row.x0, row.y1 - row.y0 - 1, 3).fill({
        color: this.cfg.highlightColor,
        alpha: 0.3,
      });
    });
  }

  private textOptions(text: string, color: number, wrapWidth?: number): TextComponentOptions {
    const style: TextStyle = { fontSize: this.cfg.choiceSize, fill: color };
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    else if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    if (wrapWidth != null) {
      style.wordWrap = true;
      style.wordWrapWidth = wrapWidth;
    }
    const base: TextComponentOptions = { text, style, layer: this.cfg.layer, anchor: { x: 0, y: 0 } };
    if (this.cfg.bitmapFont) base.bitmap = true;
    // `exactOptionalPropertyTypes` rejects `resolution: undefined`; omit when unset.
    else if (this.cfg.resolution !== undefined) base.resolution = this.cfg.resolution;
    return base;
  }
}
