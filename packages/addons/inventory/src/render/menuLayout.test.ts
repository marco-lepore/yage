import { describe, expect, it } from "vitest";
import { layoutActionMenu } from "./menuLayout.js";
import type { Rect } from "../adapter.js";

const PANEL: Rect = { x: 0, y: 0, width: 200, height: 200 };
const BASE = { padding: 10, rowGap: 6, textSize: 15 } as const;

describe("layoutActionMenu", () => {
  it("sizes the menu from the widest label and the row count", () => {
    const { menu } = layoutActionMenu({
      ...BASE,
      labels: ["Use", "Drop"],
      labelWidths: [30, 40],
      anchor: undefined,
      panel: PANEL,
    });
    // menuW = ceil(40) + 2*10 + 8; menuH = 2*(15+6) + 2*10 - 6 + 4
    expect(menu.width).toBe(68);
    expect(menu.height).toBe(60);
  });

  it("centers in the panel with no anchor", () => {
    const { menu } = layoutActionMenu({
      ...BASE,
      labels: ["Use", "Drop"],
      labelWidths: [30, 40],
      anchor: undefined,
      panel: PANEL,
    });
    expect(menu.x).toBe((200 - 68) / 2);
    expect(menu.y).toBe((200 - 60) / 2);
  });

  it("places the menu to the right of the anchor when it fits", () => {
    const { menu } = layoutActionMenu({
      ...BASE,
      labels: ["Use"],
      labelWidths: [30],
      anchor: { x: 50, y: 40, width: 40, height: 40 },
      panel: PANEL,
    });
    expect(menu.x).toBe(50 + 40 + 6); // anchor right edge + gap
    expect(menu.y).toBe(40); // aligned to the anchor top
  });

  it("flips left when the right placement would overflow the panel", () => {
    const { menu } = layoutActionMenu({
      ...BASE,
      labels: ["Use"],
      labelWidths: [30],
      anchor: { x: 180, y: 40, width: 40, height: 40 },
      panel: PANEL,
    });
    // 180 + 40 + 6 + menuW overflows 200, so it flips to anchor.x - menuW - 6.
    expect(menu.x).toBe(180 - menu.width - 6);
  });

  it("clamps the menu inside the panel bottom", () => {
    const { menu } = layoutActionMenu({
      ...BASE,
      labels: ["Use", "Drop", "Examine"],
      labelWidths: [30, 40, 60],
      anchor: { x: 20, y: 190, width: 40, height: 40 },
      panel: PANEL,
    });
    expect(menu.y).toBe(200 - menu.height - 4);
    expect(menu.y).toBeGreaterThanOrEqual(4);
  });

  it("computes one row rect per label, stacked by row height", () => {
    const { menu, rows } = layoutActionMenu({
      ...BASE,
      labels: ["Use", "Drop"],
      labelWidths: [30, 40],
      anchor: undefined,
      panel: PANEL,
    });
    expect(rows).toHaveLength(2);
    const rowHeight = 15 + 6;
    expect(rows[0]?.rect).toEqual({
      x: menu.x + 10 - 4,
      y: menu.y + 10 - 2,
      width: menu.width - 2 * (10 - 4),
      height: rowHeight,
    });
    expect(rows[1]?.rect.y).toBe((rows[0]?.rect.y ?? 0) + rowHeight);
    expect(rows.map((r) => r.label)).toEqual(["Use", "Drop"]);
  });
});
