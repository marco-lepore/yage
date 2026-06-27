import { CanvasTextMetrics } from "pixi.js";
import { describe, expect, it } from "vitest";

import { parseMarkup, splitGraphemes } from "../core/markup.js";
import type { ParsedText, RunStyle } from "../core/types.js";
import {
  DialogueTextView,
  type DialogueTextConfig,
} from "./DialogueTextView.js";

/**
 * These tests run the view UNMOUNTED (no scene): no glyph nodes are built, but
 * the reveal cursor / pause / completion machinery runs in full, which is what
 * these tests need. The origin test pokes the private field directly — building a
 * real glyph tree headless would need the whole renderer service graph for no
 * extra coverage.
 */

const CFG: DialogueTextConfig = {
  textSize: 16,
  lineHeight: 20,
  textColor: 0xffffff,
  charsPerSec: 1000,
  layer: "dialogue-text",
};

describe("DialogueTextView — pause clamp", () => {
  it("clamps the reveal cursor back to a [pause] marker it overshot", () => {
    const view = new DialogueTextView(CFG);
    let completed = 0;
    view.setRevealListener(() => completed++);
    // 20 chars at 1000 chars/s with a 400ms pause after char 10.
    view.show(parseMarkup("0123456789[pause=400/]abcdefghij"));

    view.update(15); // one frame overshoots the pause (cursor would hit 15)
    view.update(400); // sit out the pause
    // With the cursor clamped back to 10, ten characters (10ms) remain. An
    // unclamped cursor (15) would have finished within the next 6ms.
    view.update(6);
    expect(completed).toBe(0);
    view.update(5);
    expect(completed).toBe(1);
  });
});

describe("DialogueTextView — grapheme reveal units", () => {
  it("completes at the grapheme count, not the code-unit count", () => {
    const view = new DialogueTextView(CFG);
    let completed = 0;
    view.setRevealListener(() => completed++);
    // 4 graphemes but 8 code units at 1000 graphemes/s → done in 4ms, not 8.
    view.show(parseMarkup("🔥🔥🔥🔥"));

    view.update(3);
    expect(completed).toBe(0);
    view.update(1);
    expect(completed).toBe(1);
  });

  it("holds a [pause] at the grapheme position, unmoved by astral chars", () => {
    const view = new DialogueTextView(CFG);
    let completed = 0;
    view.setRevealListener(() => completed++);
    // Pause sits after 2 graphemes (4 code units); 2 graphemes follow.
    view.show(parseMarkup("🔥🔥[pause=400/]ab"));

    view.update(3); // overshoots the pause at 2; cursor clamps back to it
    view.update(400); // sit out the pause
    // 2 graphemes (2ms) remain — code-unit bookkeeping would need 4 more ms.
    view.update(1);
    expect(completed).toBe(0);
    view.update(1);
    expect(completed).toBe(1);
  });

  it("applies [speed] to the run the grapheme cursor is in", () => {
    const view = new DialogueTextView(CFG);
    let completed = 0;
    view.setRevealListener(() => completed++);
    // Run 1: 2 graphemes (4 code units) at 1x → 2ms. Run 2: 2 graphemes at
    // 0.5x → 4ms. Code-unit bookkeeping would still be in run 1 (4 units) at
    // cursor 2-4 and finish on a different clock.
    view.show(parseMarkup("🔥🔥[speed=0.5]ab[/speed]"));

    view.update(2); // run 1 fully revealed
    view.update(3);
    expect(completed).toBe(0);
    view.update(1);
    expect(completed).toBe(1);
  });

  it("builds per-glyph styles and the non-space prefix table in graphemes", () => {
    const view = new DialogueTextView(CFG);
    const internals = view as unknown as {
      buildRevealTables(parsed: ParsedText): RunStyle[];
      nonSpacePrefix: Int32Array;
    };
    // Graphemes: 🔥, ␠, n, o, w — the style fan-out must skip the space and
    // stay aligned after the astral char (code-point iteration would emit an
    // extra entry and shift every style after the emoji).
    const styles = internals.buildRevealTables(parseMarkup("🔥 [color=gold]now[/color]"));
    expect(styles).toHaveLength(4); // one per NON-SPACE glyph
    expect(styles[0]).toEqual({});
    expect(styles[1]).toEqual({ color: 0xffd25a });
    expect(styles[2]).toEqual({ color: 0xffd25a });
    expect(styles[3]).toEqual({ color: 0xffd25a });
    // prefix[k] = non-space glyphs among the first k graphemes (length = graphemes + 1).
    expect(Array.from(internals.nonSpacePrefix)).toEqual([0, 1, 1, 2, 3, 4]);
  });
});

