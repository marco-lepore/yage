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
  /** Gap in px between the trigger and the bubble. Default `6`. */
  offset?: number;
  /**
   * Cap the bubble width (px). Long content wraps instead of running off
   * screen; the bubble always also clamps to the space available at the
   * resolved side.
   */
  maxWidth?: number;
}

/**
 * A trigger element the tooltip anchors to. Any UI primitive
 * (`UIPanel`/`PanelNode`, `UIButton`, `UIImage`, …) qualifies — they all
 * expose `watchHover()` and participate in Yoga layout.
 *
 * The tooltip subscribes via `watchHover` (the *additive* hover channel), so
 * it composes with — never overwrites — the trigger's own `onHover` prop.
 * An element can carry its own hover styling and a tooltip at once.
 */
export interface TooltipTrigger extends UIElement {
  watchHover(fn: (hovering: boolean) => void): () => void;
}

/**
 * Imperative, headless tooltip for the non-React `@yagejs/ui` layer.
 *
 * Anchors a floating bubble to `trigger` via the scene's top-most overlay
 * (the same surface `<Tooltip>` uses): it draws above all other UI, escapes
 * any clip, flips/shifts to stay on-screen, and caps to `maxWidth`.
 * World-space / camera-transformed triggers (e.g. a `ScreenFollow` namecard)
 * anchor correctly. Hover-driven: shows on pointer-over, hides on
 * pointer-out.
 *
 * Requires the trigger's scene to have a `FloatingOverlay` (registered by
 * `UIPlugin`). Returns a `dispose()` that drops the tooltip's hover
 * subscription (leaving any other hover handlers on the trigger intact) and
 * releases the overlay slot. For custom popovers/menus reach for
 * `FloatingOverlayKey.acquire()` + `computePosition()` directly.
 */
export function attachTooltip(
  trigger: TooltipTrigger,
  scene: Scene,
  opts: AttachTooltipOptions,
): () => void {
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
  handle.setReference(() => trigger);
  handle.setConfig({
    placement: opts.placement,
    offset: opts.offset ?? 6,
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
  });
  handle.setLayout((mw) => layoutFloat([content], mw));

  const unwatchHover = trigger.watchHover((hovering) => {
    handle.setActive(hovering);
    if (hovering) handle.bringToFront();
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unwatchHover();
    // Destroy the content first (frees its Yoga node + removes its display
    // object from the handle container), then release the now-empty slot.
    content.destroy();
    handle.release();
  };
}
