/**
 * What an emitter takes from an options object a caller passes in.
 *
 * `pickOptions` keeps the options a method accepts and drops every other key.
 * TypeScript reports an extra key only when an object literal names it, so
 * `configure({ ...ParticlePresets.fire() })` compiles and passes the preset's
 * `maxParticles` and shape to `configure`.
 *
 * `copyOptions` is a field-wise copy. An emitter reads its configuration at
 * every spawn and, for some options, at every frame, so a value it keeps by
 * reference is a value the caller can still change afterwards. Only options
 * whose value can be an object are copied; numbers and strings carry over as
 * they are.
 *
 * The checks at the end of this file fail the build when `EmitterOptions` gains
 * an object-valued option that no case here handles, and when `BurstOverrides`
 * or `EmitterUpdateOptions` stops matching its key list.
 */

import { isLerped } from "./types.js";
import type {
  BurstOverrides,
  EmitterOptions,
  EmitterUpdateOptions,
  Lerped,
  NumberRange,
} from "./types.js";

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

/** The options a burst reads from its overrides. */
export const BURST_OVERRIDE_OPTIONS = [
  "lifetime",
  "speed",
  "angle",
  "scale",
  "alpha",
  "rotation",
  "rotationSpeed",
  "tint",
  "spawnOffset",
  "radialSpeed",
] as const satisfies readonly (keyof BurstOverrides)[];

/**
 * The options `configure` reads: a burst's, the ones read every frame, and
 * `blendMode`, which the container holds.
 */
export const UPDATE_OPTIONS = [
  ...BURST_OVERRIDE_OPTIONS,
  "rate",
  "gravity",
  "damping",
  "blendMode",
  "alphaFadeIn",
  "alphaFadeOut",
] as const satisfies readonly (keyof EmitterUpdateOptions)[];

/**
 * The entries of `options` whose key is in `keys`. A key `options` does not
 * have stays absent, so spreading the result over a configuration keeps that
 * configuration's value.
 */
export function pickOptions<T extends object, K extends keyof T>(
  options: T,
  keys: readonly K[],
): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.hasOwn(options, key)) picked[key] = options[key];
  }
  return picked;
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

/**
 * Each key list names every key of its type. A key added to `BurstOverrides` or
 * `EmitterUpdateOptions` without a list entry fails the typecheck here, with
 * an error that names the key. A list entry its type no longer has fails at
 * the list's `satisfies`. Exported so the compiler counts these aliases as
 * used.
 */
export type EveryBurstOverrideIsListed = MustBeNever<
  Exclude<keyof BurstOverrides, (typeof BURST_OVERRIDE_OPTIONS)[number]>
>;
export type EveryUpdateOptionIsListed = MustBeNever<
  Exclude<keyof EmitterUpdateOptions, (typeof UPDATE_OPTIONS)[number]>
>;
