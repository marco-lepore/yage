import type { Component } from "@yagejs/core";
import type { DisplayContainer as Container } from "../public-types.js";
import type { MaskHandle } from "./MaskHandle.js";
import type { MaskFactory } from "./MaskFactory.js";
import { attributed, boundaryFor } from "../internal/attribution.js";

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
 *
 * Pass `owner` when a component holds the mask: a throw from the game's own
 * draw callback is then attributed to the callback (readable via
 * `Inspector.getErrors().callbackErrors`) instead of to whichever engine pass
 * triggered the redraw.
 */
export function attachMask(
  target: Container,
  factory: MaskFactory,
  owner?: Component,
): MaskHandle {
  const info = { kind: "Mask draw callback" };
  const boundary = owner ? boundaryFor(owner) : undefined;
  const mask = attributed(boundary, info, factory);
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
      // Pixi v8 quirk: `setMask({ mask: null, inverse: false })` only
      // updates the cached `_maskOptions`; it leaves the live mask effect
      // pointing at our (about-to-be-destroyed) node, so the next render
      // dereferences a freed `_gpuData` and crashes. Direct
      // `target.mask = null` runs the proper teardown — `removeEffect()`
      // + `MaskEffectManager.returnMaskEffect()` — which is what we want.
      target.mask = null;
      if (mask.owned) {
        // Detach BEFORE destroy so the previous parent (could be the
        // target, the target's parent, or a layer container) drops its
        // children-list reference before pixi tears down GPU resources.
        // `Container.destroy()` does call `removeFromParent`, but doing
        // it explicitly first avoids any lingering structure-changed
        // refs in the render group from the same frame.
        mask.node.removeFromParent();
        mask.node.destroy();
      }
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
      if (removed || !mask.redraw) return;
      const redraw = mask.redraw.bind(mask);
      attributed(boundary, info, redraw);
    },
  };
}
