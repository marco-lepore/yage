import { describe, expect, it } from "vitest";
import { contentHeight, fitRows } from "./shared.js";
import { DETAIL_GAP, HEADER_GAP } from "../render/PanelLayout.js";
import { createGridInventory } from "./createGridInventory.js";
import { createListInventory } from "./createListInventory.js";
import { defaultInventoryTheme } from "./defaultTheme.js";

describe("bounds fitting math", () => {
  it("fitRows counts gapless-last-row steps, never below 1", () => {
    // step 62 (56 cell + 6 gap): 3 rows need 3*62 - 6 = 180.
    expect(fitRows(180, 62, 6)).toBe(3);
    expect(fitRows(179, 62, 6)).toBe(2);
    expect(fitRows(10, 62, 6)).toBe(1);
  });

  it("contentHeight subtracts padding and only the bands that exist", () => {
    expect(contentHeight(300, 16, 20, 60, HEADER_GAP, DETAIL_GAP)).toBe(
      300 - 32 - (20 + HEADER_GAP) - (60 + DETAIL_GAP),
    );
    expect(contentHeight(300, 16, 0, 0, HEADER_GAP, DETAIL_GAP)).toBe(300 - 32);
  });
});

describe("factory bounds integration", () => {
  it("grid and list bundles build against explicit bounds without throwing", () => {
    const theme = defaultInventoryTheme();
    const bounds = { x: 10, y: 10, width: 360, height: 320 };
    expect(() => createGridInventory(theme, { bounds, chrome: false })).not.toThrow();
    expect(() => createListInventory(theme, { bounds })).not.toThrow();
  });
});