describe("splitGraphemes ↔ pixi SplitText parity", () => {
  it("segments exactly like CanvasTextMetrics.graphemeSegmenter (one glyph node per grapheme)", () => {
    const samples = [
      "hello world",
      "🔥 now",
      "👨‍👩‍👧‍👦!",
      "Café au lait",
      "héllo 👩‍🚀 mixed 🔥 text",
      "",
    ];
    for (const s of samples) {
      expect(splitGraphemes(s)).toEqual(CanvasTextMetrics.graphemeSegmenter(s));
    }
  });
});

describe("DialogueTextView — delta reveal", () => {
  /** A fake glyph node that counts `visible` writes. */
  function instrumentedChar(counter: { writes: number }): { visible: boolean } {
    let v = false;
    return {
      get visible() {
        return v;
      },
      set visible(next: boolean) {
        v = next;
        counter.writes++;
      },
    };
  }

  it("toggles only the [prevShown, shown) range per step; skipToEnd reveals the rest", () => {
    const view = new DialogueTextView(CFG);
    const parsed = parseMarkup("abcdef");
    view.show(parsed); // unmounted: no real glyph tree is built
    const internals = view as unknown as {
      buildRevealTables(p: ParsedText): RunStyle[];
      line: unknown;
    };
    // Fabricate the line the (skipped) buildLine would have produced, with
    // instrumented chars so each visibility write is counted.
    internals.buildRevealTables(parsed);
    const counter = { writes: 0 };
    const chars = Array.from({ length: 6 }, () => instrumentedChar(counter));
    internals.line = { entity: undefined, comp: undefined, chars, effectMetas: [] };

    view.update(2); // 1000 graphemes/s → 2 shown; writes [0, 2)
    expect(chars.map((c) => c.visible)).toEqual([true, true, false, false, false, false]);
    expect(counter.writes).toBe(2);

    view.update(2); // 4 shown; writes only the delta [2, 4)
    expect(chars.map((c) => c.visible)).toEqual([true, true, true, true, false, false]);
    expect(counter.writes).toBe(4);

    view.skipToEnd(); // writes only [4, 6)
    expect(chars.every((c) => c.visible)).toBe(true);
    expect(counter.writes).toBe(6);
  });
});

describe("DialogueTextView — reveal seam", () => {
  it("the reveal listener can't be clobbered by assigning a public field", () => {
    const view = new DialogueTextView(CFG);
    let real = 0;
    let ghost = 0;
    view.setRevealListener(() => real++);
    // A game's mistaken "hook reveal" via a public field (there is none) must
    // NOT detach the session-owned listener.
    (view as unknown as { onRevealComplete?: () => void }).onRevealComplete = () => ghost++;
    view.show(parseMarkup("hi"));
    view.update(100); // finish the reveal
    expect(real).toBe(1); // session-owned listener fired
    expect(ghost).toBe(0); // the assigned field is inert
  });
});

describe("DialogueTextView — origin provider retention", () => {
  it("clear() drops the origin closure; the per-line reset keeps it", () => {
    const view = new DialogueTextView(CFG);
    const internals = view as unknown as {
      originProvider?: () => { x: number; y: number };
    };
    const provider = (): { x: number; y: number } => ({ x: 1, y: 2 });

    view.setOrigin(provider);
    view.show(parseMarkup("hi")); // per-line teardown must NOT drop the origin
    expect(internals.originProvider).toBe(provider);

    view.clear(); // channel-level clear (conversation end) drops the closure
    expect(internals.originProvider).toBeUndefined();
  });
});
