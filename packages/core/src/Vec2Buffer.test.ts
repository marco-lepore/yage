import { describe, expect, expectTypeOf, it } from "vitest";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";
import { Vec2Buffer } from "./Vec2Buffer.js";

describe("Vec2Buffer", () => {
  it("defaults to zero and returns itself from set", () => {
    const out = new Vec2Buffer();
    expect([out.x, out.y]).toEqual([0, 0]);
    expect(out.set(3, 4)).toBe(out);
    expect([out.x, out.y]).toEqual([3, 4]);
    expectTypeOf<Vec2>().not.toExtend<Vec2Buffer>();
    expectTypeOf(Vec2.addInto).parameter(0).toEqualTypeOf<Vec2Buffer>();
  });

  const operations: {
    name: string;
    into: (out: Vec2Buffer, a: Vec2Like, b: Vec2Like) => Vec2Buffer;
    immutable: (a: Vec2, b: Vec2) => Vec2;
  }[] = [
    {
      name: "copy",
      into: (out, a) => Vec2.copyInto(out, a),
      immutable: (a) => a,
    },
    { name: "add", into: Vec2.addInto, immutable: (a, b) => a.add(b) },
    { name: "sub", into: Vec2.subInto, immutable: (a, b) => a.sub(b) },
    {
      name: "scale",
      into: (out, a) => Vec2.scaleInto(out, a, -2),
      immutable: (a) => a.scale(-2),
    },
    {
      name: "multiply",
      into: Vec2.multiplyInto,
      immutable: (a, b) => a.multiply(b),
    },
    {
      name: "normalize",
      into: (out, a) => Vec2.normalizeInto(out, a),
      immutable: (a) => a.normalize(),
    },
    {
      name: "lerp",
      into: (out, a, b) => Vec2.lerpInto(out, a, b, 1.5),
      immutable: (a, b) => a.lerp(b, 1.5),
    },
    {
      name: "rotate",
      into: (out, a) => Vec2.rotateInto(out, a, 0.7),
      immutable: (a) => a.rotate(0.7),
    },
    {
      name: "moveTowards",
      into: (out, a, b) => Vec2.moveTowardsInto(out, a, b, 2),
      immutable: (a, b) => Vec2.moveTowards(a, b, 2),
    },
  ];

  for (const operation of operations) {
    for (const alias of ["neither", "first", "second"] as const) {
      it(`${operation.name} matches immutable math when output aliases ${alias} input`, () => {
        const a = new Vec2Buffer(3, -4);
        const b = new Vec2Buffer(-8, 7);
        const expected = operation.immutable(
          new Vec2(a.x, a.y),
          new Vec2(b.x, b.y),
        );
        const out =
          alias === "first" ? a : alias === "second" ? b : new Vec2Buffer();
        expect(operation.into(out, a, b)).toBe(out);
        expect([out.x, out.y]).toEqual([expected.x, expected.y]);
      });
    }
  }

  it("fromAngle matches its immutable default and supplied length", () => {
    const out = new Vec2Buffer();
    for (const length of [undefined, 0, -3, 4]) {
      expect(Vec2.fromAngleInto(out, 0.4, length)).toBe(out);
      const expected = Vec2.fromAngle(0.4, length);
      expect([out.x, out.y]).toEqual([expected.x, expected.y]);
    }
  });

  it("normalization and movement preserve zero, epsilon and maxDelta behavior", () => {
    const out = new Vec2Buffer();
    for (const source of [Vec2.ZERO, new Vec2(1e-8, 0)]) {
      Vec2.normalizeInto(out, source);
      expect([out.x, out.y]).toEqual([0, 0]);
    }
    for (const target of [Vec2.ZERO, new Vec2(1e-8, 0), new Vec2(3, 4)]) {
      for (const delta of [-2, 0, 2, 5, 10]) {
        const expected = Vec2.moveTowards(Vec2.ZERO, target, delta);
        Vec2.moveTowardsInto(out, Vec2.ZERO, target, delta);
        expect([out.x, out.y]).toEqual([expected.x, expected.y]);
      }
    }
    expect([Vec2.ZERO.x, Vec2.ZERO.y]).toEqual([0, 0]);
    expect([Vec2.ONE.x, Vec2.ONE.y]).toEqual([1, 1]);
  });
});
