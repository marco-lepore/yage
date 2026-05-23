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
 * Create a new Yoga node, pre-configured to match web flexbox defaults.
 *
 * Yoga's raw default is `flexShrink: 0`, which diverges from CSS (where flex
 * items default to `flexShrink: 1`) exactly where text overflow is governed:
 * a child sharing a row reports its natural size and refuses to give space
 * back, so it overflows its container instead of shrinking/wrapping. We flip
 * the default to `1` here so layouts fail gracefully out of the box. Explicit
 * `flexShrink` props (via {@link applyLayoutProps}) and component-level
 * overrides (e.g. ScrollView pins its content to `0`) still win because they
 * run after this.
 */
export function createYogaNode(): YogaNode {
  const node = getYoga().Node.create();
  node.setFlexShrink(1);
  return node;
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

/** Half-pixel slack so sub-pixel rounding in Yoga's layout never trips the check. */
const OVERFLOW_EPSILON = 0.5;

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

  const contentRight = w - parent.getComputedPadding(Edge.Right);
  const contentBottom = h - parent.getComputedPadding(Edge.Bottom);

  for (const child of children) {
    const cn = child.yogaNode;
    if (_overflowWarned.has(cn)) continue;
    if (cn.getDisplay() === Display.None) continue;
    if (cn.getPositionType() === PositionType.Absolute) continue;

    const overRight = cn.getComputedLeft() + cn.getComputedWidth() - contentRight;
    const overBottom = cn.getComputedTop() + cn.getComputedHeight() - contentBottom;
    if (overRight <= OVERFLOW_EPSILON && overBottom <= OVERFLOW_EPSILON) continue;

    _overflowWarned.add(cn);
    const parts: string[] = [];
    if (overRight > OVERFLOW_EPSILON) parts.push(`${overRight.toFixed(1)}px horizontally`);
    if (overBottom > OVERFLOW_EPSILON) parts.push(`${overBottom.toFixed(1)}px vertically`);
    devWarn(
      `UI layout: a child overflows its container by ${parts.join(" and ")}. ` +
        `Flex children shrink by default, but this one can't fit — give the ` +
        `container more room, set maxWidth/maxHeight, allow the content to ` +
        `wrap, or use truncate: "clip" | "ellipsis" on text.`,
    );
  }
}
