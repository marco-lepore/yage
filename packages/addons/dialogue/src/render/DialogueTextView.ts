/**
 * DialogueTextView — renders one parsed line as a single {@link SplitTextComponent}
 * (the engine wrapper for Pixi `SplitText`/`SplitBitmapText`) on a screen-space
 * layer, revealing it glyph-by-glyph (typewriter), honouring per-run colour/
 * bold/italic, and driving animated effects.
 *
 * Reveal *timing* — the grapheme cursor, inline `[pause=ms/]`, per-run/line
 * `[speed]`, the hold multiplier, and fired-once completion — is owned by the
 * headless {@link LineReveal} clock (pixi-free, reusable by a DOM presenter).
 * This view keeps only the pixi-`SplitText` concerns: mapping the clock's
 * grapheme cursor onto glyph visibility and fanning per-glyph styles out.
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

import { MathUtils, Transform, type Entity, type Scene } from "@yagejs/core";
import { splitGraphemes } from "../core/markup.js";
import { LineReveal, type RevealBeat } from "../core/LineReveal.js";
import {
  SplitTextComponent,
  type DisplayContainer,
  type SplitTextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";
import type { FontConfig } from "../chrome/textOptions.js";
import type { PresentedLine } from "../core/session.js";
import type { ParsedText, RunStyle } from "../core/types.js";
import { evaluateEffect, effectDrivesTint, type EffectOutput } from "./textEffects.js";

export interface DialogueTextConfig extends FontConfig {
  /** Font size in px. */
  readonly textSize: number;
  /** Vertical advance between wrapped lines, in px. */
  readonly lineHeight: number;
  /** Colour for runs that don't override it (0xRRGGBB). */
  readonly textColor: number;
  /** Base reveal rate (graphemes/second). Scaled by per-run + hold speed. */
  readonly charsPerSec: number;
  /** Render layer name (screen-space). */
  readonly layer: string;
  /** Resting text region (screen px). Bubbles override per line via `setBox`. */
  readonly box?: { readonly x: number; readonly y: number; readonly width: number };
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

/** Per-frame animation bookkeeping for one EFFECT-BEARING glyph (static glyphs
 *  need none — their tint/weight are applied once at build). */
interface EffectMeta {
  readonly node: CharNode;
  readonly effect: string;
  /** Resting position within the glyph's own parent (word) — effects offset from this. */
  readonly baseX: number;
  readonly baseY: number;
  /** Horizontal position in the split's own space (effect phase input). */
  readonly splitX: number;
}

interface LineNodes {
  readonly entity: Entity;
  readonly comp: SplitTextComponent;
  readonly chars: CharNode[];
  readonly effectMetas: EffectMeta[];
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

  /** Headless reveal clock — owns the grapheme cursor, `[pause]` arming, hold +
   *  per-line + per-run speed, and the fired-once completion. This view keeps
   *  only the pixi-`SplitText` concerns (glyph prefix mapping + per-glyph style
   *  fan-out) and maps the clock's grapheme cursor onto them. */
  private readonly reveal: LineReveal;
  /** Elapsed ms for animated per-glyph EFFECTS (wave/shake/…) — distinct from
   *  the reveal cursor, which LineReveal owns. */
  private elapsedMs = 0;
  /** Scratch for {@link evaluateEffect} — one object reused across all glyphs. */
  private readonly effectScratch: EffectOutput = { dx: 0, dy: 0, scale: 1, tint: undefined };

  /** Reveal-completed listener, registered by the Session through
   *  {@link setRevealListener} (a private seam, not a public field, so a
   *  game can't clobber the session's wiring). */
  private revealListener?: (() => void) | undefined;
  /** Reveal-beat listener (ticks + inline markers), registered by the Session
   *  through {@link setBeatListener} — same private-seam discipline. */
  private beatListener?: ((beat: RevealBeat) => void) | undefined;
  /** Master visibility gate ({@link setVisible}); hides the line WITHOUT
   *  clearing it, so a hide/show round-trip resumes mid-typewriter. */
  private hidden = false;

  constructor(private readonly cfg: DialogueTextConfig) {
    this.reveal = new LineReveal(cfg.charsPerSec);
    // The reveal clock reports completion + beats through the view's
    // session-owned listeners — never public fields a game could clobber.
    this.reveal.setCompletionListener(() => this.revealListener?.());
    this.reveal.setBeatListener((beat) => this.beatListener?.(beat));
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
    return this.reveal.isComplete();
  }

  /** Hold-to-speed multiplier (1 = normal, e.g. 3 while the skip key is held). */
  setSpeedMultiplier(m: number): void {
    this.reveal.setSpeedMultiplier(m);
  }

  isRevealing(): boolean {
    return this.reveal.isRevealing();
  }

  /**
   * Show or hide the body text WITHOUT disturbing reveal progress. Toggles
   * the laid-out split container's visibility; the per-glyph reveal cursor,
   * timers, and styling are untouched, so a cutscene can hide mid-typewriter and
   * show again to resume exactly where it left off.
   */
  setVisible(visible: boolean): void {
    this.hidden = !visible;
    this.applyHidden();
  }

  /** Register the reveal-completed listener. Session-owned (a private seam, not a
   *  public field a game could clobber); pass `undefined` to clear. */
  setRevealListener(listener: (() => void) | undefined): void {
    this.revealListener = listener;
  }

  /** Register the reveal-beat listener (ticks + inline markers). Session-owned;
   *  pass `undefined` to clear. The clock emits in char order as glyphs reveal. */
  setBeatListener(listener: ((beat: RevealBeat) => void) | undefined): void {
    this.beatListener = listener;
  }

