import {
  Process,
  easeLinear,
} from "./Process.js";
import { Vec2 } from "./Vec2.js";
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
    from: Vec2,
    to: Vec2,
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
};
