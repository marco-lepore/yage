import { describe, expect, it } from "vitest";
import { Facing } from "./Facing.js";

describe("Facing", () => {
  it("defaults to east: unit (1, 0), angleRad 0, cardinal E", () => {
    const facing = new Facing();
    expect(facing.unit).toEqual({ x: 1, y: 0 });
    expect(facing.angleRad).toBe(0);
    expect(facing.cardinal).toBe("E");
  });

  it("set() normalizes and updates the derived cardinal", () => {
    const facing = new Facing();

    facing.set(3, 0);
    expect(facing.unit).toEqual({ x: 1, y: 0 });

    facing.set(0, 5);
    expect(facing.unit).toEqual({ x: 0, y: 1 });
    expect(facing.cardinal).toBe("S");

    facing.set(-2, 0);
    expect(facing.cardinal).toBe("W");

    facing.set(0, -1);
    expect(facing.cardinal).toBe("N");
  });

  it("ignores zero (and near-zero) vectors, keeping the last facing", () => {
    const facing = new Facing();
    facing.set(0, 1);

    facing.set(0, 0);
    expect(facing.unit).toEqual({ x: 0, y: 1 });

    facing.set(1e-9, 0);
    expect(facing.unit).toEqual({ x: 0, y: 1 });
  });

  it("computes angleRad for a diagonal", () => {
    const facing = new Facing();
    facing.set(1, 1);
    expect(facing.angleRad).toBeCloseTo(Math.PI / 4);
  });

  it("cardinal ties (|x| === |y|) resolve to the x axis", () => {
    const facing = new Facing();

    facing.set(1, 1);
    expect(facing.cardinal).toBe("E");

    facing.set(1, -1);
    expect(facing.cardinal).toBe("E");
  });

  it("sector(8) indexes the octants, 0 = east, increasing clockwise", () => {
    const facing = new Facing();
    const octants: Array<[number, number, number]> = [
      [1, 0, 0], // E
      [1, 1, 1], // SE
      [0, 1, 2], // S
      [-1, 1, 3], // SW
      [-1, 0, 4], // W
      [-1, -1, 5], // NW
      [0, -1, 6], // N
      [1, -1, 7], // NE
    ];
    for (const [x, y, expected] of octants) {
      facing.set(x, y);
      expect(facing.sector(8)).toBe(expected);
    }
  });

  it("sector(4) indexes the cardinals E/S/W/N", () => {
    const facing = new Facing();
    facing.set(1, 0);
    expect(facing.sector(4)).toBe(0);
    facing.set(0, 1);
    expect(facing.sector(4)).toBe(1);
    facing.set(-1, 0);
    expect(facing.sector(4)).toBe(2);
    facing.set(0, -1);
    expect(facing.sector(4)).toBe(3);
  });

  it("rounds ties up to the higher sector", () => {
    const facing = new Facing();
    facing.set(1, 1); // 45°, exactly on the sector 0/1 boundary at n = 4
    expect(facing.sector(4)).toBe(1);
  });

  it("wraps the top of the range back to 0", () => {
    const facing = new Facing();
    facing.set(Math.cos(-Math.PI / 18), Math.sin(-Math.PI / 18)); // -10°
    expect(facing.sector(8)).toBe(0);
  });
});
