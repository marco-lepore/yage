import type { Container } from "pixi.js";
import type { MaskHandle } from "./MaskHandle.js";
import type { MaskFactory } from "./MaskFactory.js";

/**
 * Apply a mask to any pixi `Container`. Returns a {@link MaskHandle} that
 * controls the mask's lifecycle and inverse state.
 *
 * The high-level `setMask` methods on the visual components, `RenderLayer`,
 * and `SceneRenderTree` are thin wrappers around this — use those when you
 * have one of those targets in hand. Reach for `attachMask` directly when
 * you only have a raw `Container` (e.g. `UIPanel` masking its own root).
 *
 * Idempotent on `remove()`. The handle's `setInverse` toggles
 * pixi v8 `Container.setMask({ mask, inverse })`.
 */
export function attachMask(
  target: Container,
  factory: MaskFactory,
): MaskHandle {
  const mask = factory();
  let inverse = mask.inverse;
  let removed = false;

  if (mask.attachToTarget) {
    target.addChild(mask.node);
  }
  target.setMask({ mask: mask.node, inverse });

  return {
    remove(): void {
      if (removed) return;
      removed = true;
      target.setMask({ mask: null, inverse: false });
      // Container.destroy() handles removeFromParent itself in pixi v8.
      if (mask.owned) mask.node.destroy();
    },
    setInverse(on: boolean): void {
      if (removed) return;
      inverse = on;
      target.setMask({ mask: mask.node, inverse });
    },
    get inverse(): boolean {
      return inverse;
    },
    redraw(): void {
      if (removed) return;
      mask.redraw?.();
    },
  };
}
