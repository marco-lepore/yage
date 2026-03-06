import type { Node as YogaNode } from "yoga-layout";
import type YogaDefault from "yoga-layout";
import {
  Align,
  Display,
  Edge,
} from "yoga-layout";
import type { LayoutProps, LayoutValue } from "./types.js";

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

/** Create a new Yoga node. */
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

  if (props.visible === false) {
    node.setDisplay(Display.None);
  } else if (props.visible === true) {
    node.setDisplay(Display.Flex);
  }
}
