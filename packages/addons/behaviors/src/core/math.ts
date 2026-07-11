import { Vec2 } from "@yagejs/core";

/** Read a static value or a live provider — used for targets, obstacles, neighbors. */
export function resolve<T>(source: T | (() => T)): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/** Clamp a vector's magnitude to `max`, preserving direction. */
export function clampMagnitude(v: Vec2, max: number): Vec2 {
  const len = v.length();
  if (len <= max) return v;
  return v.scale(max / len);
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
