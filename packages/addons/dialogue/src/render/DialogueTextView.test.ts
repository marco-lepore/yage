import { describe, expect, it } from "vitest";

import { parseMarkup } from "../core/markup.js";
import {
  DialogueTextView,
  type DialogueTextConfig,
} from "./DialogueTextView.js";

/**
 * These tests run the view UNMOUNTED (no scene): no glyph nodes are built, but
 * the reveal cursor / pause / completion machinery runs in full, which is what
 * F13 needs. The term/origin tests poke the two private fields involved
 * directly — building a real glyph tree headless would need the whole renderer
 * service graph for no extra coverage.
 */

const CFG: DialogueTextConfig = {
  size: 16,
  lineHeight: 20,
  defaultColor: 0xffffff,
  charsPerSec: 1000,
  layer: "dialogue-text",
};

describe("DialogueTextView — pause clamp (F13)", () => {
  it("clamps the reveal cursor back to a [pause] marker it overshot", () => {
    const view = new DialogueTextView(CFG);
    let completed = 0;
    view.onRevealComplete = () => completed++;
    // 20 chars at 1000 chars/s with a 400ms pause after char 10.
    view.show(parseMarkup("0123456789[pause=400]abcdefghij"));

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

describe("DialogueTextView — reveal-gated termAtPoint (F14)", () => {
  it("ignores spans whose first glyph has not revealed yet", () => {
    const view = new DialogueTextView(CFG);
    const internals = view as unknown as { line: unknown; shownCount: number };
    internals.line = {
      terms: [{ term: "mana", first: 5, x0: 0, y0: 0, x1: 50, y1: 16 }],
      spans: [],
      chars: [],
      metas: [],
    };

    internals.shownCount = 5; // glyphs 0..4 visible — the span starts at 5
    expect(view.termAtPoint(10, 8)).toBeUndefined();

    internals.shownCount = 6; // the span's first glyph is on screen
    expect(view.termAtPoint(10, 8)).toBe("mana");
  });
});

describe("DialogueTextView — origin provider retention (F17)", () => {
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
