import { beforeEach, describe, expect, it, vi } from "vitest";

// Deterministic stand-in for the renderer's measureWrappedText (8px/char),
// counting calls so the memoization (one measurement shared by chrome + text)
// is assertable.
const calls: Array<{ text: string }> = [];
vi.mock("@yagejs/renderer", () => ({
  measureWrappedText: (text: string, options: Record<string, unknown>) => {
    calls.push({ text });
    const charW = 8;
    const wrap = typeof options.wordWrapWidth === "number";
    const perLine = wrap ? Math.max(1, Math.floor((options.wordWrapWidth as number) / charW)) : 1e9;
    const lineCount = wrap ? Math.max(1, Math.ceil(text.length / perLine)) : 1;
    return { width: Math.min(text.length, perLine) * charW, height: lineCount * 20, lineCount };
  },
}));

import { BubbleLayout, type BubbleLayoutConfig } from "./BubbleLayout.js";
import type { PresentedLine } from "../core/session.js";

const CFG: BubbleLayoutConfig = {
  minWidth: 60,
  maxWidth: 200,
  height: 40,
  padding: 10,
  offsetY: 24,
  textSize: 16,
  lineHeight: 20,
};

const line = (text: string): PresentedLine => ({
  text: { runs: [{ text, style: {}, graphemeCount: text.length }], pauses: [], markers: [], length: text.length },
  speed: 1,
  speaker: { id: "npc", name: "NPC" },
});

beforeEach(() => {
  calls.length = 0;
});

describe("BubbleLayout — single owner", () => {
  it("measures a line once and memoizes it (the companion presenter reads free)", () => {
    const owner = new BubbleLayout(CFG);
    const l = line("hello world");
    const first = owner.sizeFor(l); // chrome.present
    const before = calls.length;
    const second = owner.sizeFor(l); // text.present — same line object
    expect(calls.length).toBe(before); // no re-measure
    expect(second).toBe(first); // identical object → chrome + text can't drift
  });

  it("re-measures a different line", () => {
    const owner = new BubbleLayout(CFG);
    owner.sizeFor(line("hi"));
    const after = calls.length;
    owner.sizeFor(line("a much longer line that wraps"));
    expect(calls.length).toBeGreaterThan(after);
  });

  it("derives the inner top-left origin once from the anchor + size", () => {
    const owner = new BubbleLayout(CFG);
    const size = { width: 120, height: 40 };
    // x = anchor.x - w/2 + padding; y = anchor.y - (offsetY + h) + padding
    expect(owner.originFor({ x: 200, y: 300 }, size)).toEqual({
      x: 200 - 60 + 10,
      y: 300 - (24 + 40) + 10,
    });
  });

  it("exposes the shared geometry the presenters position by", () => {
    const owner = new BubbleLayout(CFG);
    expect(owner.padding).toBe(10);
    expect(owner.offsetY).toBe(24);
  });
});

describe("BubbleLayout — in-bubble portrait inset", () => {
  it("grows the bubble, narrows the text column, and shifts the origin", () => {
    const owner = new BubbleLayout(CFG);
    const l = line("a".repeat(30)); // wraps at this width
    const base = owner.sizeFor(l);
    const baseWrap = owner.textWrapWidth(base);

    owner.setPortraitInset({ side: "left", width: 64, height: 56 });
    const withInset = owner.sizeFor(l); // memo invalidated → re-measured

    expect(owner.textWrapWidth(withInset)).toBe(baseWrap - 64); // text column narrows
    expect(withInset.height).toBeGreaterThan(base.height); // taller: more wrap + portrait
    // origin shifts right past the left column (anchor.x - w/2 + padding + inset.width)
    expect(owner.originFor({ x: 500, y: 300 }, withInset).x).toBe(
      500 - withInset.width / 2 + 10 + 64,
    );

    owner.setPortraitInset(undefined);
    expect(owner.textWrapWidth(owner.sizeFor(l))).toBe(baseWrap); // bubble reclaims full width
  });

  it("tracks the active bubble (say bubble, then choice panel) + notifies on change", () => {
    const owner = new BubbleLayout(CFG);
    let changes = 0;
    owner.onChange(() => changes++);

    owner.sizeFor(line("hi")); // a say line sizes the bubble → active + notify
    const afterSay = changes;
    expect(owner.activeSize()).toBeDefined();

    // A bubble choice commits its (inset-grown) panel → the avatar follows it.
    owner.setChoicePanelSize({ width: 320, height: 140 });
    expect(changes).toBe(afterSay + 1);
    expect(owner.activeSize()).toEqual({ width: 320, height: 140 });
    owner.setChoicePanelSize({ width: 320, height: 140 }); // unchanged → no notify
    expect(changes).toBe(afterSay + 1);
  });

  it("a right inset narrows the text but does not shift the origin", () => {
    const owner = new BubbleLayout(CFG);
    const l = line("a".repeat(30));
    const baseOrigin = owner.originFor({ x: 500, y: 300 }, owner.sizeFor(l));
    owner.setPortraitInset({ side: "right", width: 64, height: 56 });
    const withInset = owner.sizeFor(l);
    // x is still anchor.x - w/2 + padding (no shift), just a wider bubble.
    expect(owner.originFor({ x: 500, y: 300 }, withInset).x).toBe(500 - withInset.width / 2 + 10);
    expect(owner.textWrapWidth(withInset)).toBeLessThan(withInset.width - 2 * 10);
    expect(baseOrigin.y).toBeLessThan(300); // (sanity: bubble sits above the anchor)
  });
});
