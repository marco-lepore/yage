import { ensureDialogueLayer } from "../render/ensureLayer.js";
/**
 * Default choice presenter — a vertical list inside the box, with a highlight
 * bar behind the selected row. Split out of `DialogueChrome` so the choice UI is
 * swappable (a radial / Mass-Effect wheel, a separate panel, a touch list)
 * without touching the frame or body text. Selection *navigation* lives in the
 * Session; this presenter only paints what it's told and reports pointer commits
 * back through {@link ChoiceChannel.onChoiceChosen}.
 *
 * Overflow + unified panel: labels word-wrap (a row may be several lines), and
 * the row stack is laid out by the shared {@link BoxLayout}, which **grows the
 * surrounding frame** to fit the rows + prompt + nameplate as one panel (a list
 * too tall for the screen spills off the bottom, non-overlapping). Row
 * placement, the selection highlight, and pointer hit-testing all derive from
 * the ONE set of row rects the owner returns, so a wrapped/overflowing row can't
 * desync them. A list longer than `softMaxChoices` logs a soft-cap advisory.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
} from "@yagejs/renderer";
import type { PresentedChoice } from "../core/session.js";
import { type BoxLayout, type ChoiceRowRect } from "../render/BoxLayout.js";
import type { ChoicePresenter, DiagnosticSink } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";
import {
  applyChoiceTint,
  choiceRowLabel,
  clampSelection,
  firstEnabledIndex,
} from "./choiceRow.js";
import { DEFAULT_CHOICE_GAP } from "../factory/theme.js";

export interface ChoiceListConfig extends FontConfig {
  readonly choiceSize: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly highlightColor: number;
  /** Vertical gap (px) between choice rows. Default {@link DEFAULT_CHOICE_GAP}. */
  readonly choiceGap?: number | undefined;
  /** Soft cap on option count: more than this logs an advisory (the list still
   *  grows to fit). Default {@link DEFAULT_SOFT_MAX_CHOICES}. */
  readonly softMaxChoices?: number | undefined;
  /** Selection highlight bar. */
  readonly layerFrame: string;
  /** Choice labels (drawn above the frame layer). */
  readonly layerText: string;
}

interface ChoiceRow {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly disabled: boolean;
  readonly rect: ChoiceRowRect;
}

/** Default soft cap on the option count before {@link ChoiceListPresenter} logs
 *  an advisory. A single menu much longer than this reads better paginated or
 *  as a sub-menu; the list still renders. */
export const DEFAULT_SOFT_MAX_CHOICES = 8;

/** Left indent (px) of a row's label inside its rect, leaving room for the
 *  highlight bar's rounded edge. */
const ROW_TEXT_INDENT = 6;

export class ChoiceListPresenter implements ChoicePresenter {
  private scene?: Scene | undefined;
  private highlightBar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private rows: ChoiceRow[] = [];
  private selected = -1;
  private warn?: DiagnosticSink | undefined;
  /** Master visibility gate — hides the list WITHOUT clearing it, so a
   *  hide/show round-trip keeps the rows + selection. */
  private hidden = false;

  onChoiceChosen?: (position: number) => void;

  constructor(
    private readonly cfg: ChoiceListConfig,
    private readonly layout: BoxLayout,
  ) {}

  /** Route the soft-cap advisory to the engine Logger. */
  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  mount(scene: Scene): void {
    ensureDialogueLayer(scene, this.cfg.layerFrame, 1100);
    ensureDialogueLayer(scene, this.cfg.layerText, 1110);
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
    const cfg = this.cfg;
    const gap = cfg.choiceGap ?? DEFAULT_CHOICE_GAP;
    const softMax = cfg.softMaxChoices ?? DEFAULT_SOFT_MAX_CHOICES;
    if (choices.length > softMax) {
      this.warn?.(
        `choice list: ${choices.length} options exceeds the soft max of ${softMax} — ` +
          `the list grows to fit, but a shorter menu (or a sub-menu) reads better`,
      );
    }

    const innerWidth = this.layout.contentWidth();
    const wrapWidth = innerWidth - ROW_TEXT_INDENT - 2;

    // Pass 1: build each row's wrapped label and measure its slot height
    // (wrapped text + gap). Word-wrap means a row can be several lines tall.
    const built = choices.map((choice) => {
      const entity = this.scene!.spawn("dlg-choice");
      entity.add(new Transform());
      const comp = entity.add(
        new TextComponent(this.textOptions(choiceRowLabel(choice), wrapWidth)),
      );
      comp.text.visible = true;
      const slotHeight = Math.ceil(comp.text.height) + gap;
      return { entity, comp, disabled: choice.disabled ?? false, slotHeight };
    });

    // Pass 2: hand the row heights to the owner, which grows the surrounding
    // frame to fit them (+ prompt + nameplate) and returns the stacked rects —
    // the ONE geometry source for placement, highlight, and hit-test. Then place
    // each label at its rect (indented for the highlight bar's rounded edge).
    const rects = this.layout.layoutChoicePanel(built.map((b) => b.slotHeight));
    this.rows = built.map((b, i) => {
      const rect = rects[i] ?? {
        x: 0,
        y: 0,
        width: innerWidth,
        height: b.slotHeight,
      };
      b.entity.get(Transform).setPosition(rect.x + ROW_TEXT_INDENT, rect.y);
      return { entity: b.entity, comp: b.comp, disabled: b.disabled, rect };
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
      const onEnabled =
        this.selected >= 0 && !this.rows[this.selected]?.disabled;
      this.highlightBar.gfx.graphics.visible = !this.hidden && onEnabled;
    }
  }

  /** {@link PointerChoiceTarget}: which row (if any) a screen point falls in —
   *  from the same grown rects the rows are drawn at. */
  choiceAtPoint(x: number, y: number): number | undefined {
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]?.rect;
      if (
        r &&
        x >= r.x &&
        x <= r.x + r.width &&
        y >= r.y &&
        y <= r.y + r.height
      )
        return i;
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
    this.selected = clampSelection(position, this.rows.length);
    applyChoiceTint(
      this.rows,
      this.selected,
      this.cfg.choiceColor,
      this.cfg.choiceSelectedColor,
    );
    this.drawHighlight();
  }

  private drawHighlight(): void {
    if (!this.highlightBar || this.selected < 0) return;
    const row = this.rows[this.selected];
    // A disabled row is never highlighted (nav skips it); clear any stale bar.
    if (!row || row.disabled) {
      this.highlightBar.gfx.draw((g) => g.clear());
      return;
    }
    const r = row.rect;
    this.highlightBar.gfx.draw((g) => {
      g.clear();
      g.roundRect(r.x, r.y, r.width, r.height - 1, 3).fill({
        color: this.cfg.highlightColor,
        alpha: 0.3,
      });
    });
  }

  private textOptions(text: string, wrapWidth: number): TextComponentOptions {
    const opts = makeTextOptions(
      this.cfg,
      text,
      this.cfg.choiceSize,
      this.cfg.choiceColor,
      this.cfg.layerText,
    );
    opts.style.wordWrap = true;
    opts.style.wordWrapWidth = wrapWidth;
    return opts;
  }
}
