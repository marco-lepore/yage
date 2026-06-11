/**
 * DialogueTextView — renders one parsed line as a single {@link SplitTextComponent}
 * (the engine wrapper for Pixi `SplitText`/`SplitBitmapText`) on a screen-space
 * layer, revealing it glyph-by-glyph (typewriter), honouring per-run colour/
 * bold/italic/speed and inline `[pause=ms]`, and driving animated effects.
 *
 * Why one split per LINE (not per word): SplitText does its own tokenize /
 * measure / wrap / glyph-split, so we delegate layout to it instead of hand-
 * rolling it. We then reach into the per-glyph `chars` for everything rich:
 *   - reveal   → toggle `chars[i].visible` (no re-layout; split is done once)
 *   - colour   → `chars[i].tint` per run (independent per glyph)
 *   - bold/italic → reassign that glyph's `style` to a baked variant atlas
 *       (the chars SHARE one style object, so we assign a fresh one rather than
 *        mutate — mutating would restyle the whole line)
 *   - effects  → per-glyph `position`/`scale`/`tint` (wave now ripples per letter)
 *
 * Pixi nests the split `root → line → word → char`, so a glyph's position in the
 * split's own space is the sum up its parent chain ({@link localInSplit}).
 *
 * All reveal bookkeeping counts GRAPHEMES (`splitGraphemes` — the same
 * segmentation SplitText uses to make one glyph node per user-perceived
 * character), so emoji / ZWJ sequences / combining marks stay aligned between
 * the cursor, `[pause]` offsets, per-glyph styles, and the rendered glyphs.
 * `SplitText.chars` additionally drops whitespace, but our runs / reveal
 * cursor / `[pause]` offsets count it, so we map "global grapheme index (with
 * spaces) → non-space glyph index" via a prefix table.
 *
 * This file is the only renderer-coupled part of text rendering; it takes the
 * scene + a font/layout config so nothing here is game-specific.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import { splitGraphemes } from "../core/markup.js";
import {
  SplitTextComponent,
  type SplitTextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { Mountable } from "../chrome/DialogueUiAdapter.js";
import type { PresentedLine, TextChannel } from "../core/session.js";
import type { ParsedText, RunStyle } from "../core/types.js";
import { evaluateEffect, effectDrivesTint } from "./textEffects.js";

/** The body-text channel plus the YAGE lifecycle the host drives. */
export interface TextPresenter extends TextChannel, Mountable {}

export interface DialogueTextConfig {
  /** Font size in px. */
  readonly size: number;
  /** Vertical advance between wrapped lines, in px. */
  readonly lineHeight: number;
  /** Colour for runs that don't override it (0xRRGGBB). */
  readonly defaultColor: number;
  /** Base reveal rate (graphemes/second). Scaled by per-run + hold speed. */
  readonly charsPerSec: number;
  /** Render layer name (screen-space). */
  readonly layer: string;
  /** Resting text region (screen px). Bubbles override per line via `setBox`. */
  readonly box?: { readonly x: number; readonly y: number; readonly width: number };
  /** Use a baked bitmap font of this name. Omit for canvas text. */
  readonly bitmapFont?: string;
  /**
   * Baked bold / italic / bold-italic atlases. Currently UNUSED by the renderer:
   * swapping a glyph to another atlas shifts it vertically (each atlas has its own
   * `baseLineOffset`), so bold/italic are synthesised on the regular glyph instead
   * (skew + double-draw). Kept on the config for callers and a possible future
   * crisp-atlas path (which would compensate the baseline delta).
   */
  readonly bitmapFontBold?: string;
  readonly bitmapFontItalic?: string;
  readonly bitmapFontBoldItalic?: string;
  /** Canvas font family (when not bitmap). */
  readonly fontFamily?: string;
  /** Canvas render resolution (when not bitmap; unused by SplitText). */
  readonly resolution?: number;
}

/**
 * Synthesised italic shear (radians, ~12°). We can't swap to the baked italic
 * atlas per glyph — each atlas has its own `baseLineOffset`, so a swapped glyph
 * sits at a different height than the regular run. Shearing the regular glyph in
 * place keeps the baseline. Negative leans the top to the right (forward italic)
 * about the glyph's top-left origin.
 */
const ITALIC_SKEW = -0.21;
/** Faux-bold: horizontal offset (px) of the double-draw overlay glyph. */
const BOLD_OFFSET = 0.6;

/** One per-glyph display object from the split (a `Text` or `BitmapText`). */
type CharNode = SplitTextComponent["chars"][number];

