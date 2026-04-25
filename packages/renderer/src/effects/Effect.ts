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
 * If the effect has no scalar that maps cleanly, return a constant from
 * `getIntensity` and no-op `setIntensity` — users who want fade can opt into
 * an `AlphaFilter` wrapper via the renderer's `withFade` helper.
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
   * `fadeIn` / `fadeOut` if needed.
   */
  buildExtras?(base: EffectHandle): Omit<H, keyof EffectHandle>;
}

/**
 * Zero-argument constructor for an `Effect`. User-facing factories like
 * `hitFlash(opts)` close over their options and return an `EffectFactory`.
 * The renderer calls the factory once at attach time.
 */
export type EffectFactory<H extends EffectHandle = EffectHandle> = () => Effect<H>;
