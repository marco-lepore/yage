import {
  Process,
  easeLinear,
} from "./Process.js";
import { assertDuration, durationProgress } from "./internal/duration.js";
import { Sequence } from "./Sequence.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";
import type { EasingFunction } from "./types.js";

/** Static factory for creating tween Processes. */
export const Tween = {
  /** Tween a numeric property on a target object. `duration` is in seconds, finite and > 0; both endpoints must be finite. */
  to(
    target: Record<string, number>,
    property: string,
    to: number,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    assertDuration("Tween.to", duration);
    const from = target[property] ?? 0;
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(
        `Tween.to: "${property}" must tween between finite values, got ${from} -> ${to}.`,
      );
    }
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = durationProgress(elapsed, duration);
        target[property] = from + (to - from) * easing(t);
      },
    });
  },

  /** Tween using a custom setter. `duration` is in seconds, finite and > 0; both endpoints must be finite. */
  custom(
    setter: (value: number) => void,
    from: number,
    to: number,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    assertDuration("Tween.custom", duration);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new Error(
        `Tween.custom: from and to must be finite, got ${from} -> ${to}.`,
      );
    }
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = durationProgress(elapsed, duration);
        setter(from + (to - from) * easing(t));
      },
    });
  },

  /** Tween a Vec2 value. `duration` is in seconds, finite and > 0; both endpoints must be finite. */
  vec2(
    setter: (value: Vec2) => void,
    from: Vec2Like,
    to: Vec2Like,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    assertDuration("Tween.vec2", duration);
    if (
      !Number.isFinite(from.x) ||
      !Number.isFinite(from.y) ||
      !Number.isFinite(to.x) ||
      !Number.isFinite(to.y)
    ) {
      throw new Error(
        `Tween.vec2: from and to must be finite, got (${from.x}, ${from.y}) -> (${to.x}, ${to.y}).`,
      );
    }
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = durationProgress(elapsed, duration);
        const e = easing(t);
        setter(
          new Vec2(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e),
        );
      },
    });
  },

  /**
   * Map a Process factory over an array, staggering each item's START by
   * `stepSeconds` (item 0 starts immediately, item 1 after `stepSeconds`, and
   * so on). Returns one Process per item — enqueue them all on a process queue
   * (or `useSplitText`'s `run`) to play a staggered cascade across a split
   * text's `chars` / `words` / `lines`. The factory runs when each item's turn
   * begins, so a `Tween.to` built inside it reads its `from` value at start
   * time, not build time.
   *
   * `stepSeconds` must be finite and >= 0. Zero is allowed and starts every
   * item at once.
   */
  stagger<T>(
    items: readonly T[],
    factory: (item: T, index: number) => Process,
    stepSeconds: number,
  ): Process[] {
    if (!Number.isFinite(stepSeconds) || stepSeconds < 0) {
      throw new Error(
        `Tween.stagger: stepSeconds must be a finite number >= 0 in seconds, got ${stepSeconds}.`,
      );
    }
    return items.map((item, i) => {
      const seq = new Sequence();
      if (i > 0 && stepSeconds > 0) seq.wait(i * stepSeconds);
      return seq.then(() => factory(item, i)).start();
    });
  },
};
