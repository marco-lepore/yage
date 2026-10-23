import type { Vec2Like } from "@yagejs/core";
import { assertFiniteNumber } from "./validate.js";

/** A Pixi anchor or pivot, which visual components expose as plain points. */
interface PixiPoint {
  readonly x: number;
  readonly y: number;
  set(x: number, y: number): unknown;
}

/** Copy a Pixi point into a new plain object, so the caller cannot move it. */
export function readPoint(point: PixiPoint): Vec2Like {
  return { x: point.x, y: point.y };
}

/**
 * Write `value` into a Pixi point, throwing on a non-finite coordinate. The
 * error names `context` and the coordinate as `<name>.x` or `<name>.y`.
 */
export function writePoint(
  context: string,
  name: string,
  point: PixiPoint,
  value: Vec2Like,
): void {
  assertFiniteNumber(context, `${name}.x`, value.x);
  assertFiniteNumber(context, `${name}.y`, value.y);
  point.set(value.x, value.y);
}
