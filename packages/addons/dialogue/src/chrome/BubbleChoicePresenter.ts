import { ensureDialogueLayer } from "../render/ensureLayer.js";
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
} from "@yagejs/renderer";
import type { ChoiceContext, PresentedChoice } from "../core/session.js";
import type { BubbleLayout } from "../render/BubbleLayout.js";
import type { ChoicePresenter, DiagnosticSink } from "./DialogueUiAdapter.js";
import { makeTextOptions, type FontConfig } from "./textOptions.js";
import {
  applyChoiceTint,
  choiceRowLabel,
  clampSelection,
  firstEnabledIndex,
} from "./choiceRow.js";
import { DEFAULT_CHOICE_GAP } from "../factory/theme.js";

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
  /** Vertical gap (px) between choice rows. Default {@link DEFAULT_CHOICE_GAP}. */
  readonly choiceGap?: number | undefined;
  /** Colour for the optional prompt header rendered inside the panel — the
   *  theme's body `textColor`. */
  readonly textColor: number;
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
}

interface Row {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly disabled: boolean;
}

export class BubbleChoicePresenter implements ChoicePresenter {
  readonly pointerSpace = "world" as const;

  private scene?: Scene | undefined;
  private bg?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private highlightBar?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private prompt?: { entity: Entity; comp: TextComponent } | undefined;
  private rows: Row[] = [];
  private selected = -1;
  /** Master visibility gate — state-preserving hide/show. */
  private hidden = false;

  onChoiceChosen?: (position: number) => void;

  constructor(
    private readonly cfg: BubbleChoiceConfig,
    private readonly layout: BubbleLayout,
  ) {}

  /** Route the missing-actor warning to the engine Logger (the layout owns the
   *  shared anchor resolver). */
  setDiagnostics(warn: DiagnosticSink): void {
    this.layout.setDiagnostics(warn);
  }

  /** This panel is self-contained (own bg + prompt header), so it owns the
   *  prompt — the Session hides the chrome/body prompt for these choices. */
  ownsPrompt(): boolean {
    return true;
  }

  mount(scene: Scene): void {
    ensureDialogueLayer(scene, this.cfg.layer, 0, "world");
    this.scene = scene;
    const bg = scene.spawn("dlg-bchoice-bg");
    bg.add(new Transform()).setPosition(0, 0);
    this.bg = {
      entity: bg,
      gfx: bg.add(new GraphicsComponent({ layer: this.cfg.layer })),
    };
    const hl = scene.spawn("dlg-bchoice-hl");
    hl.add(new Transform()).setPosition(0, 0);
    this.highlightBar = {
      entity: hl,
      gfx: hl.add(new GraphicsComponent({ layer: this.cfg.layer })),
    };
  }

  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void {
    this.clear();
    if (!this.scene) return;
    const c = this.cfg;
    // a missing speaker resolves to the last-known / fallback anchor (with a
    // once-per-speaker warning), never the world origin — via the shared owner.
    const a = this.layout.anchorFor(this.scene, context?.speaker?.id);
    const innerW = c.width - 2 * c.padding; // content column width
    // An in-bubble avatar reserves a portrait column: the panel grows to contain
    // it and the prompt/rows reflow past it, like the say bubble does.
    const inset = this.layout.portraitInset();
    const reserve = inset?.width ?? 0;
    const panelWidth = c.width + reserve;

    // Optional prompt header inside the same panel (one bubble, not two).
    const promptStr =
      context?.prompt && context.prompt.length > 0
        ? context.prompt.runs.map((r) => r.text).join("")
        : "";
    let promptH = 0;
    if (promptStr) {
      const e = this.scene.spawn("dlg-bchoice-prompt");
      e.add(new Transform());
      const comp = e.add(
        new TextComponent(this.textOptions(promptStr, c.textColor, innerW)),
      );
      comp.text.visible = true;
      promptH = Math.ceil(comp.text.height);
      this.prompt = { entity: e, comp };
    }

    const n = choices.length;
    const gap = c.choiceGap ?? DEFAULT_CHOICE_GAP;
    const lineH = c.choiceSize + gap;
    const headH = promptH > 0 ? promptH + gap : 0;
    const contentH = c.padding + headH + n * lineH + c.padding;
    const panelH = Math.max(contentH, (inset?.height ?? 0) + 2 * c.padding);
    const left = a.x - panelWidth / 2;
    const bottom = a.y - c.offsetY;
    const top = bottom - panelH;
    // Content starts past a left-side portrait column; the tail stays under `a.x`.
    const contentX = left + c.padding + (inset?.side === "left" ? reserve : 0);

    this.drawPanel(left, top, panelWidth, panelH, a.x, bottom);
    this.prompt?.entity.get(Transform).setPosition(contentX, top + c.padding);

    const optionsTop = top + c.padding + headH;
    choices.forEach((choice, i) => {
      const rowY = optionsTop + i * lineH;
      const entity = this.scene!.spawn("dlg-bchoice");
      entity.add(new Transform()).setPosition(contentX + 4, rowY);
      const comp = entity.add(
        new TextComponent(
          this.textOptions(choiceRowLabel(choice), c.choiceColor),
        ),
      );
      comp.text.visible = true;
      this.rows.push({
        entity,
        comp,
        x0: contentX,
        x1: contentX + innerW,
        y0: rowY,
        y1: rowY + lineH,
        disabled: choice.disabled ?? false,
      });
    });
    this.highlight(firstEnabledIndex(this.rows));
    this.applyHidden();
    // Commit the panel as the active bubble so an in-bubble avatar centres in it.
    this.layout.setChoicePanelSize({ width: panelWidth, height: panelH });
  }

