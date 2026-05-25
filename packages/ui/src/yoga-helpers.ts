import type { Node as YogaNode } from "yoga-layout";
import type YogaDefault from "yoga-layout";
import {
  Align,
  Display,
  Edge,
  Overflow,
  PositionType,
} from "yoga-layout";
import { isDev, devWarn } from "@yagejs/core";
import type { LayoutProps, LayoutValue, UIElement } from "./types.js";

type Yoga = typeof YogaDefault;

// ---------------------------------------------------------------------------
// Module-level Yoga instance (set by UIPlugin.install)
// ---------------------------------------------------------------------------

let yoga: Yoga | undefined;

/** Store the loaded Yoga instance for element constructors to use. */
export function setYoga(y: Yoga): void {
  yoga = y;
}

/** Retrieve the Yoga instance. Throws if not yet initialized. */
export function getYoga(): Yoga {
  if (!yoga) throw new Error("Yoga not initialized. Did you add UIPlugin?");
  return yoga;
}

/**
 * Create a new Yoga node, keeping Yoga's raw defaults — notably
 * `flexShrink: 0`, so an element keeps its natural main-axis size and
 * *overflows* a too-small row/column rather than being crushed.
 *
 * This intentionally does NOT adopt the web's `flexShrink: 1` default. Yoga has
 * no `min-width: auto` content floor, so a global `1` has nothing to stop it
 * crushing fixed-size siblings, and it collapses scroll content (a ScrollView's
 * content must exceed its viewport to scroll). Opt into shrinking per element
 * via `flexShrink: 1` or the `flex` shorthand (see {@link applyLayoutProps});
 * to let text wrap, give an ancestor a definite width and mark the text/column
 * `flex` / `flexShrink: 1` so it gives the space back.
 */
export function createYogaNode(): YogaNode {
  return getYoga().Node.create();
}

// ---------------------------------------------------------------------------
// Viewport dimensions (set by UILayoutSystem each frame)
// ---------------------------------------------------------------------------

let vpWidth = 0;
let vpHeight = 0;

export function setViewport(w: number, h: number): void {
  vpWidth = w;
  vpHeight = h;
}

export function getViewport(): { width: number; height: number } {
  return { width: vpWidth, height: vpHeight };
}

// ---------------------------------------------------------------------------
// Layout value resolution
// ---------------------------------------------------------------------------

const ALIGN_MAP: Record<string, number> = {
  auto: Align.Auto,
  "flex-start": Align.FlexStart,
  center: Align.Center,
  "flex-end": Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
};

/** Resolve a LayoutValue to pixels (for vh/vw), or return null if it's % or auto. */
function resolveToPixels(value: LayoutValue): number | null {
  if (typeof value === "number") return value;
  if (value === "auto") return null;
  if (value.endsWith("vh")) return (vpHeight * parseFloat(value)) / 100;
  if (value.endsWith("vw")) return (vpWidth * parseFloat(value)) / 100;
  return null; // percentage — handled by Yoga's percent setters
}

function isPercent(value: LayoutValue): boolean {
  return typeof value === "string" && value.endsWith("%");
}

function parsePercent(value: string): number {
  return parseFloat(value);
}

/**
 * Apply a LayoutValue to a specific dimension property on a Yoga node.
 */
export function applyLayoutValue(
  node: YogaNode,
  prop:
    | "width"
    | "height"
    | "minWidth"
    | "maxWidth"
    | "minHeight"
    | "maxHeight"
    | "flexBasis",
  value: LayoutValue,
): void {
  if (value === "auto") {
    switch (prop) {
      case "width":
        node.setWidthAuto();
        return;
      case "height":
        node.setHeightAuto();
        return;
      case "flexBasis":
        node.setFlexBasisAuto();
        return;
      default:
        return; // min/max don't have auto
    }
  }

  if (isPercent(value)) {
    const pct = parsePercent(value as string);
    switch (prop) {
      case "width":
        node.setWidthPercent(pct);
        return;
      case "height":
        node.setHeightPercent(pct);
        return;
      case "minWidth":
        node.setMinWidthPercent(pct);
        return;
      case "maxWidth":
        node.setMaxWidthPercent(pct);
        return;
      case "minHeight":
        node.setMinHeightPercent(pct);
        return;
      case "maxHeight":
        node.setMaxHeightPercent(pct);
        return;
      case "flexBasis":
        node.setFlexBasisPercent(pct);
        return;
    }
  }

  // Number, vh, or vw — resolve to pixels
  const px = resolveToPixels(value);
  if (px === null) return;

  switch (prop) {
    case "width":
      node.setWidth(px);
      return;
    case "height":
      node.setHeight(px);
      return;
    case "minWidth":
      node.setMinWidth(px);
      return;
    case "maxWidth":
      node.setMaxWidth(px);
      return;
    case "minHeight":
      node.setMinHeight(px);
      return;
    case "maxHeight":
      node.setMaxHeight(px);
      return;
    case "flexBasis":
      node.setFlexBasis(px);
      return;
  }
}

