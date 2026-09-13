import {
  Align,
  FlexDirection as YogaFlexDirection,
  Gutter,
  Justify,
} from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import type { AlignItems, FlexDirection, JustifyContent } from "../types.js";

const FLEX_DIRECTION_MAP: Record<FlexDirection, number> = {
  row: YogaFlexDirection.Row,
  column: YogaFlexDirection.Column,
};

const JUSTIFY_MAP: Record<JustifyContent, number> = {
  "flex-start": Justify.FlexStart,
  center: Justify.Center,
  "flex-end": Justify.FlexEnd,
  "space-between": Justify.SpaceBetween,
  "space-around": Justify.SpaceAround,
  "space-evenly": Justify.SpaceEvenly,
};

const ALIGN_ITEMS_MAP: Record<AlignItems, number> = {
  "flex-start": Align.FlexStart,
  center: Align.Center,
  "flex-end": Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
};

/** The flex-container props a panel and a button lay out the same way. */
export interface FlexContainerProps {
  direction?: FlexDirection;
  gap?: number;
  alignItems?: AlignItems;
  justifyContent?: JustifyContent;
}

/** What each prop resolves to when the element is given none. */
export interface FlexContainerDefaults {
  direction: FlexDirection;
  alignItems: AlignItems;
  justifyContent: JustifyContent;
}

/**
 * Apply the shared flex-container props to a Yoga node, reading key presence
 * (`"gap" in p`) rather than `!== undefined`: a present key holding
 * `undefined` is how the React reconciler marks a dropped JSX prop, and each
 * branch then puts `defaults` back rather than leaving the previous value.
 *
 * Padding is the element's own business: a panel takes the caller's value as
 * it comes, while a button falls back to a default that depends on whether
 * its size is pinned.
 */
export function applyFlexContainerProps(
  node: YogaNode,
  p: Partial<FlexContainerProps>,
  defaults: FlexContainerDefaults,
): void {
  if ("direction" in p) {
    node.setFlexDirection(
      FLEX_DIRECTION_MAP[p.direction ?? defaults.direction],
    );
  }
  if ("gap" in p) {
    node.setGap(Gutter.All, p.gap);
  }
  if ("alignItems" in p) {
    node.setAlignItems(ALIGN_ITEMS_MAP[p.alignItems ?? defaults.alignItems]);
  }
  if ("justifyContent" in p) {
    node.setJustifyContent(
      JUSTIFY_MAP[p.justifyContent ?? defaults.justifyContent],
    );
  }
}
