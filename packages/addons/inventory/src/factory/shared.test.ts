import { describe, expect, it } from "vitest";
import { contentHeight } from "./shared.js";
import { DETAIL_GAP, HEADER_GAP } from "../render/PanelLayout.js";
import { createInventoryPanel } from "./createInventoryPanel.js";
import { rowCell } from "../render/rowCell.js";
import { defaultInventoryTheme } from "./defaultTheme.js";

describe("content-height math", () => {
  it("contentHeight subtracts padding and only the bands that exist", () => {
    expect(contentHeight(300, 16, 20, 60, HEADER_GAP, DETAIL_GAP)).toBe(
      300 - 32 - (20 + HEADER_GAP) - (60 + DETAIL_GAP),
    );
    expect(contentHeight(300, 16, 0, 0, HEADER_GAP, DETAIL_GAP)).toBe(300 - 32);
  });
});

describe("factory bounds integration", () => {
  it("icon-grid and row-list panels build against explicit bounds without throwing", () => {
    const theme = defaultInventoryTheme();
    const bounds = { x: 10, y: 10, width: 360, height: 320 };
    expect(() => createInventoryPanel(theme, { bounds, chrome: false })).not.toThrow();
    expect(() => createInventoryPanel(theme, { cell: rowCell, bounds })).not.toThrow();
  });
});
