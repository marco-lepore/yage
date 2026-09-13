/**
 * Field-wise copy of an emitter's emission options. An emitter reads its
 * configuration at every spawn and, for some options, at every frame, so a
 * value it keeps by reference is a value the caller can still change
 * afterwards. Only options whose value can be an object are copied; numbers and
 * strings carry over as they are. The check at the end of this file fails the
 * build when `EmitterOptions` gains an object-valued option that no case here
 * handles.
 */

import { isLerped } from "./types.js";
import type { EmitterOptions, Lerped, NumberRange } from "./types.js";

/** Options typed `NumberRange`, so a `[min, max]` array can be shared. */
const RANGE_OPTIONS = [
  "lifetime",
  "speed",
  "angle",
  "rotation",
  "rotationSpeed",
  "radialSpeed",
] as const satisfies readonly (keyof EmitterOptions)[];

/** Options that are a `NumberRange` or a `Lerped` pair of them. */
const LERPABLE_OPTIONS = [
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

/** True when any member of `T` is an object, so a caller can still change it. */
type HoldsAnObject<T> = true extends (T extends object ? true : false)
  ? true
  : false;

/** The options of `EmitterOptions` whose value can be an object. */
type ObjectValuedOption = {
  [K in keyof EmitterOptions]-?: HoldsAnObject<
    Exclude<EmitterOptions[K], undefined>
  > extends true
    ? K
    : never;
}[keyof EmitterOptions];

/** The options `copyOptions` handles by name. */
type CopiedOption =
  | (typeof RANGE_OPTIONS)[number]
  | (typeof LERPABLE_OPTIONS)[number]
  | "gravity"
  | "spawnOffset";

type MustBeNever<T extends never> = T;

/**
 * Every object-valued option is copied. An option added to `EmitterOptions`
 * without a case above fails the typecheck here, naming the option it left out.
 * Exported so the compiler counts this alias as used.
 */
export type EveryObjectValuedOptionIsCopied = MustBeNever<
  Exclude<ObjectValuedOption, CopiedOption>
>;