/**
 * Apply common LayoutProps to a Yoga node.
 */
export function applyLayoutProps(node: YogaNode, props: LayoutProps): void {
  if (props.width !== undefined) applyLayoutValue(node, "width", props.width);
  if (props.height !== undefined)
    applyLayoutValue(node, "height", props.height);
  if (props.minWidth !== undefined)
    applyLayoutValue(node, "minWidth", props.minWidth);
  if (props.maxWidth !== undefined)
    applyLayoutValue(node, "maxWidth", props.maxWidth);
  if (props.minHeight !== undefined)
    applyLayoutValue(node, "minHeight", props.minHeight);
  if (props.maxHeight !== undefined)
    applyLayoutValue(node, "maxHeight", props.maxHeight);
  // `flex: <n>` shorthand = grow n / shrink 1 / basis 0 (CSS). Applied first so
  // the explicit flexGrow/flexShrink/flexBasis below can override any part.
  if (props.flex !== undefined) {
    node.setFlexGrow(props.flex);
    node.setFlexShrink(1);
    node.setFlexBasis(0);
  }

  if (props.flexBasis !== undefined)
    applyLayoutValue(node, "flexBasis", props.flexBasis);

  if (props.flexGrow !== undefined) node.setFlexGrow(props.flexGrow);
  if (props.flexShrink !== undefined) node.setFlexShrink(props.flexShrink);

  if (props.alignSelf !== undefined) {
    node.setAlignSelf(ALIGN_MAP[props.alignSelf] ?? Align.Auto);
  }

  if (props.margin !== undefined) {
    if (typeof props.margin === "number") {
      node.setMargin(Edge.All, props.margin);
    } else {
      if (props.margin.top !== undefined)
        node.setMargin(Edge.Top, props.margin.top);
      if (props.margin.right !== undefined)
        node.setMargin(Edge.Right, props.margin.right);
      if (props.margin.bottom !== undefined)
        node.setMargin(Edge.Bottom, props.margin.bottom);
      if (props.margin.left !== undefined)
        node.setMargin(Edge.Left, props.margin.left);
    }
  }

  if (props.position !== undefined) {
    if (props.position === "absolute") {
      node.setPositionType(PositionType.Absolute);
    } else {
      node.setPositionType(PositionType.Relative);
      // Clear any edges left over from a prior absolute layout pass —
      // Yoga still honors `setPosition` on a Relative node as CSS-style
      // flow nudges, so stale offsets would silently shift the element.
      node.setPosition(Edge.Left, undefined);
      node.setPosition(Edge.Top, undefined);
      node.setPosition(Edge.Right, undefined);
      node.setPosition(Edge.Bottom, undefined);
    }
  }
  // Edge offsets are meaningful only in absolute mode — gating them here
  // mirrors the documented prop contract and avoids accidentally nudging
  // relative-flow elements when stale values linger across updates.
  // We accept either an explicit `position: "absolute"` in this update,
  // or an already-absolute node (so partial imperative updates like
  // `badge.update({ top: newY })` still reposition correctly).
  const isAbsolute =
    props.position === "absolute" ||
    (props.position === undefined &&
      node.getPositionType() === PositionType.Absolute);
  if (isAbsolute) {
    if (props.left !== undefined) node.setPosition(Edge.Left, props.left);
    if (props.top !== undefined) node.setPosition(Edge.Top, props.top);
    if (props.right !== undefined) node.setPosition(Edge.Right, props.right);
    if (props.bottom !== undefined) node.setPosition(Edge.Bottom, props.bottom);
  }

  if (props.visible === false) {
    node.setDisplay(Display.None);
  } else if (props.visible === true) {
    node.setDisplay(Display.Flex);
  }
}

// ---------------------------------------------------------------------------
// Dev-mode overflow warning
// ---------------------------------------------------------------------------

