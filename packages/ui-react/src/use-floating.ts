import { useContext, useRef, useEffect } from "react";
import type { ReactNode, ReactPortal } from "react";
import type { UIElement } from "@yagejs/ui";
import { FloatingOverlayCtx } from "./floating.js";
import type { FloatConfig, FloatingHandle } from "./floating.js";
import { createPortal } from "./reconciler.js";

export interface UseFloatingOptions extends FloatConfig {
  /** Whether the floating element is shown. */
  open: boolean;
}

export interface UseFloatingResult {
  /** Wire to the trigger element's ref so it can be anchored. */
  setReference: (el: UIElement | null) => void;
  /**
   * Portal `content` into the scene overlay while open. Returns `null` when
   * closed or when no overlay is available (the caller should then render
   * an inline fallback).
   */
  renderFloating: (content: ReactNode) => ReactPortal | null;
  /** `false` → no scene overlay in context; caller should inline-fallback. */
  hasOverlay: boolean;
}

/**
 * Headless floating-element primitive. Acquires a slot in the scene's
 * top-most overlay, anchors it to the trigger via the pure positioning
 * engine, and portals content there (keeping it in the caller's React tree
 * so context/props/lifecycle still flow). Tooltip/popover/menu sit on top
 * of this; consumers can use it directly for custom floating UI.
 */
export function useFloating(opts: UseFloatingOptions): UseFloatingResult {
  const { open, placement, offset, padding, maxWidth, flip, shift } = opts;
  const overlay = useContext(FloatingOverlayCtx);
  const triggerRef = useRef<UIElement | null>(null);

  // Acquire one slot for this component's lifetime (overlay is stable per
  // scene). Released on unmount.
  const handleRef = useRef<FloatingHandle | null | undefined>(undefined);
  if (handleRef.current === undefined) {
    handleRef.current = overlay ? overlay.acquire() : null;
    handleRef.current?.setReference(() => triggerRef.current);
  }
  useEffect(
    () => () => {
      handleRef.current?.release();
    },
    [],
  );

  const prevOpen = useRef(false);
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    h.setConfig({ placement, offset, padding, maxWidth, flip, shift });
    h.setActive(open);
    if (open && !prevOpen.current) h.bringToFront();
    prevOpen.current = open;
  });

  return {
    setReference: (el) => {
      triggerRef.current = el;
    },
    renderFloating: (content) => {
      const h = handleRef.current;
      return h && open ? createPortal(content, h.container) : null;
    },
    hasOverlay: overlay !== null,
  };
}
