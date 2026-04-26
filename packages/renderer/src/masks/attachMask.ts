import type { Container } from "pixi.js";
import type { MaskHandle, MaskSnapshot } from "./MaskHandle.js";
import type { MaskFactory } from "./MaskFactory.js";
import {
  MASK_META,
  getMaskMeta,
  getRegisteredMask,
} from "./defineMask.js";
import type { MaskMeta } from "./defineMask.js";

let warnedUnsavable = false;

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
  const meta = getMaskMeta(mask);

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
    serialize(): MaskSnapshot | null {
      if (removed) return null;
      if (!meta) {
        if (!warnedUnsavable) {
          warnedUnsavable = true;
          console.warn(
            "MaskHandle.serialize: mask was not built via defineMask " +
              "(spriteMask / graphicsMask / custom factory) — cannot be " +
              "saved. Snapshot will skip this mask.",
          );
        }
        return null;
      }
      return {
        name: meta.definitionName,
        options: meta.options,
        inverse,
      };
    },
  };
}

/**
 * Re-attach a mask to a target from a saved snapshot. Looks up the registered
 * `MaskDefinition` by name, calls it with the saved options, applies inverse
 * state. Returns the new handle, or `null` if the definition is no longer
 * registered (with a one-shot warning).
 *
 * @internal — called by visual components during `afterRestore` and by the
 * renderer snapshot contributor for layer/scene-scope masks.
 */
export function restoreMask(
  target: Container,
  snapshot: MaskSnapshot,
): MaskHandle | null {
  const def = getRegisteredMask(snapshot.name);
  if (!def) {
    console.warn(
      `restoreMask: no mask definition registered for "${snapshot.name}" — ` +
        `mask will not be restored.`,
    );
    return null;
  }
  const handle = attachMask(target, () => {
    const mask = def.factory(snapshot.options);
    // Re-tag so a subsequent save round-trip preserves the mask.
    const meta: MaskMeta = {
      definitionName: snapshot.name,
      options: snapshot.options,
    };
    Object.defineProperty(mask, MASK_META, {
      value: meta,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return mask;
  });
  if (snapshot.inverse) handle.setInverse(true);
  return handle;
}

/** @internal — test reset. */
export function _resetMaskAttachWarning(): void {
  warnedUnsavable = false;
}