/**
 * Track child nodes we've already warned about so a per-frame layout pass
 * doesn't spam the console — one warning per offending child for the life of
 * the node. A child that later fits (e.g. after a resize) simply stops
 * triggering the check.
 */
const _overflowWarned = new WeakSet<YogaNode>();

/**
 * Container nodes whose children are *meant* to overflow — e.g. a ScrollView's
 * content panel, which extends past the clipped viewport on the scroll axis by
 * design. Registered via {@link exemptFromOverflowWarning}.
 */
const _overflowExempt = new WeakSet<YogaNode>();

/**
 * Slack before an overflow is reported. Pixi text/sprite measurement and
 * Yoga's point rounding routinely differ from the container by up to a whole
 * pixel (e.g. a bordered card sitting 1px proud of its slot), which is visually
 * irrelevant. Only flag overflow beyond that so real spills (text/children
 * running many px past the box) still warn without nagging on rounding noise.
 */
const OVERFLOW_EPSILON = 1.5;

/**
 * Opt a container out of the dev-mode overflow warning. Use for nodes that
 * legitimately let their children spill past the box (scroll content).
 */
export function exemptFromOverflowWarning(node: YogaNode): void {
  _overflowExempt.add(node);
}

/**
 * Dev-only: warn when an in-flow child's computed box spills past its
 * container's content box. Catches the classic "forgot to make it shrinkable"
 * footgun — a long/i18n label or image that overflows instead of
 * wrapping/clipping. No-op in production (tree-shaken via {@link isDev}).
 *
 * Skips intentional overflow: containers with `overflow: "hidden"` (they clip
 * on purpose, e.g. ScrollView) and `position: "absolute"` children (lifted out
 * of flow, free to extend past the parent by design).
 *
 * A node's warned-state is cleared once it fits again, so a child that
 * recovers (e.g. after a resize) and later overflows once more re-warns —
 * the suppression is per overflow episode, not permanent.
 */
export function warnChildOverflow(
  parent: YogaNode,
  children: readonly UIElement[],
): void {
  if (!isDev()) return;
  if (parent.getOverflow() === Overflow.Hidden) return;
  if (_overflowExempt.has(parent)) return;

  const w = parent.getComputedWidth();
  const h = parent.getComputedHeight();
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;

  // Children are positioned from the parent's outer-box origin, so the content
  // box runs from the padding edges inward.
  const contentLeft = parent.getComputedPadding(Edge.Left);
  const contentTop = parent.getComputedPadding(Edge.Top);
  const contentRight = w - parent.getComputedPadding(Edge.Right);
  const contentBottom = h - parent.getComputedPadding(Edge.Bottom);

  for (const child of children) {
    const cn = child.yogaNode;
    if (cn.getDisplay() === Display.None) continue;
    if (cn.getPositionType() === PositionType.Absolute) continue;

    const overLeft = contentLeft - cn.getComputedLeft();
    const overTop = contentTop - cn.getComputedTop();
    const overRight = cn.getComputedLeft() + cn.getComputedWidth() - contentRight;
    const overBottom = cn.getComputedTop() + cn.getComputedHeight() - contentBottom;

    if (
      overLeft <= OVERFLOW_EPSILON &&
      overTop <= OVERFLOW_EPSILON &&
      overRight <= OVERFLOW_EPSILON &&
      overBottom <= OVERFLOW_EPSILON
    ) {
      // Fits — clear so a future re-overflow on this node warns again.
      _overflowWarned.delete(cn);
      continue;
    }

    if (_overflowWarned.has(cn)) continue; // already warned this episode
    _overflowWarned.add(cn);

    const parts: string[] = [];
    if (overLeft > OVERFLOW_EPSILON) parts.push(`${overLeft.toFixed(1)}px past the left edge`);
    if (overRight > OVERFLOW_EPSILON) parts.push(`${overRight.toFixed(1)}px past the right edge`);
    if (overTop > OVERFLOW_EPSILON) parts.push(`${overTop.toFixed(1)}px past the top edge`);
    if (overBottom > OVERFLOW_EPSILON) parts.push(`${overBottom.toFixed(1)}px past the bottom edge`);
    devWarn(
      `UI layout: a child overflows its container by ${parts.join(" and ")}. ` +
        `Flex children keep their natural size by default (flexShrink: 0) — ` +
        `give the container more room, set maxWidth/maxHeight, mark the child ` +
        `flexShrink: 1 or flex: <n> so it gives space back and wraps, or use ` +
        `truncate: "clip" | "ellipsis" on text.`,
    );
  }
}
