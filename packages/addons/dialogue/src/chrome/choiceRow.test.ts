import { describe, expect, it } from "vitest";
import { TextComponent } from "@yagejs/renderer";
import { applyChoiceTint, DISABLED_CHOICE_ALPHA } from "./choiceRow.js";

function row(disabled = false) {
  return {
    comp: new TextComponent({ text: "choice", style: { fill: 0x999999 } }),
    disabled,
  };
}

describe("applyChoiceTint", () => {
  it("keeps the selected colour through a later style merge", () => {
    const rows = [row(), row()];
    applyChoiceTint(rows, 1, 0x999999, 0xffcc00);

    // A reflow re-wraps every row through mergeStyle.
    rows[1]!.comp.mergeStyle({ wordWrap: true, wordWrapWidth: 120 });

    expect(rows[1]!.comp.renderObject.style.fill).toBe(0xffcc00);
    expect(rows[0]!.comp.renderObject.style.fill).toBe(0x999999);
  });

  it("dims a disabled row through the component's alpha", () => {
    const rows = [row(), row(true)];
    applyChoiceTint(rows, 0, 0x999999, 0xffcc00);

    expect(rows[1]!.comp.alpha).toBe(DISABLED_CHOICE_ALPHA);
    expect(rows[0]!.comp.alpha).toBe(1);
  });
});
