/**
 * Numeric gates for game-supplied values entering the simulation. Each
 * throws a plain `Error` naming the input and the constraint it violates,
 * before anything is stored, so a `NaN` never reaches a body or collider.
 */

import type { ColliderShape } from "./types.js";

/**
 * Throws unless `value` is `undefined` (optional field), or a finite number
 * that is at least `min` when a minimum is given.
 */
export function assertFiniteNumber(
  context: string,
  name: string,
  value: number | undefined,
  min?: number,
): void {
  if (value === undefined) return;
  assertRequiredFinite(context, name, value, min);
}

/**
 * Required-field form of {@link assertFiniteNumber}: a missing value fails
 * like any other unusable one, so a field left out reaches Rapier as the
 * named error rather than as `NaN`.
 */
export function assertRequiredFinite(
  context: string,
  name: string,
  value: number,
  min?: number,
): void {
  const belowMin = min !== undefined && value < min;
  if (Number.isFinite(value) && !belowMin) return;
  const constraint =
    min === undefined ? "must be finite" : `must be finite and >= ${min}`;
  throw new Error(`${context}: ${name} ${constraint}, got ${value}.`);
}

/** Throws unless `value` is a finite number above 0. */
export function assertPositiveNumber(
  context: string,
  name: string,
  value: number,
): void {
  if (Number.isFinite(value) && value > 0) return;
  throw new Error(`${context}: ${name} must be finite and > 0, got ${value}.`);
}

/** Throws unless `pixelsPerMeter` is `undefined` or a finite number above 0. */
export function assertPixelsPerMeter(
  context: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (Number.isFinite(value) && value > 0) return;
  throw new Error(
    `${context}: pixelsPerMeter must be finite and > 0, got ${value}.`,
  );
}

/**
 * Throws unless `shape` can be built: every dimension finite and above 0
 * (a capsule's `halfHeight` may be 0 — that is a circle), a box border
 * radius smaller than half the shorter side, at least 3 polygon vertices
 * not all on one line, at least 2 polyline vertices, every vertex finite.
 * Rapier accepts each of these inputs and fails later — a zero or negative
 * extent gives a body zero or negative mass, a non-finite one writes `NaN`
 * into every position it touches, and a degenerate hull traps the WASM
 * module inside `createCollider`.
 */
export function assertColliderShape(
  context: string,
  shape: ColliderShape,
): void {
  switch (shape.type) {
    case "box": {
      assertPositiveNumber(context, "shape.width", shape.width);
      assertPositiveNumber(context, "shape.height", shape.height);
      const radius = shape.borderRadius;
      if (radius === undefined) return;
      const limit = Math.min(shape.width, shape.height) / 2;
      if (Number.isFinite(radius) && radius >= 0 && radius < limit) return;
      throw new Error(
        `${context}: shape.borderRadius must be finite, >= 0 and smaller than half the shorter side, got ${radius}.`,
      );
    }
    case "circle":
      assertPositiveNumber(context, "shape.radius", shape.radius);
      return;
    case "capsule":
      assertPositiveNumber(context, "shape.radius", shape.radius);
      assertRequiredFinite(context, "shape.halfHeight", shape.halfHeight, 0);
      return;
    case "polygon":
      assertVertices(context, shape.vertices, 3);
      if (allOnOneLine(shape.vertices)) {
        throw new Error(
          `${context}: shape.vertices must not all lie on one line.`,
        );
      }
      return;
    case "polyline":
      assertVertices(context, shape.vertices, 2);
      return;
  }
}

function assertVertices(
  context: string,
  vertices: ReadonlyArray<{ x: number; y: number }>,
  min: number,
): void {
  if (vertices.length < min) {
    throw new Error(
      `${context}: shape.vertices must have at least ${min} vertices, got ${vertices.length}.`,
    );
  }
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    assertRequiredFinite(context, `shape.vertices[${i}].x`, v.x);
    assertRequiredFinite(context, `shape.vertices[${i}].y`, v.y);
  }
}

/**
 * True when every vertex lies on the line through the first vertex and the
 * first vertex that differs from it (or all vertices coincide). Exact zero
 * cross products only — a thin but genuine hull is Rapier's to build.
 */
function allOnOneLine(
  vertices: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  const origin = vertices[0]!;
  const second = vertices.find((v) => v.x !== origin.x || v.y !== origin.y);
  if (!second) return true;
  const dx = second.x - origin.x;
  const dy = second.y - origin.y;
  return vertices.every(
    (v) => dx * (v.y - origin.y) - dy * (v.x - origin.x) === 0,
  );
}
