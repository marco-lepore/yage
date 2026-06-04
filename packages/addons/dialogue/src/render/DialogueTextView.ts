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
 *   - terms    → read exact glyph positions to capture clickable hit-boxes
 *
 * Pixi nests the split `root → line → word → char`, so a glyph's position in the
 * split's own space is the sum up its parent chain ({@link localInSplit}).
 *
 * `SplitText.chars` drops whitespace, but our runs / reveal cursor / `[pause]`
 * offsets count it, so we map "global char index (with spaces) → non-space glyph
 * index" via a prefix table.
 *
 * This file is the only renderer-coupled part of text rendering; it takes the
 * scene + a font/layout config so nothing here is game-specific.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  SplitTextComponent,
  type SplitTextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { Mountable } from "../chrome/DialogueUiAdapter.js";
import type { PresentedLine, TextChannel } from "../core/session.js";
import type { ParsedText, RunStyle } from "../core/types.js";
import { evaluateEffect, effectDrivesTint } from "./textEffects.js";

/**
 * The body-text channel plus the YAGE lifecycle the host drives. Also exposes
 * the glossary-term pointer seam ({@link termAtPoint}): a pointer binding (see
 * {@link PointerTermTarget}) hit-tests a screen/world point against the line's
 * `[term=…]` spans, highlights the hovered one ({@link setHoveredTerm}), and
 * surfaces activations to the host.
 */
export interface TextPresenter extends TextChannel, Mountable {
  /** The glossary term under a point, or undefined. Coords are in
   *  {@link pointerSpace}. Omit to opt out of term hit-testing. */
  termAtPoint?(x: number, y: number): string | undefined;
  /** Coordinate space {@link termAtPoint} expects. Default "screen". */
  readonly pointerSpace?: "screen" | "world";
  /** Highlight the term span under the pointer (id) or clear it (undefined). A
   *  pointer binding drives this on hover so terms read as interactable. */
  setHoveredTerm?(id: string | undefined): void;
}

/**
 * A presenter that can resolve a pointer point to a glossary term — lets a
 * pointer binding hover/tap term spans without owning their geometry. Mirrors
 * `PointerChoiceTarget` (input). Coords are in `pointerSpace` ("screen" default;
 * a bubble/world view sets "world"). The game owns the tooltip; the binding only
 * forwards the activated id (plus, optionally, the pointer position) to the host.
 */
export interface PointerTermTarget {
  /** The glossary term under this point, or undefined. Omit for no hit-testing. */
  termAtPoint?(x: number, y: number): string | undefined;
  readonly pointerSpace?: "screen" | "world";
}

export interface DialogueTextConfig {
  /** Font size in px. */
  readonly size: number;
  /** Vertical advance between wrapped lines, in px. */
  readonly lineHeight: number;
  /** Colour for runs that don't override it (0xRRGGBB). */
  readonly defaultColor: number;
  /** Base reveal rate (characters/second). Scaled by per-run + hold speed. */
  readonly charsPerSec: number;
  /** Render layer name (screen-space). */
  readonly layer: string;
  /** Resting text region (screen px). Bubbles override per line via `setBox`. */
  readonly box?: { readonly x: number; readonly y: number; readonly width: number };
  /** Highlight colour for `[term=…]` spans (0xRRGGBB). Defaults to a soft blue. */
  readonly termColor?: number;
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

/** Highlight colour for `[term=…]` spans when the theme doesn't override it. */
const DEFAULT_TERM_COLOR = 0x7ec8ff;
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
  /** Position in the split's own space (for effect phase + term geometry). */
  readonly splitX: number;
  readonly splitY: number;
  readonly width: number;
  readonly style: RunStyle;
}

interface TermBox {
  readonly term: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A term run in SPLIT-relative coords, for drawing the underline + restyling
 *  its glyphs on hover (the line entity's Transform carries it into world/screen
 *  space, so this follows a moving bubble for free). */
interface TermSpan {
  readonly term: string;
  /** Underline extent + baseline, split-relative. */
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  /** Glyph index range into `chars`/`metas` (inclusive). */
  readonly first: number;
  readonly last: number;
}

interface LineNodes {
  readonly entity: Entity;
  readonly comp: SplitTextComponent;
  readonly chars: CharNode[];
  readonly metas: CharMeta[];
  readonly terms: TermBox[];
  readonly spans: TermSpan[];
  readonly underline?: GraphicsComponent | undefined;
}

export class DialogueTextView implements TextPresenter {
  /** The view's term hit-boxes are captured in the box's resting coords; a
   *  bubble subclass that follows a world origin can override this to "world". */
  readonly pointerSpace: "screen" | "world" = "screen";

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

