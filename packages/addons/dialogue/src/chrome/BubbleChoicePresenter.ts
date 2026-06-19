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

import { MathUtils, Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
} from "@yagejs/renderer";
import type { ChoiceContext, PresentedChoice } from "../core/session.js";
import { BubbleAnchorResolver, type AnchorPoint } from "../render/bubbleAnchor.js";
import type { ChoicePresenter, DiagnosticSink } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";

export interface BubbleChoiceConfig extends FontConfig {
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
  /** Anchor for a missing/absent speaker with no last-known position (D3).
   *  Default world origin; share it with the bubble chrome. */
  readonly fallbackAnchor?: (() => AnchorPoint) | undefined;
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
  /** Master visibility gate (D1) — state-preserving hide/show. */
  private hidden = false;
  private readonly anchors: BubbleAnchorResolver;

  onChoiceChosen?: (position: number) => void;

  constructor(private readonly cfg: BubbleChoiceConfig) {
    this.anchors = new BubbleAnchorResolver(cfg.fallbackAnchor);
  }

  /** Route the missing-actor warning to the engine Logger (D3). */
  setDiagnostics(warn: DiagnosticSink): void {
    this.anchors.setDiagnostics(warn);
  }

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
    // D3: a missing speaker resolves to the last-known / fallback anchor (with a
    // once-per-speaker warning), never the world origin.
    const a = this.anchors.resolve(this.scene, context?.speaker?.id);
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
    this.applyHidden();
  }

  /** Show or hide the whole panel without clearing it (D1) — state-preserving. */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  /** Render every piece (bg, prompt, rows, highlight) gated by the master. */
  private applyHidden(): void {
    const shown = !this.hidden;
    if (this.bg) this.bg.gfx.graphics.visible = shown && this.rows.length > 0;
    if (this.highlightBar) {
      this.highlightBar.gfx.graphics.visible = shown && this.selected >= 0;
    }
    if (this.prompt) this.prompt.comp.text.visible = shown;
    for (const row of this.rows) row.comp.text.visible = shown;
  }

  highlight(position: number): void {
    if (this.rows.length === 0) return;
    this.selected = MathUtils.clamp(position, 0, this.rows.length - 1);
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
    const opts = makeTextOptions(this.cfg, text, this.cfg.choiceSize, color, this.cfg.layer);
    if (wrapWidth != null) {
      opts.style.wordWrap = true;
      opts.style.wordWrapWidth = wrapWidth;
    }
    return opts;
  }
}
