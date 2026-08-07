import { describe, expect, it } from "vitest";
import { readTileGid, tileIdFromGid, tileRotationFromGid } from "./gid.js";

const BASE = 1;
const H = 0x80000000;
const V = 0x40000000;
const D = 0x20000000;

describe("readTileGid", () => {
  it("returns the tile id unchanged when no flag is set", () => {
    expect(readTileGid(42)).toEqual({
      id: 42,
      flippedHorizontally: false,
      flippedVertically: false,
      flippedDiagonally: false,
    });
  });

  it("strips every flag combination off the id", () => {
    for (const flags of [H, V, D, H | V, H | D, V | D, H | V | D]) {
      expect(readTileGid(BASE + flags).id).toBe(BASE);
      expect(tileIdFromGid(BASE + flags)).toBe(BASE);
    }
  });

  it("reads each flag independently", () => {
    expect(readTileGid(BASE + H).flippedHorizontally).toBe(true);
    expect(readTileGid(BASE + H).flippedVertically).toBe(false);
    expect(readTileGid(BASE + V).flippedVertically).toBe(true);
    expect(readTileGid(BASE + D).flippedDiagonally).toBe(true);

    const all = readTileGid(BASE + H + V + D);
    expect(all.flippedHorizontally).toBe(true);
    expect(all.flippedVertically).toBe(true);
    expect(all.flippedDiagonally).toBe(true);
  });
});

describe("tileRotationFromGid", () => {
  it("maps every Tiled flag combination to its groupD8 rotation", () => {
    // Read off a rendered asymmetric tile: 2 turns it 90° counter-clockwise,
    // 4 turns it 180°, 6 turns it 90° clockwise, 8 mirrors it top-to-bottom,
    // 10 reflects it across the main diagonal, 12 mirrors it left-to-right,
    // and 14 reflects it across the anti-diagonal.
    const table: Record<string, number> = {
      none: 0,
      horizontal: 12,
      vertical: 8,
      "horizontal+vertical": 4,
      diagonal: 10,
      "diagonal+horizontal": 6,
      "diagonal+vertical": 2,
      "diagonal+horizontal+vertical": 14,
    };
    const flags: Record<string, number> = {
      none: 0,
      horizontal: H,
      vertical: V,
      "horizontal+vertical": H | V,
      diagonal: D,
      "diagonal+horizontal": D | H,
      "diagonal+vertical": D | V,
      "diagonal+horizontal+vertical": D | H | V,
    };

    const actual: Record<string, number> = {};
    for (const key of Object.keys(table)) {
      actual[key] = tileRotationFromGid(BASE + flags[key]!);
    }
    expect(actual).toEqual(table);
  });
});
