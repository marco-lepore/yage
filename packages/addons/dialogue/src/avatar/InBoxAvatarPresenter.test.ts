import { describe, expect, it } from "vitest";

import { InBoxAvatarPresenter } from "./InBoxAvatarPresenter.js";
import { BoxLayout, type BoxLayoutConfig } from "../render/BoxLayout.js";
import type { PresentedLine } from "../core/session.js";

/**
 * The reference in-box avatar is built only from the contract: `present(line)`
 * + the layout's inset registry. These tests run it headless (no scene → no
 * sprite) and assert it reflows the box text by registering an inset — the proof
 * the reflow seam works without addon internals.
 */
const CFG: BoxLayoutConfig = {
  box: { x: 32, y: 360, width: 736, height: 160 },
  padding: 16,
  nameSize: 16,
  textSize: 18,
  lineHeight: 24,
  choiceGap: 6,
};

const line = (meta?: Record<string, unknown>): PresentedLine => ({
  text: { runs: [], pauses: [], length: 0 },
  speed: 1,
  ...(meta ? { meta } : {}),
});

function setup(): { layout: BoxLayout; avatar: InBoxAvatarPresenter; fullWidth: number } {
  const layout = new BoxLayout(CFG);
  layout.layoutLine(line());
  const avatar = new InBoxAvatarPresenter(layout, { layer: "dialogue-avatar", width: 96, gap: 8 });
  return { layout, avatar, fullWidth: layout.textRegion().width };
}

describe("InBoxAvatarPresenter — line-driven reflow", () => {
  it("reserves a left column for meta.portrait so the text reflows", () => {
    const { layout, avatar, fullWidth } = setup();
    avatar.present(line({ portrait: "hero", side: "left" }));
    const region = layout.textRegion();
    expect(layout.insetWidth("left")).toBe(96 + 8); // width + gap
    expect(region.width).toBe(fullWidth - (96 + 8));
    expect(region.x).toBeGreaterThan(CFG.box.x + CFG.padding); // text shifted right
  });

  it("reserves the right column when meta.side is right", () => {
    const { layout, avatar } = setup();
    avatar.present(line({ portrait: "hero", side: "right" }));
    expect(layout.insetWidth("right")).toBe(96 + 8);
    expect(layout.insetWidth("left")).toBe(0);
  });

  it("a line with no portrait reclaims the full width", () => {
    const { layout, avatar, fullWidth } = setup();
    avatar.present(line({ portrait: "hero" })); // inset on
    avatar.present(line({})); // no portrait → inset cleared
    expect(layout.textRegion().width).toBe(fullWidth);
  });

  it("meta.presence:false hides the portrait and reserves nothing (off-screen voice)", () => {
    const { layout, avatar, fullWidth } = setup();
    avatar.present(line({ portrait: "hero", presence: false }));
    expect(layout.textRegion().width).toBe(fullWidth);
  });

  it("present(undefined) on stop/end clears the inset", () => {
    const { layout, avatar, fullWidth } = setup();
    avatar.present(line({ portrait: "hero" }));
    avatar.present(undefined);
    expect(layout.textRegion().width).toBe(fullWidth);
  });
});
