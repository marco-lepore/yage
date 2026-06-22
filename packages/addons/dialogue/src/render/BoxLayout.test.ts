import { describe, expect, it } from "vitest";

import { BoxLayout, type BoxLayoutConfig } from "./BoxLayout.js";
import type { PresentedLine } from "../core/session.js";

/**
 * BoxLayout is the box-side geometry owner (per-line position, the unified panel
 * grow, and the avatar-reflow inset registry). These tests are pure geometry —
 * no renderer — using prompt-less lines so nothing measures text.
 */
const CFG: BoxLayoutConfig = {
  box: { x: 32, y: 360, width: 736, height: 160 },
  padding: 16,
  nameSize: 16,
  textSize: 18,
  lineHeight: 24,
  choiceGap: 6,
  fontFamily: "sans-serif",
};
// field = box.y + box.height + box.x = 552; margin = box.x = 32.
const BODY_OFFSET = CFG.nameSize + 4; // nameplate band + gap (TEXT_GAP)

const line = (over: Partial<PresentedLine> = {}): PresentedLine => ({
  text: { runs: [], pauses: [], length: 0 },
  speed: 1,
  ...over,
});

describe("BoxLayout — per-line position", () => {
  it("defaults to the resting bottom box", () => {
    const owner = new BoxLayout(CFG);
    const f = owner.layoutLine(line());
    expect(f).toEqual({ x: 32, y: 360, width: 736, height: 160 });
  });

  it("meta.position moves the frame AND the text region together", () => {
    const owner = new BoxLayout(CFG);

    owner.layoutLine(line());
    const bottomFrame = owner.frameRect();
    const bottomText = owner.textRegion();
    expect(bottomText.y).toBe(360 + 16 + BODY_OFFSET); // below the band

    owner.layoutLine(line({ meta: { position: "top" } }));
    const topFrame = owner.frameRect();
    const topText = owner.textRegion();
    expect(topFrame.y).toBe(32); // top margin
    // The frame and the text region shifted by the SAME delta — they move as one.
    expect(bottomFrame.y - topFrame.y).toBe(bottomText.y - topText.y);

    owner.layoutLine(line({ meta: { position: "center" } }));
    expect(owner.frameRect().y).toBe((552 - 160) / 2); // 196
  });
});

describe("BoxLayout — inset registry (text reflow)", () => {
  it("a left inset shifts the text x and narrows it; clearing reclaims the width", () => {
    const owner = new BoxLayout(CFG);
    owner.layoutLine(line());
    const full = owner.textRegion();

    owner.setInset("avatar", { side: "left", width: 100 });
    const inset = owner.textRegion();
    expect(inset.x).toBe(full.x + 100);
    expect(inset.width).toBe(full.width - 100);
    expect(owner.insetWidth("left")).toBe(100);

    owner.setInset("avatar", undefined);
    expect(owner.textRegion()).toEqual(full); // text reclaims the full width
  });

  it("a right inset narrows without shifting x", () => {
    const owner = new BoxLayout(CFG);
    owner.layoutLine(line());
    const full = owner.textRegion();
    owner.setInset("a", { side: "right", width: 80 });
    expect(owner.textRegion().x).toBe(full.x);
    expect(owner.textRegion().width).toBe(full.width - 80);
  });

  it("fires onChange when the frame moves or an inset changes", () => {
    const owner = new BoxLayout(CFG);
    let changes = 0;
    owner.onChange(() => changes++);
    owner.layoutLine(line()); // commit base (from the ctor's base it's unchanged → no fire)
    owner.layoutLine(line({ meta: { position: "top" } })); // moved
    expect(changes).toBe(1);
    owner.setInset("a", { side: "left", width: 50 }); // reflow
    expect(changes).toBe(2);
    owner.setInset("a", { side: "left", width: 50 }); // identical → no fire
    expect(changes).toBe(2);
  });
});

describe("BoxLayout — unified panel grow", () => {
  it("grows the frame to fit the rows, keeping the bottom edge and moving the top up", () => {
    const owner = new BoxLayout(CFG);
    owner.layoutLine(line()); // a prompt-less choice line
    const rowHeights = [40, 40, 40, 40, 40]; // 200px of rows
    const rects = owner.layoutChoicePanel(rowHeights);
    const f = owner.frameRect();

    // content = padding(16) + band(20) + rows(200) + padding(16) = 252 > base 160
    expect(f.height).toBe(252);
    expect(f.y).toBeLessThan(360); // top rose
    expect(f.y + f.height).toBe(360 + 160); // bottom edge pinned (bottom-anchored)

    // Nameplate + caret follow the grown frame (one panel).
    expect(owner.nameplatePos().y).toBe(f.y + 16 - 1);
    expect(owner.caretPos({ width: 7, height: 5 }).y).toBe(f.y + f.height - 16 - 5 - 1);

    // Rows sit inside, contiguous, below the band, last pinned to the inner bottom.
    expect(rects[0]!.y).toBe(f.y + 16 + BODY_OFFSET);
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i]!.y + rects[i]!.height).toBe(rects[i + 1]!.y);
    }
    expect(rects[4]!.y + rects[4]!.height).toBe(f.y + f.height - 16);
  });

  it("a short list keeps the base frame height", () => {
    const owner = new BoxLayout(CFG);
    owner.layoutLine(line());
    owner.layoutChoicePanel([30, 30]); // content well under the base 160
    expect(owner.frameRect().height).toBe(160);
  });

  it("caps the grown frame at the field (minus margins)", () => {
    const owner = new BoxLayout(CFG);
    owner.layoutLine(line());
    owner.layoutChoicePanel(new Array(40).fill(40)); // absurdly tall
    const maxH = 552 - 2 * 32; // 488
    expect(owner.frameRect().height).toBe(maxH);
  });
});