  /** Show or hide the whole panel without clearing it — state-preserving. */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  /** Render every piece (bg, prompt, rows, highlight) gated by the master.
   *  Disabled rows still show (greyed); only the highlight bar is suppressed. */
  private applyHidden(): void {
    const shown = !this.hidden;
    if (this.bg) this.bg.gfx.graphics.visible = shown && this.rows.length > 0;
    if (this.highlightBar) {
      const onEnabled =
        this.selected >= 0 && !this.rows[this.selected]?.disabled;
      this.highlightBar.gfx.graphics.visible = shown && onEnabled;
    }
    if (this.prompt) this.prompt.comp.text.visible = shown;
    for (const row of this.rows) row.comp.text.visible = shown;
  }

  highlight(position: number): void {
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

  private drawPanel(
    left: number,
    top: number,
    width: number,
    h: number,
    tailX: number,
    bottom: number,
  ): void {
    const c = this.cfg;
    this.bg?.gfx.draw((g) => {
      g.clear();
      g.roundRect(left, top, width, h, c.cornerRadius)
        .fill({ color: c.frameColor, alpha: c.frameAlpha })
        .stroke({ color: c.borderColor, alpha: 1, width: 2 });
      g.poly([
        tailX - c.tail,
        bottom,
        tailX + c.tail,
        bottom,
        tailX,
        bottom + c.tail,
      ]).fill({
        color: c.frameColor,
        alpha: c.frameAlpha,
      });
    });
  }

  private drawHighlight(): void {
    const row = this.rows[this.selected];
    if (!this.highlightBar || !row) return;
    // A disabled row is never highlighted (nav skips it); clear any stale bar.
    if (row.disabled) {
      this.highlightBar.gfx.draw((g) => g.clear());
      return;
    }
    this.highlightBar.gfx.draw((g) => {
      g.clear();
      g.roundRect(row.x0, row.y0, row.x1 - row.x0, row.y1 - row.y0 - 1, 3).fill(
        {
          color: this.cfg.highlightColor,
          alpha: 0.3,
        },
      );
    });
  }

  private textOptions(
    text: string,
    color: number,
    wrapWidth?: number,
  ): TextComponentOptions {
    const opts = makeTextOptions(
      this.cfg,
      text,
      this.cfg.choiceSize,
      color,
      this.cfg.layer,
    );
    if (wrapWidth != null) {
      opts.style.wordWrap = true;
      opts.style.wordWrapWidth = wrapWidth;
    }
    return opts;
  }
}
