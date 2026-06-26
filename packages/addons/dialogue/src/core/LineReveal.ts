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

import type { MarkerToken, ParsedText } from "./types.js";

/**
 * A reveal-time beat the clock emits as the cursor advances: a per-grapheme
 * `tick` (one per revealed grapheme — raw, including whitespace; the host
 * filters) and a `marker` when the cursor reaches a {@link MarkerToken}'s
 * offset. `viaSkip` is true when the marker was drained by {@link
 * LineReveal.complete} (a skip / fast-forward) rather than reached during normal
 * typing, so a host can suppress a loud one-shot that only fired because of a
 * skip click. Ticks are NOT emitted on a skip (replaying dozens at once would
 * machine-gun).
 */
export type RevealBeat =
  | { readonly kind: "tick"; readonly index: number }
  | { readonly kind: "marker"; readonly marker: MarkerToken; readonly viaSkip: boolean };

export class LineReveal {
  private parsed: ParsedText | undefined;
  /** Reveal cursor, in graphemes (fractional while typing). */
  private cursor = 0;
  private pauseTimer = 0;
  private pauseIdx = 0;
  /** Next un-fired marker in `parsed.markers` (drains in char order). */
  private markerIdx = 0;
  /** Graphemes already ticked (so each grapheme ticks exactly once). */
  private tickCount = 0;
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
  /** Per-grapheme ticks + inline markers, wired by the consuming view to the
   *  session-owned beat listener (like {@link onComplete}, never a public field). */
  private onBeat: ((beat: RevealBeat) => void) | undefined;

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
   * Register the reveal-beat listener — per-grapheme ticks and inline markers,
   * in char order, the moment the cursor reaches each. Session-owned (set once,
   * like {@link setCompletionListener}); pass `undefined` to clear.
   */
  setBeatListener(listener: ((beat: RevealBeat) => void) | undefined): void {
    this.onBeat = listener;
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
    this.markerIdx = 0;
    this.tickCount = 0;
    this.speedMul = 1;
    this.done = parsed.length === 0;
    this.completed = false;
    // Fire any offset-0 markers synchronously (a marker-only / length-0 line, or
    // a line that opens with a marker) — the beat listener is session-owned and
    // wired before begin(), like the completion listener. Markers come before the
    // empty-line completion: they're part of the line, completion ends it.
    this.drainMarkers();
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
        // Clamp back to any pause the advance overshot FIRST, then emit a tick
        // per actually-revealed grapheme and drain markers up to the (clamped)
        // cursor. Draining AFTER the clamp is what makes a marker co-located with
        // a [pause] fire on hold-ENTRY: the cursor sits exactly at the offset, so
        // the marker drains this frame, while glyphs past the beat don't tick
        // early. No advance happens during a hold, so no marker becomes eligible
        // until it ends — this (with begin()/complete()) is the only drain needed.
        this.triggerPauseAt(this.cursor);
        this.emitTicks();
        this.drainMarkers();
      }
    }
    if (this.cursor >= parsed.length && this.pauseTimer === 0) this.finish();
  }

  /** Reveal everything now (skip-to-end on a click/tap). Drains any not-yet-fired
   *  markers in order so their consequences still happen (`viaSkip=true` lets a
   *  host suppress a loud one-shot) but DISCARDS pending ticks — replaying dozens
   *  of typewriter blips at once would machine-gun. Fires completion. */
  complete(): void {
    const parsed = this.parsed;
    if (!parsed) return;
    this.cursor = parsed.length;
    this.pauseTimer = 0;
    this.pauseIdx = parsed.pauses.length;
    this.drainMarkers(true);
    this.tickCount = parsed.length; // swallow the pending ticks
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

  /** Fire markers whose offset the cursor has reached, in char order. `viaSkip`
   *  tags the ones drained by {@link complete}. Monotonic `markerIdx` → each
   *  fires exactly once. */
  private drainMarkers(viaSkip = false): void {
    const markers = this.parsed?.markers;
    if (!markers) return;
    while (this.markerIdx < markers.length && this.cursor >= markers[this.markerIdx]!.atChar) {
      const marker = markers[this.markerIdx]!;
      this.markerIdx++;
      this.onBeat?.({ kind: "marker", marker, viaSkip });
    }
  }

  /** Emit a `tick` for each grapheme newly revealed since the last call (raw —
   *  no whitespace test; the host filters). Multiple in order on a large-dt
   *  frame; `tickCount` is monotonic so none repeat. */
  private emitTicks(): void {
    const next = Math.floor(this.cursor);
    for (let i = this.tickCount; i < next; i++) {
      this.onBeat?.({ kind: "tick", index: i });
    }
    this.tickCount = next;
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