interface CharMeta {
  readonly node: CharNode;
  /** Resting position within the glyph's own parent (word) — effects offset from this. */
  readonly baseX: number;
  readonly baseY: number;
  /** Horizontal position in the split's own space (effect phase input). */
  readonly splitX: number;
  readonly style: RunStyle;
}

interface LineNodes {
  readonly entity: Entity;
  readonly comp: SplitTextComponent;
  readonly chars: CharNode[];
  readonly metas: CharMeta[];
}

export class DialogueTextView implements TextPresenter {
  private scene?: Scene | undefined;
  private line?: LineNodes | undefined;
  private parsed?: ParsedText | undefined;
  private boxX = 0;
  private boxY = 0;
  private wrapWidth = 200;
  /** Top-left the split container sits at (box origin). */
  private layoutOriginX = 0;
  private layoutOriginY = 0;
  /** Optional per-frame origin (a moving NPC's head) for diegetic bubbles. */
  private originProvider?: (() => { x: number; y: number }) | undefined;

  /** `nonSpacePrefix[k]` = count of non-space graphemes among the first `k`. */
  private nonSpacePrefix = new Int32Array(1);
  /** Non-space glyphs currently visible. */
  private shownCount = -1;

  /** Reveal cursor, in graphemes (fractional while typing). */
  private revealed = 0;
  private elapsedMs = 0;
  private pauseTimer = 0;
  private pauseIdx = 0;
  private speedMul = 1;
  private lineSpeed = 1;
  private done = false;
  private completed = false;

  /** Fired once when the whole line finishes revealing. */
  onRevealComplete?: () => void;

  constructor(private readonly cfg: DialogueTextConfig) {
    if (cfg.box) this.setBox(cfg.box.x, cfg.box.y, cfg.box.width);
  }

  /** Attach to a scene (host lifecycle). Must run before the first `present`. */
  mount(scene: Scene): void {
    this.scene = scene;
  }

  /** Top-left of the text region, in screen px, plus the wrap width. */
  setBox(x: number, y: number, width: number): void {
    this.boxX = x;
    this.boxY = y;
    this.wrapWidth = width;
  }

  /**
   * Make the text track a per-frame origin (a diegetic bubble following an
   * NPC). The provider returns the top-left the laid-out box should sit at;
   * pass `undefined` to pin the text (the default box-dialogue behaviour).
   */
  setOrigin(provider: (() => { x: number; y: number }) | undefined): void {
    this.originProvider = provider;
  }

  /** TextChannel entry point: render + reveal a fully-resolved line. */
  present(line: PresentedLine): void {
    this.show(line.text, line.speed);
  }

  /** TextChannel: reveal everything now. */
  completeReveal(): void {
    this.skipToEnd();
  }

  /** TextChannel: true once the line is fully revealed. */
  isRevealComplete(): boolean {
    return this.done;
  }

  /** Hold-to-speed multiplier (1 = normal, e.g. 3 while the skip key is held). */
  setSpeedMultiplier(m: number): void {
    this.speedMul = Math.max(1, m);
  }

  isRevealing(): boolean {
    return !this.done;
  }

  isDone(): boolean {
    return this.done;
  }

  /** Build the split for a parsed line and start revealing. */
  show(parsed: ParsedText, lineSpeed = 1): void {
    this.clearLine();
    this.parsed = parsed;
    this.lineSpeed = lineSpeed > 0 ? lineSpeed : 1;
    this.revealed = 0;
    this.elapsedMs = 0;
    this.pauseTimer = 0;
    this.pauseIdx = 0;
    this.shownCount = -1;
    // A stale hold-to-fast-forward multiplier must not leak into a new line
    // (an active binding re-asserts it next poll anyway).
    this.speedMul = 1;
    this.done = parsed.length === 0;
    this.completed = false;
    if (!this.done) this.buildLine(parsed);
    this.applyReveal();
    this.reposition(); // place immediately (esp. bubble follow) before first update
    if (this.done) this.finish();
  }

  /** Reveal everything immediately (jump-to-end on a click/tap). */
  skipToEnd(): void {
    if (!this.parsed) return;
    this.revealed = this.parsed.length;
    this.pauseTimer = 0;
    this.pauseIdx = this.parsed.pauses.length;
    this.applyReveal();
    this.finish();
  }

