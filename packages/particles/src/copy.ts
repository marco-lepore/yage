/**
 * Field-wise copy of an emitter's options. An emitter reads its configuration
 * at every spawn and every frame, so any value it holds by reference is a value
 * the caller can still change behind its back. Only the options whose value can
 * be an object are copied; numbers, strings and the texture source are carried
 * over as they are, because a texture is a renderer resource rather than data.
 */

import { isLerped } from "./types.js";
import type { EmitterOptions, Lerped, NumberRange } from "./types.js";

/** Options typed `NumberRange`, so a `[min, max]` array can be shared. */
export const RANGE_OPTIONS = [
  "lifetime",
  "speed",
  "angle",
  "rotation",
  "rotationSpeed",
  "radialSpeed",
] as const satisfies readonly (keyof EmitterOptions)[];

/** Options that are a `NumberRange` or a `Lerped` pair of them. */
export const LERPABLE_OPTIONS = [
  "scale",
  "alpha",
] as const satisfies readonly (keyof EmitterOptions)[];

function copyRange(value: NumberRange): NumberRange {
  return Array.isArray(value) ? [value[0], value[1]] : value;
}

function copyLerpable(value: NumberRange | Lerped): NumberRange | Lerped {
  if (isLerped(value)) {
    return { start: copyRange(value.start), end: copyRange(value.end) };
  }
  return copyRange(value);
}

/** Copy `options`, replacing every value the caller could still mutate. */
export function copyOptions<T extends Partial<EmitterOptions>>(options: T): T {
  const copy = { ...options } as Partial<EmitterOptions>;

  for (const key of RANGE_OPTIONS) {
    const value = copy[key];
    if (value !== undefined) copy[key] = copyRange(value);
  }

  for (const key of LERPABLE_OPTIONS) {
    const value = copy[key];
    if (value !== undefined) copy[key] = copyLerpable(value);
  }

  const { gravity, spawnOffset } = copy;
  if (gravity !== undefined) copy.gravity = { x: gravity.x, y: gravity.y };
  // Built key by key: `exactOptionalPropertyTypes` rejects an explicit
  // `undefined`, and the two offset forms exclude each other's members.
  if (spawnOffset !== undefined) {
    if (spawnOffset.radius !== undefined) {
      const ring: { radius: NumberRange; angle?: NumberRange } = {
        radius: copyRange(spawnOffset.radius),
      };
      if (spawnOffset.angle !== undefined) {
        ring.angle = copyRange(spawnOffset.angle);
      }
      copy.spawnOffset = ring;
    } else {
      const rect: { x?: NumberRange; y?: NumberRange } = {};
      if (spawnOffset.x !== undefined) rect.x = copyRange(spawnOffset.x);
      if (spawnOffset.y !== undefined) rect.y = copyRange(spawnOffset.y);
      copy.spawnOffset = rect;
    }
  }

  return copy as T;
}

function rangesMatch(
  a: NumberRange | undefined,
  b: NumberRange | undefined,
): boolean {
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

function lerpablesMatch(
  a: NumberRange | Lerped | undefined,
  b: NumberRange | Lerped | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  const aLerped = isLerped(a);
  if (aLerped !== isLerped(b)) return false;
  if (aLerped) {
    const left = a as Lerped;
    const right = b as Lerped;
    return (
      rangesMatch(left.start, right.start) && rangesMatch(left.end, right.end)
    );
  }
  return rangesMatch(a as NumberRange, b as NumberRange);
}

/**
 * The first option whose value in `source` no longer matches `snapshot`, or
 * `null` when every one still does. Only options that can hold an object are
 * compared, because those are the only ones a caller can change after handing
 * them over. Missing an option here costs a missed report, never a wrong one.
 */
export function findChangedOption(
  source: Partial<EmitterOptions>,
  snapshot: Partial<EmitterOptions>,
): string | null {
  for (const key of RANGE_OPTIONS) {
    if (!rangesMatch(source[key], snapshot[key])) return key;
  }
  for (const key of LERPABLE_OPTIONS) {
    if (!lerpablesMatch(source[key], snapshot[key])) return key;
  }

  const gravity = source.gravity;
  const snapshotGravity = snapshot.gravity;
  if ((gravity === undefined) !== (snapshotGravity === undefined)) {
    return "gravity";
  }
  if (
    gravity !== undefined &&
    snapshotGravity !== undefined &&
    (gravity.x !== snapshotGravity.x || gravity.y !== snapshotGravity.y)
  ) {
    return "gravity";
  }

  const offset = source.spawnOffset;
  const snapshotOffset = snapshot.spawnOffset;
  if ((offset === undefined) !== (snapshotOffset === undefined)) {
    return "spawnOffset";
  }
  if (offset !== undefined && snapshotOffset !== undefined) {
    const same =
      rangesMatch(offset.radius, snapshotOffset.radius) &&
      rangesMatch(offset.angle, snapshotOffset.angle) &&
      rangesMatch(offset.x, snapshotOffset.x) &&
      rangesMatch(offset.y, snapshotOffset.y);
    if (!same) return "spawnOffset";
  }

  return null;
}