  /** Build the split for a parsed line and start revealing. */
  show(parsed: ParsedText, lineSpeed = 1): void {
    this.clearLine();
    this.parsed = parsed;
    this.elapsedMs = 0;
    this.shownCount = -1;
    if (parsed.length > 0) this.buildLine(parsed);
    // Start the reveal clock — an empty line completes (and fires the
    // session-owned listener) synchronously here, the no-typewriter contract.
    // The glyph tree is already built above, so completion observes a
    // consistent view.
    this.reveal.begin(parsed, lineSpeed);
    this.applyReveal();
    this.reposition(); // place immediately (esp. bubble follow) before first update
    this.applyHidden(); // a new line inherits the current hide state
  }

  /** Apply the master visibility gate to the laid-out line — toggles the split
   *  container, leaving the per-glyph reveal state intact. */
  private applyHidden(): void {
    if (this.line) this.line.comp.splitText.visible = !this.hidden;
  }

  /** Reveal everything immediately (jump-to-end on a click/tap). */
  skipToEnd(): void {
    this.reveal.complete();
    this.applyReveal();
  }

  update(dt: number): void {
    if (!this.parsed) return;
    this.elapsedMs += dt;
    // Advance the reveal cursor (fires completion exactly once when it lands),
    // then map the new cursor onto glyph visibility. applyReveal is idempotent,
    // so calling it after the line is done costs nothing.
    this.reveal.update(dt);
    this.applyReveal();
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

  /** Per-line teardown (also the first step of `show()`). The reveal clock is
   *  re-armed by the next `show()` via {@link LineReveal.begin}, so there is no
   *  reveal state to reset here. */
  private clearLine(): void {
    this.line?.entity.destroy(); // destroys the split + glyphs
    this.line = undefined;
    this.parsed = undefined;
    this.shownCount = -1;
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

    // Static styling is applied once here; only effect-bearing glyphs need
    // per-frame bookkeeping, so reposition() never touches the rest.
    const effectMetas: EffectMeta[] = [];
    chars.forEach((node, i) => {
      const style = styles[i] ?? {};
      // Colour rides per-glyph `tint` (base fill is white); independent per glyph.
      node.tint = style.color ?? this.cfg.textColor;
      node.visible = false;
      this.applyWeight(node, style);
      if (style.effect) {
        effectMetas.push({
          node,
          effect: style.effect,
          baseX: node.position.x,
          baseY: node.position.y,
          splitX: localInSplit(node, root).x,
        });
      }
    });

    this.line = { entity, comp, chars, effectMetas };
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
        // Same class as the glyph (Text or BitmapText) without importing pixi
        // values — `constructor` is typed `Function`, so one cast is needed.
        const Ctor = node.constructor as new (o: {
          text: string;
          style: CharNode["style"];
        }) => CharNode;
        const dup = new Ctor({ text: node.text, style: node.style });
        dup.position.set(BOLD_OFFSET, 0);
        dup.tint = 0xffffff; // the real colour comes from the parent glyph's tint (cascades)
        node.addChild(dup);
      }
      return;
    }
    if (style.bold || style.italic) {
      const s: TextStyle = { fontSize: this.cfg.textSize, fill: 0xffffff, lineHeight: this.cfg.lineHeight };
      if (this.cfg.fontFamily) s.fontFamily = this.cfg.fontFamily;
      if (style.bold) s.fontWeight = "bold";
      if (style.italic) s.fontStyle = "italic";
      node.style = s;
    }
  }

  // ── reveal + effects ─────────────────────────────────────────────────────────

  private applyReveal(): void {
    if (!this.line) return;
    const cursor = MathUtils.clamp(Math.floor(this.reveal.revealed), 0, this.nonSpacePrefix.length - 1);
    const shown = this.nonSpacePrefix[cursor]!;
    if (shown === this.shownCount) return;
    // Toggle only the glyphs whose visibility changed since the last step —
    // buildLine hides every glyph, so the initial -1 state equals "0 shown".
    const prev = this.shownCount < 0 ? 0 : this.shownCount;
    const chars = this.line.chars;
    const lo = Math.min(prev, shown);
    const hi = Math.max(prev, shown);
    for (let i = lo; i < hi; i++) chars[i]!.visible = i < shown;
    this.shownCount = shown;
  }

  /**
   * Per-frame placement: follow a moving origin (bubble mode) by moving the
   * split container's `Transform` — every glyph inherits it — then apply
   * per-glyph animated effects on top, in the glyph's own (parent) space.
   * Only effect-bearing glyphs are walked; a static pinned line costs nothing.
   */
  private reposition(): void {
    const line = this.line;
    if (!line) return;
    if (this.originProvider) {
      const o = this.originProvider();
      line.entity.get(Transform).setPosition(o.x, o.y);
    }
    for (const m of line.effectMetas) {
      if (!m.node.visible) continue;
      const out = evaluateEffect(m.effect, this.elapsedMs, m.splitX, this.effectScratch);
      m.node.position.set(m.baseX + out.dx, m.baseY + out.dy);
      if (out.scale !== 1) m.node.scale.set(out.scale, out.scale);
      if (effectDrivesTint(m.effect) && out.tint !== undefined) m.node.tint = out.tint;
    }
  }

  // ── node construction ─────────────────────────────────────────────────────────

  /** Options for the per-line split: regular atlas, wrap to the box, white fill
   *  (per-glyph `tint` carries the real colour). */
  private lineSplitOptions(text: string): SplitTextComponentOptions {
    const style: TextStyle = {
      fontSize: this.cfg.textSize,
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
  let n: DisplayContainer | undefined = node;
  while (n && n !== root) {
    x += n.position.x;
    y += n.position.y;
    n = n.parent ?? undefined;
  }
  return { x, y };
}
