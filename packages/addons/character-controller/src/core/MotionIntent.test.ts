import { expect, it } from "vitest";
import { resolveMotion } from "./MotionIntent.js";
import type { MotionIntent } from "./MotionIntent.js";
const intent = (overrides: Partial<MotionIntent> = {}): MotionIntent => ({
  source: "move",
  axis: "x",
  target: 190,
  acceleration: 1000,
  shed: 340,
  priority: 0,
  ...overrides,
});
it("sheds carried momentum slowly only while holding in its direction", () => {
  expect(resolveMotion([intent()], { x: 520, y: 12 }, 0.1)).toMatchObject({
    x: 486,
    y: 12,
  });
  expect(resolveMotion([intent({ target: 0 })], { x: 520, y: 0 }, 0.1).x).toBe(
    420,
  );
  expect(
    resolveMotion([intent({ target: -190 })], { x: 520, y: 0 }, 0.1).x,
  ).toBe(420);
});
it("resolves axes independently and rejects winning ties", () => {
  expect(
    resolveMotion(
      [
        intent(),
        intent({
          source: "jump",
          axis: "y",
          target: -300,
          acceleration: Infinity,
        }),
      ],
      { x: 0, y: 0 },
      0.1,
    ),
  ).toMatchObject({ x: 100, y: -300 });
  expect(() =>
    resolveMotion([intent(), intent({ source: "other" })], { x: 0, y: 0 }, 0.1),
  ).toThrow(/all claim x/);
});
it("changes support without adding the previous platform velocity twice", () => {
  expect(
    resolveMotion(
      [intent({ frame: "surface", target: 0, acceleration: Infinity })],
      { x: 80, y: 0 },
      0.1,
      { x: -40, y: 0, previousX: 80, previousY: 0 },
    ).x,
  ).toBe(-40);
});
it("inherits only upward platform motion on launch", () => {
  const jump = intent({
    axis: "y",
    frame: "launch",
    target: -434,
    acceleration: Infinity,
  });
  expect(
    resolveMotion([jump], { x: 0, y: 0 }, 0.1, {
      x: 0,
      y: -100,
      previousX: 0,
      previousY: 0,
    }).y,
  ).toBe(-534);
  expect(
    resolveMotion([jump], { x: 0, y: 0 }, 0.1, {
      x: 0,
      y: 100,
      previousX: 0,
      previousY: 0,
    }).y,
  ).toBe(-434);
});
it("zero time preserves velocity even with infinite rates and a new support", () => {
  expect(
    resolveMotion(
      [intent({ acceleration: Infinity, frame: "surface" })],
      { x: 4, y: 5 },
      0,
      { x: 100, y: 0, previousX: 0, previousY: 0 },
    ),
  ).toMatchObject({ x: 4, y: 5 });
});
it.each([NaN, Infinity, -1])("rejects invalid time %s", (dt) => {
  expect(() => resolveMotion([], { x: 0, y: 0 }, dt)).toThrow(/dt/);
});
