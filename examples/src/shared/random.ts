/**
 * Random helpers for examples. The engine already ships a deterministic RNG:
 * resolve the scene-scoped `RandomKey` (seeded by the e2e harness) via
 * `Component.use(RandomKey)`, or call `createRandomService(seed)` for a
 * standalone stream — both from `@yagejs/core`. This module only adds what
 * core lacks; it does not reimplement a PRNG.
 */
import type { RandomService } from "@yagejs/core";

/** Pick a random color from a palette of hex values. */
export function randomColor(
  rng: RandomService,
  colors: readonly number[],
): number {
  return rng.pick(colors);
}
