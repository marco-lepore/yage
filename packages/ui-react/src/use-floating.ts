import { useContext, useRef, useState, useEffect } from "react";
import type { ReactNode, ReactPortal } from "react";
import type { UIElement } from "@yagejs/ui";
import { layoutFloat } from "@yagejs/ui";
import { FloatingOverlayCtx } from "./floating.js";
import type { FloatConfig, FloatingHandle } from "./floating.js";
import { createPortal, getRootInstances } from "./reconciler.js";

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

  // Acquire a slot after commit (never during render — render must be pure;
  // React may abort/replay it, which would leak handles). State, not a ref,
  // so the portal renders once the slot exists.
  const [handle, setHandle] = useState<FloatingHandle | null>(null);
  useEffect(() => {
    if (!overlay) return;
    const h = overlay.acquire();
    h.setReference(() => triggerRef.current);
    // Lay out the reconciler roots portaled into the float container. Kept
    // reconciler-specific here so the shared overlay stays framework-agnostic.
    h.setLayout((mw) => layoutFloat(getRootInstances(h.container) ?? [], mw));
    setHandle(h);
    return () => {
      h.release();
      setHandle(null);
    };
  }, [overlay]);

  const prevOpen = useRef(false);
  useEffect(() => {
    if (!handle) return;
    handle.setConfig({ placement, offset, padding, maxWidth, flip, shift });
    handle.setActive(open);
    if (open && !prevOpen.current) handle.bringToFront();
    prevOpen.current = open;
  });

  return {
    setReference: (el) => {
      triggerRef.current = el;
    },
    renderFloating: (content) =>
      handle && open ? createPortal(content, handle.container) : null,
    hasOverlay: overlay !== null,
  };
}