  update(dt: number): void {
    if (!this.parsed) return;
    this.elapsedMs += dt;

    if (!this.done) {
      if (this.pauseTimer > 0) {
        this.pauseTimer = Math.max(0, this.pauseTimer - dt);
      } else {
        this.triggerPauseAt(this.revealed);
        if (this.pauseTimer === 0) {
          const rate = this.cfg.charsPerSec * this.speedMul * this.lineSpeed * this.runSpeedAt(this.revealed);
          this.revealed = Math.min(this.parsed.length, this.revealed + (rate * dt) / 1000);
          this.triggerPauseAt(this.revealed);
        }
      }
      this.applyReveal();
      if (this.revealed >= this.parsed.length && this.pauseTimer === 0) {
        this.finish();
      }
    }

    this.reposition();
  }

  clear(): void {
    this.clearLine();
    // Channel-level clear ends the conversation's visuals — also drop the
    // origin closure, which captures the speaking actor's entity and would
    // otherwise keep a despawned NPC reachable until the next present().
    // (Per-line resets must NOT do this: a bubble view sets the next line's
    // origin BEFORE present() reaches show().)
    this.originProvider = undefined;
  }

  /** Per-line teardown (also the first step of `show()`). */
  private clearLine(): void {
    this.line?.entity.destroy(); // destroys the split + glyphs
    this.line = undefined;
    this.parsed = undefined;
    this.shownCount = -1;
    this.done = false;
    this.completed = false;
  }

  /** Permanent teardown. (No measurer nodes to free — SplitText owns layout.) */
  dispose(): void {
    this.clear();
  }

  // ── build ───────────────────────────────────────────────────────────────────

  private buildLine(parsed: ParsedText): void {
    if (!this.scene) return;
    const text = parsed.runs.map((r) => r.text).join("");

    this.layoutOriginX = this.boxX;
    this.layoutOriginY = this.boxY;

    const entity = this.scene.spawn("dlg-line");
    entity.add(new Transform()).setPosition(this.layoutOriginX, this.layoutOriginY);
    const comp = entity.add(new SplitTextComponent(this.lineSplitOptions(text)));
    const chars = comp.chars;
    const root = comp.splitText;

    // One run-style per non-space glyph, in reading order (1:1 with `chars`).
    const styles = this.buildRevealTables(parsed);

    const metas: CharMeta[] = chars.map((node, i) => {
      const style = styles[i] ?? {};
      const sp = localInSplit(node, root);
      const meta: CharMeta = {
        node,
        baseX: node.position.x,
        baseY: node.position.y,
        splitX: sp.x,
        style,
      };
      // Colour rides per-glyph `tint` (base fill is white); independent per glyph.
      node.tint = style.color ?? this.cfg.defaultColor;
      node.visible = false;
      this.applyWeight(node, style);
      return meta;
    });

    this.line = { entity, comp, chars, metas };
  }

  /**
   * One grapheme-segmentation pass per line (build-time only — nothing
   * re-segments per frame), producing both reveal tables:
   *   - `nonSpacePrefix`: grapheme cursor → count of non-space glyphs shown
   *   - returned styles: the run-style for each NON-SPACE glyph, in reading
   *     order (1:1 with SplitText's `chars`, which drops whitespace)
   * Segmenting per run matches how markup.ts counted `length`/`atChar`, so
   * the cursor, pauses, and styles all share one basis.
   */
  private buildRevealTables(parsed: ParsedText): RunStyle[] {
    const styles: RunStyle[] = [];
    const prefix: number[] = [];
    let shown = 0;
    for (const run of parsed.runs) {
      for (const g of splitGraphemes(run.text)) {
        prefix.push(shown);
        if (/\s/.test(g)) continue;
        shown++;
        styles.push(run.style);
      }
    }
    prefix.push(shown);
    this.nonSpacePrefix = Int32Array.from(prefix);
    return styles;
  }

  /**
   * Apply a run's bold/italic to one glyph. On the bitmap path we must NOT swap
   * to the baked variant atlas — each atlas has its own `baseLineOffset`, which
   * lifts/drops a swapped glyph out of line with the regular runs. So we keep the
   * regular-atlas glyph (baseline intact) and synthesise:
   *   - italic → shear it in place (`skew.x`)
   *   - bold   → overlay a 1px-offset copy as a CHILD, so it rides the parent's
   *              reveal/visibility, tint cascade, skew, and per-frame effects for
   *              free (no separate bookkeeping).
   * On the canvas path, real bold/italic of the same family is baseline-safe, so
   * we just set the style flags.
   */
  private applyWeight(node: CharNode, style: RunStyle): void {
    if (this.cfg.bitmapFont) {
      if (style.italic) node.skew.x = ITALIC_SKEW;
      if (style.bold) {
        const Ctor = node.constructor as new (o: { text: string; style: unknown }) => CharNode;
        const dup = new Ctor({ text: (node as unknown as { text: string }).text, style: node.style });
        dup.position.set(BOLD_OFFSET, 0);
        dup.tint = 0xffffff; // the real colour comes from the parent glyph's tint (cascades)
        (node as unknown as { addChild(child: CharNode): void }).addChild(dup);
      }
      return;
    }
    if (style.bold || style.italic) {
      const s: TextStyle = { fontSize: this.cfg.size, fill: 0xffffff, lineHeight: this.cfg.lineHeight };
      if (this.cfg.fontFamily) s.fontFamily = this.cfg.fontFamily;
      if (style.bold) s.fontWeight = "bold";
      if (style.italic) s.fontStyle = "italic";
      node.style = s;
    }
  }

