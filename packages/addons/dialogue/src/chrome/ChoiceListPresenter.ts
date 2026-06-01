/**
 * Default choice presenter — a bottom-anchored vertical list inside the box,
 * with a highlight bar behind the selected row. Split out of `DialogueChrome`
 * so the choice UI is swappable (a radial / Mass-Effect wheel, a separate
 * panel, a touch list) without touching the frame or body text. Selection
 * *navigation* lives in the Session; this presenter only paints what it's told
 * and reports pointer commits back through {@link ChoiceChannel.onChoiceChosen}.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { ChoiceChannel, PresentedChoice } from "../core/session.js";
import type { ChoicePresenter } from "./DialogueUiAdapter.js";

export interface ChoiceListConfig {
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: number;
  readonly choiceSize: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly highlightColor: number;
  readonly bitmapFont?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly resolution?: number | undefined;
  /** Selection highlight bar. */
  readonly layerFrame: string;
  /** Choice labels (drawn above the frame layer). */
  readonly layerText: string;
}

interface ChoiceRow {
  readonly entity: Entity;
  readonly comp: TextComponent;
}

const CHOICE_GAP = 6;

export class ChoiceListPresenter implements ChoicePresenter, ChoiceChannel {
  private scene?: Scene | undefined;
  private highlightBar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private rows: ChoiceRow[] = [];
  private selected = -1;

  onChoiceChosen?: (position: number) => void;

  constructor(private readonly cfg: ChoiceListConfig) {}

  mount(scene: Scene): void {
    this.scene = scene;
    const hl = scene.spawn("dlg-highlight");
    hl.add(new Transform()).setPosition(0, 0);
    const hlGfx = hl.add(new GraphicsComponent({ layer: this.cfg.layerFrame }));
    this.highlightBar = { entity: hl, gfx: hlGfx };
  }

  // Screen-space box list — ignores the choice context (the box frame is its
  // backing; routing is the composite's job).
  present(choices: readonly PresentedChoice[]): void {
    this.clear();
    if (!this.scene) return;
    const { box, cfg } = { box: this.cfg.box, cfg: this.cfg };
    const lineH = cfg.choiceSize + CHOICE_GAP;
    const n = choices.length;
    choices.forEach((choice, i) => {
      const y = box.y + box.height - cfg.padding - (n - i) * lineH + 2;
      const entity = this.scene!.spawn("dlg-choice");
      entity.add(new Transform()).setPosition(box.x + cfg.padding + 6, y);
      const comp = entity.add(
        new TextComponent(this.textOptions(choice.label, cfg.choiceColor)),
      );
      comp.text.visible = true;
      this.rows.push({ entity, comp });
    });
    this.highlightAt(0);
  }

  highlight(position: number): void {
    this.highlightAt(position);
  }

  /** {@link PointerChoiceTarget}: which row (if any) a screen point falls in. */
  choiceAtPoint(x: number, y: number): number | undefined {
    const n = this.rows.length;
    if (n === 0) return undefined;
    const { box, cfg } = { box: this.cfg.box, cfg: this.cfg };
    if (x < box.x + cfg.padding || x > box.x + box.width - cfg.padding) return undefined;
    const lineH = cfg.choiceSize + CHOICE_GAP;
    for (let i = 0; i < n; i++) {
      const rowY = box.y + box.height - cfg.padding - (n - i) * lineH;
      if (y >= rowY && y <= rowY + lineH) return i;
    }
    return undefined;
  }

  clear(): void {
    for (const row of this.rows) row.entity.destroy();
    this.rows = [];
    this.selected = -1;
    this.highlightBar?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.highlightBar?.entity.destroy();
    this.highlightBar = undefined;
  }

  private highlightAt(position: number): void {
    if (this.rows.length === 0) return;
    this.selected = Math.max(0, Math.min(this.rows.length - 1, position));
    this.rows.forEach((row, i) => {
      row.comp.text.style.fill =
        i === this.selected ? this.cfg.choiceSelectedColor : this.cfg.choiceColor;
    });
    this.drawHighlight();
  }

  private drawHighlight(): void {
    if (!this.highlightBar || this.selected < 0) return;
    const { box, cfg } = { box: this.cfg.box, cfg: this.cfg };
    const lineH = cfg.choiceSize + CHOICE_GAP;
    const n = this.rows.length;
    const y = box.y + box.height - cfg.padding - (n - this.selected) * lineH;
    this.highlightBar.gfx.draw((g) => {
      g.clear();
      g.roundRect(box.x + cfg.padding, y, box.width - 2 * cfg.padding, lineH - 1, 3).fill({
        color: cfg.highlightColor,
        alpha: 0.3,
      });
    });
  }

  private styleFor(color: number): TextStyle {
    const style: TextStyle = { fontSize: this.cfg.choiceSize, fill: color };
    if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    return style;
  }

  private textOptions(text: string, color: number): TextComponentOptions {
    // Colour via `style.fill`; the bitmap font name lives in `style.fontFamily`.
    const style = this.styleFor(color);
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    const base: TextComponentOptions = { text, style, layer: this.cfg.layerText, anchor: { x: 0, y: 0 } };
    if (this.cfg.bitmapFont) base.bitmap = true;
    // `exactOptionalPropertyTypes` rejects `resolution: undefined`; omit when unset.
    else if (this.cfg.resolution !== undefined) base.resolution = this.cfg.resolution;
    return base;
  }
}
