import type { Scene } from "@yagejs/core";
import {
  FloatingOverlay,
  FloatingOverlayKey,
  layoutFloat,
} from "./floating.js";
import type { Placement } from "./positioning.js";
import type { UIElement } from "./types.js";

/** Options for {@link attachTooltip}. */
export interface AttachTooltipOptions {
  /**
   * Builds the tooltip body, called once. **Headless** — return a styled
   * node (e.g. a `UIPanel`/`PanelNode` with a background + padding) for
   * visuals; nothing is added for you.
   */
  content: () => UIElement;
  /**
   * Preferred side, optionally aligned (`"top"`, `"bottom-start"`, …).
   * Default `"top"` (center-aligned). The bubble flips to the opposite side
   * and shifts along the cross axis to stay on-screen.
   */
  placement?: Placement;
  /** Gap in px between the anchor and the bubble. Default `6`. */
  offset?: number;
  /**
   * Cap the bubble width (px). Long content wraps instead of running off
   * screen; the bubble always also clamps to the space available at the
   * resolved side.
   */
  maxWidth?: number;
}

/**
 * Controller returned by {@link attachTooltip}. The tooltip is **inert until
 * you drive it**: `attachTooltip` wires no input of its own, so it can't
 * clobber the anchor's handlers and you stay free to trigger on whatever you
 * like — hover, focus, long-press, or programmatically.
 */
export interface TooltipHandle {
  /**
   * Show (`true`) or hide (`false`) the bubble. The signature lines up 1:1
   * with an `onHover(hovering)` callback, so the common hover wiring is just
   * `anchor.update({ onHover: tip.setActive })`.
   */
  setActive(active: boolean): void;
  /** Destroy the content node and release the overlay slot. */
  dispose(): void;
}

/**
 * Imperative, headless tooltip for the non-React `@yagejs/ui` layer.
 *
 * Anchors a floating bubble to `anchor` via the scene's top-most overlay
 * (the same surface `<Tooltip>` uses): it draws above all other UI, escapes
 * any clip, flips/shifts to stay on-screen, and caps to `maxWidth`.
 * World-space / camera-transformed anchors (e.g. a `ScreenFollow` namecard)
 * track correctly — the overlay re-anchors every frame against `anchor`'s
 * live geometry.
 *
 * **Activation is yours.** This builds the floating parts and returns a
 * {@link TooltipHandle}; nothing shows until you call `setActive`. The
 * `anchor` is used only for positioning — `attachTooltip` never wires it for
 * hover, so it can't clobber the anchor's handlers. The common trigger is a
 * one-liner you own; note `update({ onHover })` *replaces* the anchor's
 * `onHover` (a single slot), which is what you want when it has none — if it
 * already has one, compose them yourself:
 *
 * ```ts
 * const tip = attachTooltip(anchor, scene, { content });
 * anchor.update({ onHover: tip.setActive }); // anchor has no onHover of its own
 * // already has one? compose: onHover: (h) => { existing(h); tip.setActive(h); }
 * // …or drive from any other source: focus, long-press, a timer, programmatic.
 * ```
 *
 * Requires the scene to have a `FloatingOverlay` (registered by `UIPlugin`);
 * throws otherwise. Call `dispose()` to release the overlay slot. For custom
 * popovers/menus reach for
 * `scene._resolveScoped(FloatingOverlayKey).acquire()` + `computePosition()`
 * directly.
 */
export function attachTooltip(
  anchor: UIElement,
  scene: Scene,
  opts: AttachTooltipOptions,
): TooltipHandle {
  const overlay = scene._resolveScoped(FloatingOverlayKey);
  if (!(overlay instanceof FloatingOverlay)) {
    throw new Error(
      "attachTooltip: no FloatingOverlay in scene. Register UIPlugin so " +
        "the scene-scoped overlay exists.",
    );
  }

  const content = opts.content();
  const handle = overlay.acquire();
  handle.container.addChild(content.displayObject);
  handle.setReference(() => anchor);
  handle.setConfig({
    placement: opts.placement,
    offset: opts.offset ?? 6,
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
  });
  handle.setLayout((mw) => layoutFloat([content], mw));

  // The caller owns the activation wiring (e.g. `onHover: tip.setActive`),
  // which may outlive this tooltip — so `setActive` must stay safe to call
  // after `dispose()` has released the slot. The guard makes post-dispose
  // activation a no-op and `dispose()` idempotent.
  let disposed = false;
  return {
    setActive(active: boolean): void {
      if (disposed) return;
      handle.setActive(active);
      if (active) handle.bringToFront();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Destroy the content first (frees its Yoga node + removes its display
      // object from the handle container), then release the now-empty slot.
      content.destroy();
      handle.release();
    },
  };
}
