import type { Hit, HitResult } from "./types.js";
import type { StandardHitData } from "./types.js";

/**
 * One step in a hit's resolution fold (team filter, i-frames, a guard, a
 * damage/reaction step, ...). Stages run in order; the first to return a
 * `HitResult` ends resolution with that result. A stage that returns
 * nothing (falls off the end, or a bare `return;`) lets resolution
 * continue — an all-void chain resolves to `"hit"`. Stages may mutate
 * `hit.data` in place (see `Hit`'s doc) — `resolveHit` never copies it, so
 * a shared `data` reference across multiple resolutions (multiple victims
 * of one delivery) must be copied before calling this, not after.
 */
export type HitStage<TData = StandardHitData, TCtx = unknown> = (
  hit: Hit<TData>,
  ctx: TCtx,
  // A pure union of `HitResult | undefined` forces every void-only stage
  // (most of them — team filter, i-frames, damage/reaction) to end with an
  // explicit `return undefined;`: TS requires a value-returning statement
  // whenever the declared return type isn't exactly `void`/`undefined`/
  // `any`, even when every real return is implicit. `void` reads naturally
  // for "this stage has nothing to say" and TS's void-return leniency
  // accepts a plain fall-through body here.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
) => HitResult | void;

/**
 * Fold `stages` over `hit` in order, stopping at the first non-void result.
 * Pure and headless — no component or entity lookups here; `ctx` is
 * whatever the caller's stages need (a `HitReceiver` instance, typically).
 */
export function resolveHit<TData, TCtx>(
  hit: Hit<TData>,
  stages: readonly HitStage<TData, TCtx>[],
  ctx: TCtx,
): HitResult {
  for (const stage of stages) {
    const result = stage(hit, ctx);
    if (result !== undefined) return result;
  }
  return "hit";
}
