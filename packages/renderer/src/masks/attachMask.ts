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
  return createMask(target, factory, owner, true);
}

/**
 * A mask that can step off its target and back on without being destroyed,
 * for a scene's own mask while a transition mask covers the scene.
 * @internal
 */
export interface SuspendableMask extends MaskHandle {
  /** Take the mask off its target, keeping its node and state. */
  suspend(): void;
  /** Put a suspended mask back on its target. */
  resume(): void;
}

/**
 * Build a mask for `target`, attached at once or suspended until
 * `resume()`. @internal
 */
export function createMask(
  target: Container,
  factory: MaskFactory,
  owner: Component | undefined,
  attached: boolean,
): SuspendableMask {
  const info = { kind: "Mask draw callback" };
  const boundary = owner ? boundaryFor(owner) : undefined;
  const mask = attributed(boundary, info, factory);
  let inverse = mask.inverse;
  let removed = false;
  let suspended = true;

  const put = (): void => {
    suspended = false;
    if (mask.attachToTarget) target.addChild(mask.node);
    target.setMask({ mask: mask.node, inverse });
  };
  // Pixi v8 quirk: `setMask({ mask: null, inverse: false })` only updates
  // the cached `_maskOptions`; it leaves the live mask effect pointing at
  // our node, so the next render after the node is destroyed dereferences a
  // freed `_gpuData` and crashes. Direct `target.mask = null` runs the
  // proper teardown — `removeEffect()` +
  // `MaskEffectManager.returnMaskEffect()` — which is what we want.
  const take = (): void => {
    suspended = true;
    target.mask = null;
  };
  if (attached) put();

  return {
    remove(): void {
      if (removed) return;
      removed = true;
      if (!suspended) take();
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
      if (!suspended) target.setMask({ mask: mask.node, inverse });
    },
    get inverse(): boolean {
      return inverse;
    },
    redraw(): void {
      if (removed || !mask.redraw) return;
      const redraw = mask.redraw.bind(mask);
      attributed(boundary, info, redraw);
    },
    suspend(): void {
      if (removed || suspended) return;
      take();
      // A node drawn as a child of the target would show unmasked.
      if (mask.attachToTarget) mask.node.removeFromParent();
    },
    resume(): void {
      if (removed || !suspended) return;
      put();
    },
  };
}
