import { describe, expect, it } from "vitest";
import { MarkLayout, type MarkGroup } from "./markLayout.js";
import { pressesMark } from "./marks.js";

const viewport = { minX: 0, minY: 0, maxX: 300, maxY: 200 };
const group = (id: string, x = 150, y = 100): MarkGroup => ({
  id,
  origin: { x, y },
  marks: [{ type: id, kind: "other" }],
});

describe("MarkLayout", () => {
  it("separates groups sharing an origin and keeps positions between reads", () => {
    const layout = new MarkLayout();
    const groups = [group("a"), group("b"), group("c")];
    const placed = layout.place(groups, 1, viewport, []);
    expect(
      new Set(placed.map((g) => JSON.stringify(g.marks[0]?.at))).size,
    ).toBe(3);
    expect(layout.place(groups, 1, viewport, [])).toEqual(placed);
    for (const one of placed)
      for (const other of placed) {
        if (one.id !== other.id)
          expect(pressesMark(one.marks[0]!.at, other.marks[0]!.at, 1)).toBe(
            false,
          );
      }
  });

  it("keeps all hit targets inside each viewport edge", () => {
    const placed = new MarkLayout().place(
      [
        group("tl", 0, 0),
        group("tr", 300, 0),
        group("bl", 0, 200),
        group("br", 300, 200),
      ],
      1,
      viewport,
      [],
    );
    for (const one of placed)
      for (const mark of one.marks) {
        expect(mark.at.x).toBeGreaterThanOrEqual(9);
        expect(mark.at.x).toBeLessThanOrEqual(291);
        expect(mark.at.y).toBeGreaterThanOrEqual(9);
        expect(mark.at.y).toBeLessThanOrEqual(191);
      }
  });

  it("moves out of editing controls and keeps that offset after selection clears", () => {
    const layout = new MarkLayout();
    const groups = [group("a")];
    const blocked = { minX: 100, minY: 50, maxX: 200, maxY: 150 };
    const placed = layout.place(groups, 1, viewport, [blocked]);
    const point = placed[0]!.marks[0]!.at;
    expect(point.x < 91 || point.x > 209 || point.y < 41 || point.y > 159).toBe(
      true,
    );
    expect(layout.place(groups, 1, viewport, [])).toEqual(placed);
  });

  it("preserves screen offsets through pan and zoom away from obstacles", () => {
    const layout = new MarkLayout();
    const placed = layout.place([group("a")], 1, undefined, []);
    const zoomed = layout.place([group("a", 250, 200)], 2, undefined, []);
    expect(zoomed[0]!.marks[0]!.at.y - 200).toBe(
      (placed[0]!.marks[0]!.at.y - 100) * 2,
    );
  });

  it("wraps large groups in narrow viewports and omits off-screen origins", () => {
    const many = {
      ...group("a", 25, 100),
      marks: Array.from({ length: 8 }, (_, i) => ({
        type: String(i),
        kind: "other" as const,
      })),
    };
    const placed = new MarkLayout().place(
      [many, group("off", -50)],
      1,
      { ...viewport, maxX: 50 },
      [],
    );
    expect(placed.map((g) => g.id)).toEqual(["a"]);
    expect(new Set(placed[0]!.marks.map((m) => m.at.y)).size).toBeGreaterThan(
      1,
    );
    for (const mark of placed[0]!.marks)
      expect(mark.at.x).toBeGreaterThanOrEqual(9);
  });
});
