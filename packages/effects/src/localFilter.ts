import type { EffectTarget } from "@yagejs/renderer";
import type { Container, Filter } from "pixi.js";
import { targetScale } from "./filterTarget.js";
import type { TargetScale } from "./filterTarget.js";
import { validateFinite, validateMinimum } from "./validate.js";

/** Convert a length without allowing overflow into filter state. @internal */
export function scaled(value: number, scale: number): number {
  return validateFinite("effects", "scaled length", value * scale);
}

/**
 * Bind dimensional uniforms and padding to the same live transform. Pixi reads
 * padding before allocating the input texture; apply() is too late to resize it.
 * Local values belong to the preset, so rendering never changes fade state.
 * @internal
 */
export function localFilter(
  filter: Filter,
  sync: (scale: TargetScale) => void,
  padding: (scale: TargetScale) => number,
): {
  onAttach(target: EffectTarget): void;
  onDetach(): void;
  update(): void;
} {
  let target: Container | undefined;
  const update = (): void => sync(targetScale(target));
  const apply = filter.apply;
  filter.apply = (manager, input, output, clear) => {
    update();
    apply.call(filter, manager, input, output, clear);
  };
  Object.defineProperty(filter, "padding", {
    configurable: true,
    get: () =>
      Math.ceil(
        validateMinimum("effects", "padding", padding(targetScale(target)), 0),
      ),
    // Upstream setters also assign heuristic padding. The preset's sampling
    // calculation is authoritative and does not depend on those assignments.
    set: () => {},
  });
  return {
    onAttach: ({ displayObject }) => {
      target = displayObject;
    },
    onDetach: () => {
      target = undefined;
    },
    update,
  };
}

/** Sum the reach of Kawase passes, including bilinear sampling. @internal */
export function kawasePadding(
  blur: number,
  quality: number,
  scale: number,
): number {
  // Scaling pixelSize scales the half-pixel tap offset as well as the kernel.
  const passes = blur === 0 ? 1 : quality;
  return scaled((blur * (passes + 1)) / 2 + passes * 0.5, scale) + passes;
}

/** Reach of Pixi's Gaussian passes with their halving strength schedule. @internal */
export function gaussianPadding(
  strength: number,
  quality: number,
  kernelSize: number,
): number {
  if (strength === 0) return 0;
  const sum = 2 * (1 - 2 ** -quality);
  const sumSquares = (4 / 3) * (1 - 4 ** -quality);
  return (
    (Math.abs(strength) * ((kernelSize - 1) / 2) * sum) /
      Math.sqrt(sumSquares) +
    quality
  );
}
