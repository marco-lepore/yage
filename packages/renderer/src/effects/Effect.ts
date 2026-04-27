import type { Container, Filter } from "pixi.js";
import type { EffectHandle } from "./EffectHandle.js";

/**
 * Scope identifier for an effect target. Passed to `Effect.onAttach` so
 * factories can specialize behavior per scope (e.g. clamp size to viewport
 * on `screen`, no-op on `component`).
 */
export type EffectScope = "component" | "layer" | "scene" | "screen";

/** Context passed to `Effect.onAttach`. */
export interface EffectTarget {
  /** The pixi container the effect's filter is attached to. */
  readonly displayObject: Container;
  /** Which kind of scope owns the host stack. */
  readonly scope: EffectScope;
}

/**
 * The shape an effect factory returns. The renderer's `EffectStack` consumes
 * this to build the user-facing `EffectHandle`.
 *
 * Factories own:
 * - the `Filter` they push onto `target.filters`,
 * - the `getIntensity` / `setIntensity` accessors used by `fadeIn` / `fadeOut`,
 * - any factory-specific extras spread onto the handle via `buildExtras`.
 *
 * `getIntensity` / `setIntensity` should target the effect's most natural
 * "strength" axis (BloomFilter `strength`, OutlineFilter `thickness`, etc).
 * For shader-style effects with no clean scalar, route through the filter's
 * built-in `alpha` uniform — every pixi `Filter` carries one and it scales
 * the filter's whole contribution.
 */
export interface Effect<H extends EffectHandle = EffectHandle> {
  /**
   * The pixi filter (or chain of filters) pushed onto the target's `filters`
   * array. A single `Filter` is the common case; pass an array when an
   * effect needs more than one pass — e.g. a shader filter wrapped in an
   * `AlphaFilter` for fade. Order matters: pixi processes filters in array
   * order, so each later filter sees the previous one's output.
   */
  filter: Filter | Filter[];
  /** Read the current primary intensity. */
  getIntensity(): number;
  /** Set the primary intensity. */
  setIntensity(value: number): void;
  /** Optional setup callback fired after the filter is attached. */
  onAttach?(target: EffectTarget): void;
  /** Optional teardown callback fired before the filter is detached. */
  onDetach?(): void;
  /**
   * Optional factory for typed extras spread onto the final handle. Receives
   * the base `EffectHandle` so extras can compose against `remove` / `setEnabled` /
   * `fadeIn` / `fadeOut` / `run` if needed.
   *
   * **Pure at call time.** Return closures freely — they're invoked by user
   * code later and may have side effects then (e.g. `hitFlash.trigger()`
   * calls `base.run(...)` from inside the closure). What this hook should
   * NOT do is invoke side effects *eagerly* during the `buildExtras` call
   * itself — no `base.run(...)`, no scheduling, no external-state mutation
   * at build time. Use `onActivate` for attach-time side effects.
   */
  buildExtras?(base: EffectHandle): Omit<H, keyof EffectHandle>;
  /**
   * Optional activation callback fired once the handle is fully built (after
   * `buildExtras` has merged its keys onto the handle). Use this to schedule
   * per-effect `Process`es via `base.run(...)` — they are auto-cancelled when
   * the effect is removed. The right place for self-scheduled tickers (e.g.
   * a shader-uniform animator) so callers don't have to wire `step(dt)`.
   */
  onActivate?(base: EffectHandle): void;
}

/**
 * Zero-argument constructor for an `Effect`. User-facing factories like
 * `hitFlash(opts)` close over their options and return an `EffectFactory`.
 * The renderer calls the factory once at attach time.
 */
export type EffectFactory<H extends EffectHandle = EffectHandle> = () => Effect<H>;
