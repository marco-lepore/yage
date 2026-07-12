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
});
