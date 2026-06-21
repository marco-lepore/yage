/**
 * Default choice presenter — a bottom-anchored vertical list inside the box,
 * with a highlight bar behind the selected row. Split out of `DialogueChrome`
 * so the choice UI is swappable (a radial / Mass-Effect wheel, a separate
 * panel, a touch list) without touching the frame or body text. Selection
 * *navigation* lives in the Session; this presenter only paints what it's told
 * and reports pointer commits back through {@link ChoiceChannel.onChoiceChosen}.
 */

import { MathUtils, Transform, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { ChoiceChannel, PresentedChoice } from "../core/session.js";
import type { ChoicePresenter } from "./DialogueUiAdapter.js";
import {
  makeTextOptions,
  choiceRowLabel,
  firstEnabledIndex,
  DISABLED_CHOICE_ALPHA,
  type FontConfig,
} from "./textOptions.js";

export interface ChoiceListConfig extends FontConfig {
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly padding: number;
  readonly choiceSize: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly highlightColor: number;
  /** Selection highlight bar. */
  readonly layerFrame: string;
  /** Choice labels (drawn above the frame layer). */
  readonly layerText: string;
}

interface ChoiceRow {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly disabled: boolean;
}

const CHOICE_GAP = 6;

export class ChoiceListPresenter implements ChoicePresenter, ChoiceChannel {
  private scene?: Scene | undefined;
  private highlightBar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private rows: ChoiceRow[] = [];
  private selected = -1;
  /** Master visibility gate — hides the list WITHOUT clearing it, so a
   *  hide/show round-trip keeps the rows + selection. */
  private hidden = false;

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
        new TextComponent(
          makeTextOptions(cfg, choiceRowLabel(choice), cfg.choiceSize, cfg.choiceColor, cfg.layerText),
        ),
      );
      comp.text.visible = true;
      this.rows.push({ entity, comp, disabled: choice.disabled ?? false });
    });
    // Land the initial highlight on the first ENABLED row (the Session re-asserts
    // this right after; doing it here keeps a stand-alone present() consistent).
    this.highlightAt(firstEnabledIndex(this.rows));
    this.applyHidden();
  }

  highlight(position: number): void {
    this.highlightAt(position);
  }

  /** Show or hide the list without clearing it — state-preserving. */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  /** Render = rows present AND not hidden. Disabled rows still show (greyed). */
  private applyHidden(): void {
    for (const row of this.rows) row.comp.text.visible = !this.hidden;
    if (this.highlightBar) {
      const onEnabled = this.selected >= 0 && !this.rows[this.selected]?.disabled;
      this.highlightBar.gfx.graphics.visible = !this.hidden && onEnabled;
    }
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
    this.selected = MathUtils.clamp(position, 0, this.rows.length - 1);
    this.rows.forEach((row, i) => {
      const active = i === this.selected && !row.disabled;
      row.comp.text.style.fill = active ? this.cfg.choiceSelectedColor : this.cfg.choiceColor;
      row.comp.text.alpha = row.disabled ? DISABLED_CHOICE_ALPHA : 1;
    });
    this.drawHighlight();
  }

  private drawHighlight(): void {
    if (!this.highlightBar || this.selected < 0) return;
    // A disabled row is never highlighted (nav skips it); clear any stale bar.
    if (this.rows[this.selected]?.disabled) {
      this.highlightBar.gfx.draw((g) => g.clear());
      return;
    }
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

}
