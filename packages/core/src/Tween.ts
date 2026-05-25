import {
  Process,
  easeLinear,
} from "./Process.js";
import { Sequence } from "./Sequence.js";
import { Vec2 } from "./Vec2.js";
import type { Vec2Like } from "./Vec2.js";
import type { EasingFunction } from "./types.js";

/** Static factory for creating tween Processes. */
export const Tween = {
  /** Tween a numeric property on a target object. */
  to(
    target: Record<string, number>,
    property: string,
    to: number,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    const from = target[property] ?? 0;
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = Math.min(elapsed / duration, 1);
        target[property] = from + (to - from) * easing(t);
      },
    });
  },

  /** Tween using a custom setter. */
  custom(
    setter: (value: number) => void,
    from: number,
    to: number,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = Math.min(elapsed / duration, 1);
        setter(from + (to - from) * easing(t));
      },
    });
  },

  /** Tween a Vec2 value. */
  vec2(
    setter: (value: Vec2) => void,
    from: Vec2Like,
    to: Vec2Like,
    duration: number,
    easing: EasingFunction = easeLinear,
  ): Process {
    return new Process({
      duration,
      update: (_dt, elapsed) => {
        const t = Math.min(elapsed / duration, 1);
        const e = easing(t);
        setter(
          new Vec2(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e),
        );
      },
    });
  },

  /**
   * Map a Process factory over an array, staggering each item's START by
   * `stepMs` (item 0 starts immediately, item 1 after `stepMs`, and so on).
   * Returns one Process per item — enqueue them all on a process queue (or
   * `useSplitText`'s `run`) to play a staggered cascade across a split text's
   * `chars` / `words` / `lines`. The factory runs when each item's turn
   * begins, so a `Tween.to` built inside it reads its `from` value at start
   * time, not build time.
   */
  stagger<T>(
    items: readonly T[],
    factory: (item: T, index: number) => Process,
    stepMs: number,
  ): Process[] {
    return items.map((item, i) => {
      const seq = new Sequence();
      if (i > 0 && stepMs > 0) seq.wait(i * stepMs);
      return seq.then(() => factory(item, i)).start();
    });
  },
};
