import type { StepContext } from "./types.js";

/**
 * A number, or a function resolved once at a fixed moment (snapshot
 * semantics — the resolved value is kept, not re-read afterwards). Mirrors
 * `HitSpec` and `Aim`, the addon's other `T | ((ctx: StepContext) => T)`
 * unions. A stats or equipment system integrates by closing over its own API
 * in the function, e.g. `cooldown: (ctx) => baseCd / haste(ctx.entity)` — the
 * addon owns no attribute contract.
 */
export type Scalar = number | ((ctx: StepContext) => number);

/** Resolve a `Scalar` against `ctx`. A plain number passes through unchanged. */
export function resolveScalar(value: Scalar, ctx: StepContext): number {
  return typeof value === "function" ? value(ctx) : value;
}
