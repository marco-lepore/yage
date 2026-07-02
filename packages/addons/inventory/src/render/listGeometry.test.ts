import { describe, expect, it } from "vitest";
import { listNavigate, listRowAtPoint, listRowRect, listScrollOffset, type ListSpec } from "./listGeometry.js";

describe("listNavigate", () => {
  it("moves linearly, clamps at ends, ignores left/right", () => {
    expect(listNavigate(2, "down", 5)).toBe(3);
    expect(listNavigate(2, "up", 5)).toBe(1);
    expect(listNavigate(0, "up", 5)).toBe(0);
    expect(listNavigate(4, "down", 5)).toBe(4);
    expect(listNavigate(2, "left", 5)).toBe(2);
    expect(listNavigate(2, "right", 5)).toBe(2);
  });

  it("wraps when asked", () => {
    expect(listNavigate(0, "up", 5, true)).toBe(4);
    expect(listNavigate(4, "down", 5, true)).toBe(0);
  });
});

describe("list window + rects", () => {
  const spec: ListSpec = { rowHeight: 24, visibleRows: 3 };
  const origin = { x: 50, y: 100 };

  it("scrolls to keep the selection visible", () => {
    expect(listScrollOffset(0, 0, 3, 8)).toBe(0);
    expect(listScrollOffset(4, 0, 3, 8)).toBe(2);
    expect(listScrollOffset(1, 2, 3, 8)).toBe(1);
    expect(listScrollOffset(7, 9, 3, 8)).toBe(5); // stale offset clamps
  });

  it("row rects window with the offset; hit-test inverts them", () => {
    expect(listRowRect(3, spec, origin, 2, 200)).toEqual({ x: 50, y: 124, width: 200, height: 24 });
    expect(listRowRect(1, spec, origin, 2, 200)).toBeNull();
    expect(listRowAtPoint(60, 130, spec, origin, 2, 8, 200)).toBe(3);
    expect(listRowAtPoint(60, 90, spec, origin, 2, 8, 200)).toBeUndefined();
    expect(listRowAtPoint(300, 130, spec, origin, 2, 8, 200)).toBeUndefined();
    expect(listRowAtPoint(60, 100 + 3 * 24 + 1, spec, origin, 2, 8, 200)).toBeUndefined(); // past window
  });
});
