/**
 * Headless positioning engine for floating UI (tooltips, popovers, menus).
 *
 * Pure math — no PixiJS, no React, no engine types. Given a reference rect
 * (the trigger, in screen-space px), the floating element's size, and the
 * viewport, it resolves a screen-space top-left for the floating element
 * applying a small Floating-UI-style middleware pipeline:
 *
 *   place → flip (main axis) → shift (cross axis) → size (available space)
 *
 * Everything here is unit-tested in isolation; the Pixi/React layer only
 * feeds it rects and consumes `{ x, y, placement, available }`.
 */

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
/** `"top"` (== `"top-center"`), `"bottom-start"`, `"right-end"`, … */
export type Placement = Side | `${Side}-${Align}`;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface ComputePositionConfig {
  /** Preferred placement. Default `"top"` (center-aligned). */
  placement?: Placement | undefined;
  /** Gap between trigger and floating element along the main axis. Default `0`. */
  offset?: number | undefined;
  /** Viewport inset kept clear by flip/shift and reported by size. Default `0`. */
  padding?: number | undefined;
  /** Flip to the opposite side when the preferred side overflows. Default `true`. */
  flip?: boolean | undefined;
  /** Slide along the cross axis to stay in the viewport. Default `true`. */
  shift?: boolean | undefined;
}

export interface ComputePositionResult {
  /** Floating element top-left, screen-space px. */
  x: number;
  y: number;
  /** Placement actually used (may differ from requested after `flip`). */
  placement: Placement;
  /**
   * Space available between the trigger and the viewport edge at the
   * resolved side — feed into `maxWidth` / `maxHeight` so content caps
   * instead of running off-screen.
   */
  available: Dimensions;
}

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

export function parsePlacement(p: Placement): { side: Side; align: Align } {
  const dash = p.indexOf("-");
  if (dash === -1) return { side: p as Side, align: "center" };
  return {
    side: p.slice(0, dash) as Side,
    align: p.slice(dash + 1) as Align,
  };
}

function isVertical(side: Side): boolean {
  return side === "top" || side === "bottom";
}

/** Top-left of the floating rect for a side+align, before flip/shift. */
function place(
  ref: Rect,
  flt: Dimensions,
  side: Side,
  align: Align,
  offset: number,
): { x: number; y: number } {
  if (isVertical(side)) {
    const y =
      side === "top"
        ? ref.y - flt.height - offset
        : ref.y + ref.height + offset;
    const x =
      align === "start"
        ? ref.x
        : align === "end"
          ? ref.x + ref.width - flt.width
          : ref.x + ref.width / 2 - flt.width / 2;
    return { x, y };
  }
  const x =
    side === "left"
      ? ref.x - flt.width - offset
      : ref.x + ref.width + offset;
  const y =
    align === "start"
      ? ref.y
      : align === "end"
        ? ref.y + ref.height - flt.height
        : ref.y + ref.height / 2 - flt.height / 2;
  return { x, y };
}

/** How far `r` pokes past each padded viewport edge (positive = overflow). */
function overflow(
  r: Rect,
  vp: Dimensions,
  pad: number,
): { top: number; bottom: number; left: number; right: number } {
  return {
    top: pad - r.y,
    left: pad - r.x,
    right: r.x + r.width - (vp.width - pad),
    bottom: r.y + r.height - (vp.height - pad),
  };
}

/** Available space between the trigger and the padded viewport edge. */
function availableAt(
  ref: Rect,
  vp: Dimensions,
  side: Side,
  pad: number,
): Dimensions {
  if (isVertical(side)) {
    const height =
      side === "top"
        ? ref.y - pad
        : vp.height - (ref.y + ref.height) - pad;
    return { width: vp.width - pad * 2, height };
  }
  const width =
    side === "left"
      ? ref.x - pad
      : vp.width - (ref.x + ref.width) - pad;
  return { width, height: vp.height - pad * 2 };
}

export function computePosition(
  reference: Rect,
  floating: Dimensions,
  viewport: Dimensions,
  config: ComputePositionConfig = {},
): ComputePositionResult {
  const {
    placement = "top",
    offset = 0,
    padding = 0,
    flip = true,
    shift = true,
  } = config;

  const parsed = parsePlacement(placement);
  let side = parsed.side;
  const align = parsed.align;

  let coords = place(reference, floating, side, align, offset);

  // flip — main axis only. If the preferred side overflows, try the
  // opposite; keep whichever overflows less so we never make it worse.
  if (flip) {
    const rect = { ...coords, ...floating };
    const ov = overflow(rect, viewport, padding);
    const mainOv = side === "top" || side === "left" ? ov[side] : ov[side];
    if (mainOv > 0) {
      const opp = OPPOSITE[side];
      const oppCoords = place(reference, floating, opp, align, offset);
      const oppRect = { ...oppCoords, ...floating };
      const oppOv = overflow(oppRect, viewport, padding)[opp];
      if (oppOv < mainOv) {
        side = opp;
        coords = oppCoords;
      }
    }
  }

  // shift — cross axis only. Clamp into the padded viewport.
  if (shift) {
    if (isVertical(side)) {
      const max = viewport.width - padding - floating.width;
      const min = padding;
      coords.x = max < min ? min : Math.min(Math.max(coords.x, min), max);
    } else {
      const max = viewport.height - padding - floating.height;
      const min = padding;
      coords.y = max < min ? min : Math.min(Math.max(coords.y, min), max);
    }
  }

  return {
    x: coords.x,
    y: coords.y,
    placement: align === "center" ? side : `${side}-${align}`,
    available: availableAt(reference, viewport, side, padding),
  };
}
