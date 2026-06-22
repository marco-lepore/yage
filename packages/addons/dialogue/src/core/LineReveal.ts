/**
 * LineReveal — the headless typewriter clock. Given a {@link ParsedText} (markup
 * already parsed into runs + `[pause]` tokens), a base `charsPerSec`, a per-line
 * speed multiplier, and `update(dt)` ticks, it advances a reveal cursor in
 * **graphemes** (the unit `markup.ts` counts and the renderer splits glyphs by),
 * arms inline pauses, applies per-run `[speed]`, and fires completion **exactly
 * once** per line.
 *
 * It is renderer-free on purpose: a DOM-overlay or per-word presenter can drive
 * the same reveal logic and map the grapheme cursor onto its own rendering,
 * without pulling the renderer in. The default `DialogueTextView` consumes it
 * and keeps only the SplitText concerns — the code-unit→glyph prefix mapping and
 * per-glyph style fan-out — which LineReveal deliberately does NOT own.
 *
 * What it owns: the reveal cursor, `ParsedText.pauses` arming/state, the hold-to-
 * fast-forward multiplier, the per-line and per-run (`RunStyle.speed`) speeds,
 * and the fired-once completion. What it does NOT own: anything that touches a
 * glyph, a texture, or a layout. Counts are graphemes throughout — it reads the
 * pre-computed grapheme counts off `ParsedText` (`length`, `TextRun.graphemeCount`,
 * `PauseToken.atChar`) and never re-segments.
 */

import type { ParsedText } from "./types.js";

export class LineReveal {
  private parsed: ParsedText | undefined;
  /** Reveal cursor, in graphemes (fractional while typing). */
  private cursor = 0;
  private pauseTimer = 0;
  private pauseIdx = 0;
  /** Hold-to-fast-forward rate (1 = normal). */
  private speedMul = 1;
  /** Per-line `say.speed` multiplier (1 = base). */
  private lineSpeed = 1;
  private done = false;
  private completed = false;
  /** Fired exactly once when the line finishes revealing. The consuming view
   *  wires this to the session-owned reveal listener (NOT a public mutable
   *  field a game could clobber). */
  private onComplete: (() => void) | undefined;

  /** @param charsPerSec base reveal rate (graphemes/second), scaled by the
   *   hold, per-line, and per-run multipliers. */
  constructor(private readonly charsPerSec: number) {}

  /**
   * Register the completion listener — fires once per line, the moment the
   * cursor reaches the end (or synchronously from {@link begin} for an empty
   * line, or from {@link complete}). Pass `undefined` to clear.
   */
  setCompletionListener(listener: (() => void) | undefined): void {
    this.onComplete = listener;
  }

  /**
   * Start revealing a new line. Resets the cursor, pauses, and the hold
   * multiplier (a stale fast-forward must not leak into the next line — an
   * active binding re-asserts it on its next poll). An **empty** line
   * (`parsed.length === 0`) is complete immediately and fires the completion
   * listener synchronously, matching the no-typewriter contract.
   */
  begin(parsed: ParsedText, lineSpeed = 1): void {
    this.parsed = parsed;
    this.lineSpeed = lineSpeed > 0 ? lineSpeed : 1;
    this.cursor = 0;
    this.pauseTimer = 0;
    this.pauseIdx = 0;
    this.speedMul = 1;
    this.done = parsed.length === 0;
    this.completed = false;
    if (this.done) this.finish();
  }

  /** Hold-to-fast-forward multiplier (1 = normal, e.g. 4 while skip is held). */
  setSpeedMultiplier(m: number): void {
    this.speedMul = Math.max(1, m);
  }

  /** Advance the reveal cursor by `dt` (ms). Honours armed pauses and per-run
   *  speed; fires completion once the cursor reaches the end. No-op after the
   *  line is done or before the first {@link begin}. */
  update(dt: number): void {
    const parsed = this.parsed;
    if (!parsed || this.done) return;
    if (this.pauseTimer > 0) {
      this.pauseTimer = Math.max(0, this.pauseTimer - dt);
    } else {
      this.triggerPauseAt(this.cursor);
      if (this.pauseTimer === 0) {
        const rate =
          this.charsPerSec * this.speedMul * this.lineSpeed * this.runSpeedAt(this.cursor);
        this.cursor = Math.min(parsed.length, this.cursor + (rate * dt) / 1000);
        this.triggerPauseAt(this.cursor);
      }
    }
    if (this.cursor >= parsed.length && this.pauseTimer === 0) this.finish();
  }

  /** Reveal everything now (skip-to-end on a click/tap). Fires completion. */
  complete(): void {
    const parsed = this.parsed;
    if (!parsed) return;
    this.cursor = parsed.length;
    this.pauseTimer = 0;
    this.pauseIdx = parsed.pauses.length;
    this.finish();
  }

  /** Revealed grapheme count (fractional while typing). The view floors this to
   *  map onto its glyph prefix table. */
  get revealed(): number {
    return this.cursor;
  }

  /** True once the line is fully revealed (also true for an empty line). */
  isComplete(): boolean {
    return this.done;
  }

  /** True while glyphs are still appearing. */
  isRevealing(): boolean {
    return !this.done;
  }

  private finish(): void {
    this.done = true;
    if (this.completed) return;
    this.completed = true;
    this.onComplete?.();
  }

  /** Reveal speed multiplier for whichever run the cursor currently sits in. */
  private runSpeedAt(reveal: number): number {
    const parsed = this.parsed;
    if (!parsed) return 1;
    const at = Math.floor(reveal);
    let acc = 0;
    for (const run of parsed.runs) {
      if (at < acc + run.graphemeCount) return run.style.speed ?? 1;
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
        this.cursor = Math.min(this.cursor, pause.atChar);
        return; // hold here this frame
      }
    }
  }
}