  /** `nonSpacePrefix[k]` = count of non-space chars in `text.slice(0, k)`. */
  private nonSpacePrefix = new Int32Array(1);
  private shownCount = -1;

  private revealed = 0;
  private elapsedMs = 0;
  private pauseTimer = 0;
  private pauseIdx = 0;
  private speedMul = 1;
  private lineSpeed = 1;
  private done = false;
  private completed = false;

  private readonly termColor: number;
  /** Brighter tint for the hovered term (glyphs + underline). */
  private readonly termHoverColor: number;
  /** Term id currently highlighted by a hovering pointer, if any. */
  private hoveredTerm?: string | undefined;

  /** Fired once when the whole line finishes revealing. */
  onRevealComplete?: () => void;

  constructor(private readonly cfg: DialogueTextConfig) {
    this.termColor = cfg.termColor ?? DEFAULT_TERM_COLOR;
    this.termHoverColor = lightenToward(this.termColor, 0.45);
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
    this.clear();
    this.parsed = parsed;
    this.lineSpeed = lineSpeed > 0 ? lineSpeed : 1;
    this.revealed = 0;
    this.elapsedMs = 0;
    this.pauseTimer = 0;
    this.pauseIdx = 0;
    this.shownCount = -1;
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
    this.line?.entity.destroy(); // destroys the split + underline + glyphs
    this.line = undefined;
    this.parsed = undefined;
    this.shownCount = -1;
    this.done = false;
    this.completed = false;
    this.hoveredTerm = undefined; // each new line starts un-hovered
  }

  /** Permanent teardown. (No measurer nodes to free — SplitText owns layout.) */
  dispose(): void {
    this.clear();
  }

  // ── build ───────────────────────────────────────────────────────────────────

  private buildLine(parsed: ParsedText): void {
    if (!this.scene) return;
    const text = parsed.runs.map((r) => r.text).join("");
    this.buildNonSpacePrefix(text);

    this.layoutOriginX = this.boxX;
    this.layoutOriginY = this.boxY;

    const entity = this.scene.spawn("dlg-line");
    entity.add(new Transform()).setPosition(this.layoutOriginX, this.layoutOriginY);
    const comp = entity.add(new SplitTextComponent(this.lineSplitOptions(text)));
    const chars = comp.chars;
    const root = comp.splitText;

    // One run-style per non-space glyph, in reading order (1:1 with `chars`).
    const styles = this.charStyles(parsed);

    const metas: CharMeta[] = chars.map((node, i) => {
      const style = styles[i] ?? {};
      const sp = localInSplit(node, root);
      // Capture geometry from the bare glyph BEFORE styling (a bold overlay would
      // otherwise inflate `node.width`, throwing off term spans).
      const meta: CharMeta = {
        node,
        baseX: node.position.x,
        baseY: node.position.y,
        splitX: sp.x,
        splitY: sp.y,
        width: node.width,
        style,
      };
      // Colour rides per-glyph `tint` (base fill is white); independent per glyph.
      const tint: number = style.term ? this.termColor : style.color ?? this.cfg.defaultColor;
      node.tint = tint;
      node.visible = false;
      this.applyWeight(node, style);
      return meta;
    });

    const { boxes, spans } = this.buildTermData(parsed, metas);
    // One Graphics on the same entity draws the term underlines; it inherits the
    // line's Transform (reposition()), so it follows a moving bubble for free.
    const underline =
      spans.length > 0
        ? entity.add(new GraphicsComponent({ layer: this.cfg.layer }))
        : undefined;
    this.line = { entity, comp, chars, metas, terms: boxes, spans, underline };
    this.drawUnderlines();
  }

  /** Run-style for each NON-SPACE glyph, in reading order (matches `chars`). */
  private charStyles(parsed: ParsedText): RunStyle[] {
    const out: RunStyle[] = [];
    for (const run of parsed.runs) {
      for (const ch of run.text) {
        if (/\s/.test(ch)) continue;
        out.push(run.style);
      }
    }
    return out;
  }

