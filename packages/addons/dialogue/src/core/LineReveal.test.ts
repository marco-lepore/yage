import { describe, expect, it } from "vitest";

import { parseMarkup } from "./markup.js";
import { LineReveal, type RevealBeat } from "./LineReveal.js";

/**
 * LineReveal is the headless reveal clock — these tests drive it with NO
 * renderer at all (the proof a DOM/per-word presenter can reuse the timing).
 * The cursor, pause arming, per-run speed, and fired-once completion are all
 * exercised in graphemes.
 */

/** A reveal clock + a counter for its completion firings. */
function clock(charsPerSec: number): { reveal: LineReveal; completed: () => number } {
  const reveal = new LineReveal(charsPerSec);
  let completed = 0;
  reveal.setCompletionListener(() => completed++);
  return { reveal, completed: () => completed };
}

describe("LineReveal — cursor + completion", () => {
  it("reveals at charsPerSec in graphemes and completes exactly once", () => {
    const { reveal, completed } = clock(1000); // 1 grapheme/ms
    reveal.begin(parseMarkup("abcd")); // 4 graphemes → 4ms
    reveal.update(3);
    expect(reveal.revealed).toBeCloseTo(3);
    expect(completed()).toBe(0);
    reveal.update(1);
    expect(completed()).toBe(1);
    // Further ticks never re-fire completion or advance past the end.
    reveal.update(10);
    expect(completed()).toBe(1);
    expect(reveal.revealed).toBe(4);
  });

  it("an empty line completes synchronously in begin()", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("")); // length 0
    expect(completed()).toBe(1);
    expect(reveal.isComplete()).toBe(true);
    expect(reveal.isRevealing()).toBe(false);
  });

  it("counts graphemes, not code units (astral chars)", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("🔥🔥🔥🔥")); // 4 graphemes / 8 code units
    reveal.update(3);
    expect(completed()).toBe(0);
    reveal.update(1);
    expect(completed()).toBe(1); // done at 4ms, not 8ms
  });

  it("complete() jumps to the end and fires once", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("a very long line that has not been revealed yet"));
    reveal.complete();
    expect(reveal.isComplete()).toBe(true);
    expect(completed()).toBe(1);
    reveal.complete(); // idempotent
    expect(completed()).toBe(1);
  });
});

describe("LineReveal — pauses (grapheme positions)", () => {
  it("holds at a [pause] and clamps an overshooting cursor back to it", () => {
    const { reveal, completed } = clock(1000);
    // 10 graphemes, a 400ms pause after char 10, 10 more graphemes.
    reveal.begin(parseMarkup("0123456789[pause=400]abcdefghij"));
    reveal.update(15); // overshoots the pause; cursor clamps to 10
    expect(reveal.revealed).toBe(10);
    reveal.update(400); // sit out the pause
    reveal.update(6); // 6 of the remaining 10 graphemes
    expect(completed()).toBe(0);
    reveal.update(5);
    expect(completed()).toBe(1);
  });

  it("holds a [pause] at its grapheme position, unmoved by astral chars", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("🔥🔥[pause=400]ab")); // pause after 2 graphemes
    reveal.update(3); // overshoots → clamps to 2
    reveal.update(400);
    reveal.update(1);
    expect(completed()).toBe(0);
    reveal.update(1);
    expect(completed()).toBe(1);
  });
});

describe("LineReveal — speed", () => {
  it("applies per-run [speed] to the run the cursor is in", () => {
    const { reveal, completed } = clock(1000);
    // Run 1: 2 graphemes at 1x → 2ms. Run 2: 2 graphemes at 0.5x → 4ms.
    reveal.begin(parseMarkup("🔥🔥[speed=0.5]ab[/speed]"));
    reveal.update(2); // run 1 done
    reveal.update(3);
    expect(completed()).toBe(0);
    reveal.update(1);
    expect(completed()).toBe(1);
  });

  it("scales by the per-line speed multiplier", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("abcd"), 2); // 2x → 4 graphemes in 2ms
    reveal.update(1);
    expect(completed()).toBe(0);
    reveal.update(1);
    expect(completed()).toBe(1);
  });

  it("a hold-to-fast-forward multiplier speeds the reveal and resets on a new line", () => {
    const { reveal, completed } = clock(1000);
    reveal.begin(parseMarkup("abcdefgh")); // 8 graphemes
    reveal.setSpeedMultiplier(4); // 4x
    reveal.update(2); // 8 graphemes revealed
    expect(completed()).toBe(1);
    // A fresh line drops the stale multiplier (back to 1x).
    reveal.begin(parseMarkup("abcd"));
    reveal.update(2);
    expect(reveal.revealed).toBeCloseTo(2); // 1x, not 4x
  });
});

