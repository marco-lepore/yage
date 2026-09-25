/**
 * Built-in functions: callable from any condition, `set` value, or text
 * expression without installing them. They are Yarn Spinner's standard library
 * (minus `visited` / `visited_count`, which the Yarn front-end compiles to
 * variable reads), so a Yarn script's calls work unchanged and a JSON, YAML, or
 * compact script can use them too.
 *
 * A function installed on the controller or passed to `play()` under the same
 * name replaces the built-in. The random ones draw from the conversation's
 * random source (the scene's seeded `RandomService` under a controller).
 */

import type { RandomService } from "@yagejs/core";

import type { DialogueFunction, VarValue } from "./types.js";

function num(v: VarValue): number {
  return typeof v === "number" ? v : Number(v);
}

/** Display text for a value, the way `{token}` interpolation shows it. */
function text(v: VarValue): string {
  return v === null ? "" : String(v);
}

/** Round half to even ("banker's rounding"), as Yarn Spinner's `round` does:
 *  2.5 → 2, 3.5 → 4. */
function roundHalfEven(n: number): number {
  return Math.abs(n % 1) === 0.5 ? 2 * Math.round(n / 2) : Math.round(n);
}

/**
 * `format`'s pattern language: `{0}` is the value, `{0:F2}` fixed decimals,
 * `{0:N0}` grouped digits, `{0:D3}` zero-padded whole number, `{0:P1}` a
 * percentage; `{{` and `}}` are literal braces.
 */
function formatValue(pattern: string, value: VarValue): string {
  return pattern.replace(
    /\{\{|\}\}|\{0(?::([FNDP])(\d*))?\}/gi,
    (whole, spec: string | undefined, digits: string) => {
      if (whole === "{{") return "{";
      if (whole === "}}") return "}";
      if (spec === undefined) return text(value);
      const n = num(value);
      const places = digits === "" ? undefined : Number(digits);
      switch (spec.toUpperCase()) {
        case "F":
          return n.toFixed(places ?? 2);
        case "N":
          return n.toLocaleString(undefined, {
            minimumFractionDigits: places ?? 2,
            maximumFractionDigits: places ?? 2,
          });
        case "D":
          return (
            (n < 0 ? "-" : "") +
            String(Math.trunc(Math.abs(n))).padStart(places ?? 0, "0")
          );
        default:
          return `${(n * 100).toFixed(places ?? 2)}%`;
      }
    },
  );
}

/** The built-in functions, drawing randomness from `random`. */
export function createBuiltinFunctions(
  random: RandomService,
): Readonly<Record<string, DialogueFunction>> {
  /** A uniformly random integer in `[min, max]`, both inclusive. */
  const randomInt = (min: number, max: number): number =>
    random.int(Math.ceil(Math.min(min, max)), Math.floor(Math.max(min, max)));
  return Object.freeze({
    /** A random number in `[0, 1)`. */
    random: () => random.float(),
    /** A random whole number from `min` to `max`, both included. */
    random_range: (min, max) => randomInt(num(min ?? 0), num(max ?? 0)),
    /** A random number from `min` up to (not including) `max`. */
    random_range_float: (min, max) =>
      random.range(num(min ?? 0), num(max ?? 0)),
    /** A random whole number from 1 to `sides`, both included. */
    dice: (sides) => randomInt(1, num(sides ?? 1)),
    /** `n` rounded to the nearest whole number; halves go to the even one. */
    round: (n) => roundHalfEven(num(n ?? 0)),
    /** `n` rounded to `places` decimal places; halves go to the even digit. */
    round_places: (n, places) => {
      const factor = 10 ** Math.trunc(num(places ?? 0));
      return roundHalfEven(num(n ?? 0) * factor) / factor;
    },
    /** `n` rounded down. */
    floor: (n) => Math.floor(num(n ?? 0)),
    /** `n` rounded up. */
    ceil: (n) => Math.ceil(num(n ?? 0)),
    /** The next whole number above `n` (`n + 1` when `n` is whole). */
    inc: (n) => {
      const v = num(n ?? 0);
      return Number.isInteger(v) ? v + 1 : Math.ceil(v);
    },
    /** The next whole number below `n` (`n - 1` when `n` is whole). */
    dec: (n) => {
      const v = num(n ?? 0);
      return Number.isInteger(v) ? v - 1 : Math.floor(v);
    },
    /** The fractional part of `n`. */
    decimal: (n) => {
      const v = num(n ?? 0);
      return v - Math.trunc(v);
    },
    /** `n` with its fractional part dropped (rounds toward zero). */
    int: (n) => Math.trunc(num(n ?? 0)),
    /** The smaller of `a` and `b`. */
    min: (a, b) => Math.min(num(a ?? 0), num(b ?? 0)),
    /** The larger of `a` and `b`. */
    max: (a, b) => Math.max(num(a ?? 0), num(b ?? 0)),
    /** `v` as text. */
    string: (v) => text(v ?? null),
    /** `v` as a number (`NaN` when it isn't numeric text). */
    number: (v) => num(v ?? 0),
    /** `v` as a boolean: `"true"` / `"false"` text, else its truthiness. */
    bool: (v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return Boolean(v);
    },
    /** `n` as text with a `.` decimal separator whatever the locale. */
    format_invariant: (n) => String(num(n ?? 0)),
    /** `value` placed into `pattern`: `format("{0:F1} kg", 2.25)` → `"2.3 kg"`
     *  (`{0}`, `{0:F2}`, `{0:N0}`, `{0:D3}`, `{0:P0}`). */
    format: (pattern, value) => formatValue(text(pattern ?? ""), value ?? null),
  });
}

/** The built-in function names (what validation accepts as installed). */
export const BUILTIN_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.keys(
    createBuiltinFunctions({
      float: () => 0,
      range: (min) => min,
      int: (min) => min,
      pick: (arr) => arr[0]!,
      shuffle: (arr) => arr,
      getSeed: () => 0,
    }),
  ),
);