  // ── reveal + effects ─────────────────────────────────────────────────────────

  private applyReveal(): void {
    if (!this.line) return;
    const cursor = clamp(Math.floor(this.revealed), 0, this.nonSpacePrefix.length - 1);
    const shown = this.nonSpacePrefix[cursor]!;
    if (shown === this.shownCount) return;
    this.shownCount = shown;
    const chars = this.line.chars;
    for (let i = 0; i < chars.length; i++) chars[i]!.visible = i < shown;
  }

  /**
   * Per-frame placement: follow a moving origin (bubble mode) by moving the
   * split container's `Transform` — every glyph inherits it — then apply
   * per-glyph animated effects on top, in the glyph's own (parent) space.
   */
  private reposition(): void {
    if (!this.line) return;
    if (this.originProvider) {
      const o = this.originProvider();
      this.line.entity.get(Transform).setPosition(o.x, o.y);
    }
    for (const m of this.line.metas) {
      const effect = m.style.effect;
      if (!effect || m.node.visible === false) continue;
      const out = evaluateEffect(effect, this.elapsedMs, m.splitX);
      m.node.position.set(m.baseX + out.dx, m.baseY + out.dy);
      if (out.scale !== 1) m.node.scale.set(out.scale, out.scale);
      if (effectDrivesTint(effect) && out.tint !== undefined) m.node.tint = out.tint;
    }
  }

  /** Reveal speed multiplier for whichever run the cursor currently sits in. */
  private runSpeedAt(reveal: number): number {
    if (!this.parsed) return 1;
    const cursor = Math.floor(reveal);
    let acc = 0;
    for (const run of this.parsed.runs) {
      if (cursor < acc + run.graphemeCount) return run.style.speed ?? 1;
      acc += run.graphemeCount;
    }
    return 1;
  }

  private triggerPauseAt(reveal: number): void {
    const pauses = this.parsed?.pauses;
    if (!pauses) return;
    while (this.pauseIdx < pauses.length && reveal >= pauses[this.pauseIdx]!.atChar) {
      const pause = pauses[this.pauseIdx]!;
      this.pauseTimer = pause.ms;
      this.pauseIdx++;
      if (this.pauseTimer > 0) {
        // One frame's advance can overshoot the marker — clamp the cursor back
        // to the FIRST armed pause so glyphs past the beat don't pop in early.
        this.revealed = Math.min(this.revealed, pause.atChar);
        return; // hold here this frame
      }
    }
  }

  private finish(): void {
    this.done = true;
    if (this.completed) return;
    this.completed = true;
    this.onRevealComplete?.();
  }

  // ── node construction ─────────────────────────────────────────────────────────

  /** Options for the per-line split: regular atlas, wrap to the box, white fill
   *  (per-glyph `tint` carries the real colour). */
  private lineSplitOptions(text: string): SplitTextComponentOptions {
    const style: TextStyle = {
      fontSize: this.cfg.size,
      fill: 0xffffff,
      wordWrap: true,
      wordWrapWidth: this.wrapWidth,
      lineHeight: this.cfg.lineHeight,
    };
    const font = this.cfg.bitmapFont ?? this.cfg.fontFamily;
    if (font) style.fontFamily = font;
    const base: SplitTextComponentOptions = {
      text,
      style,
      layer: this.cfg.layer,
      visible: true,
    };
    if (this.cfg.bitmapFont) base.bitmap = true;
    return base;
  }
}

/** Sum a glyph's position up its parent chain (char → word → line → root). */
function localInSplit(node: CharNode, root: unknown): { x: number; y: number } {
  let x = 0;
  let y = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let n: any = node;
  while (n && n !== root) {
    x += n.position.x;
    y += n.position.y;
    n = n.parent;
  }
  return { x, y };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