/** A reveal clock that records every beat (ticks + markers) it emits. */
function beatClock(charsPerSec: number): { reveal: LineReveal; beats: () => RevealBeat[] } {
  const reveal = new LineReveal(charsPerSec);
  const recorded: RevealBeat[] = [];
  reveal.setBeatListener((beat) => recorded.push(beat));
  return { reveal, beats: () => recorded };
}

const markerBeats = (beats: RevealBeat[]): RevealBeat[] => beats.filter((b) => b.kind === "marker");
const tickIndexes = (beats: RevealBeat[]): number[] =>
  beats.flatMap((b) => (b.kind === "tick" ? [b.index] : []));

describe("LineReveal — reveal beats (ticks + markers)", () => {
  it("emits one tick per grapheme, multiple in order on a large-dt frame", () => {
    const { reveal, beats } = beatClock(1000); // 1 grapheme/ms
    reveal.begin(parseMarkup("abcde")); // 5 graphemes
    reveal.update(3); // reveal 3 graphemes in one frame
    expect(beats()).toEqual([
      { kind: "tick", index: 0 },
      { kind: "tick", index: 1 },
      { kind: "tick", index: 2 },
    ]);
    reveal.update(2); // reveal the last two
    expect(tickIndexes(beats())).toEqual([0, 1, 2, 3, 4]);
  });

  it("fires a marker when the cursor reaches its atChar", () => {
    const { reveal, beats } = beatClock(1000);
    reveal.begin(parseMarkup("ab[sfx=ding/]cd")); // marker at grapheme 2
    reveal.update(1); // cursor 1 — before the marker
    expect(markerBeats(beats())).toEqual([]);
    reveal.update(1); // cursor 2 — reaches the marker
    expect(markerBeats(beats())).toEqual([
      { kind: "marker", marker: { atChar: 2, name: "sfx", props: { sfx: "ding" } }, viaSkip: false },
    ]);
  });

  it("a marker co-located with a [pause] fires on hold-entry, not when the hold ends", () => {
    const { reveal, beats } = beatClock(1000);
    // pause AND marker both at grapheme 2.
    reveal.begin(parseMarkup("ab[pause=400][sfx=ding/]cd"));
    reveal.update(3); // overshoots → clamps to 2, arms the 400ms pause
    expect(reveal.revealed).toBe(2);
    // The marker already fired this frame (hold-entry), before the pause elapses.
    expect(markerBeats(beats())).toEqual([
      { kind: "marker", marker: { atChar: 2, name: "sfx", props: { sfx: "ding" } }, viaSkip: false },
    ]);
    // No glyph past the pause ticked early, either.
    expect(tickIndexes(beats())).toEqual([0, 1]);

    // During the hold the cursor is frozen — no further ticks/markers emitted.
    reveal.update(400); // sit out the pause (no advance this frame)
    expect(tickIndexes(beats())).toEqual([0, 1]);
    expect(markerBeats(beats())).toHaveLength(1);
    // After the hold, ticks resume at the next index with no gap or repeat.
    reveal.update(2); // reveal c, d
    expect(tickIndexes(beats())).toEqual([0, 1, 2, 3]);
  });

  it("complete() drains pending markers (viaSkip=true) but emits no pending ticks", () => {
    const { reveal, beats } = beatClock(1000);
    // markers at grapheme 2 and 6.
    reveal.begin(parseMarkup("ab[sfx=one/]cdef[expression=sad/]gh"));
    reveal.update(1); // reveal 1 grapheme → tick 0; no marker reached yet
    reveal.complete(); // skip to end
    expect(tickIndexes(beats())).toEqual([0]); // only the pre-skip tick — no machine-gun
    expect(markerBeats(beats())).toEqual([
      { kind: "marker", marker: { atChar: 2, name: "sfx", props: { sfx: "one" } }, viaSkip: true },
      { kind: "marker", marker: { atChar: 6, name: "expression", props: { expression: "sad" } }, viaSkip: true },
    ]);
  });

  it("drains an offset-0 / marker-only line synchronously in begin()", () => {
    const { reveal, beats } = beatClock(1000);
    reveal.begin(parseMarkup("[sfx=ding/]")); // length 0, marker at 0
    expect(reveal.isComplete()).toBe(true);
    expect(beats()).toEqual([
      { kind: "marker", marker: { atChar: 0, name: "sfx", props: { sfx: "ding" } }, viaSkip: false },
    ]);
  });

  it("fires an offset-0 marker on a non-empty line synchronously in begin()", () => {
    const { reveal, beats } = beatClock(1000);
    reveal.begin(parseMarkup("[expression=happy/]hi")); // marker at 0, then 2 graphemes
    expect(markerBeats(beats())).toEqual([
      { kind: "marker", marker: { atChar: 0, name: "expression", props: { expression: "happy" } }, viaSkip: false },
    ]);
    expect(tickIndexes(beats())).toEqual([]); // begin() reveals nothing yet
  });
});