  private buildNonSpacePrefix(text: string): void {
    const p = new Int32Array(text.length + 1);
    let c = 0;
    for (let i = 0; i < text.length; i++) {
      p[i] = c;
      if (!/\s/.test(text[i]!)) c++;
    }
    p[text.length] = c;
    this.nonSpacePrefix = p;
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

  /**
   * Per term-run, the absolute hit-box ({@link termAtPoint}) AND a split-relative
   * span (underline geometry + glyph index range, for hover restyle) — derived
   * from the same single pass so they can't drift.
   */
  private buildTermData(
    parsed: ParsedText,
    metas: CharMeta[],
  ): { boxes: TermBox[]; spans: TermSpan[] } {
    const boxes: TermBox[] = [];
    const spans: TermSpan[] = [];
    let ns = 0;
    for (const run of parsed.runs) {
      const runNonSpace = [...run.text].filter((c) => !/\s/.test(c)).length;
      if (run.style.term && runNonSpace > 0) {
        const first = ns;
        const last = ns + runNonSpace - 1;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = first; i <= last; i++) {
          const m = metas[i]!;
          minX = Math.min(minX, m.splitX);
          maxX = Math.max(maxX, m.splitX + m.width);
          minY = Math.min(minY, m.splitY);
          maxY = Math.max(maxY, m.splitY + this.cfg.size);
        }
        boxes.push({
          term: run.style.term,
          x0: this.layoutOriginX + minX,
          y0: this.layoutOriginY + minY,
          x1: this.layoutOriginX + maxX,
          y1: this.layoutOriginY + maxY,
        });
        spans.push({
          term: run.style.term,
          x0: minX,
          x1: maxX,
          y: maxY,
          first,
          last,
        });
      }
      ns += runNonSpace;
    }
    return { boxes, spans };
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
   * The glossary term under a point, or undefined — the seam a pointer binding
   * (see {@link PointerTermTarget}) drives on hover/tap to highlight + surface a
   * term. Box-mode geometry: term boxes are captured in the line's resting
   * coords. A world-anchored subclass repositions via the origin provider and
   * overrides {@link pointerSpace} accordingly.
   */
  termAtPoint(x: number, y: number): string | undefined {
    if (!this.line) return undefined;
    for (const t of this.line.terms) {
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) return t.term;
    }
    return undefined;
  }

  /** Highlight the hovered term (brighter glyphs + underline) or clear it. */
  setHoveredTerm(id: string | undefined): void {
    if (id === this.hoveredTerm) return;
    this.hoveredTerm = id;
    this.applyTermHover();
    this.drawUnderlines();
  }

  /** Draw each term's underline (split-relative); the hovered one is brighter +
   *  thicker. An underline (not a fill) sits below the glyphs, so z-order vs the
   *  split is a non-issue even on the bubble's single shared layer. */
  private drawUnderlines(): void {
    const line = this.line;
    if (!line?.underline) return;
    const hovered = this.hoveredTerm;
    line.underline.graphics.clear(); // re-drawn on hover — don't accumulate
    line.underline.draw((g) => {
      for (const s of line.spans) {
        const on = s.term === hovered;
        g.rect(s.x0, s.y + 1, Math.max(0, s.x1 - s.x0), on ? 2 : 1).fill({
          color: on ? this.termHoverColor : this.termColor,
          alpha: on ? 1 : 0.7,
        });
      }
    });
  }

  /** Brighten the hovered term's glyph tint. Skips glyphs whose effect already
   *  rewrites tint every frame (reposition()), to avoid fighting it. */
  private applyTermHover(): void {
    const line = this.line;
    if (!line) return;
    for (const s of line.spans) {
      const tint =
        s.term === this.hoveredTerm ? this.termHoverColor : this.termColor;
      for (let i = s.first; i <= s.last; i++) {
        const m = line.metas[i];
        if (!m || (m.style.effect && effectDrivesTint(m.style.effect))) continue;
        m.node.tint = tint;
      }
    }
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
      if (cursor < acc + run.text.length) return run.style.speed ?? 1;
      acc += run.text.length;
    }
    return 1;
  }

  private triggerPauseAt(reveal: number): void {
    const pauses = this.parsed?.pauses;
    if (!pauses) return;
    while (this.pauseIdx < pauses.length && reveal >= pauses[this.pauseIdx]!.atChar) {
      this.pauseTimer = pauses[this.pauseIdx]!.ms;
      this.pauseIdx++;
      if (this.pauseTimer > 0) return; // hold here this frame
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

/** Mix an 0xRRGGBB colour toward white by `t` (0…1) — for the hover highlight. */
function lightenToward(color: number, t: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lr = Math.round(r + (255 - r) * t);
  const lg = Math.round(g + (255 - g) * t);
  const lb = Math.round(b + (255 - b) * t);
  return (lr << 16) | (lg << 8) | lb;
}
