import {
  Align,
  FlexDirection as YogaFlexDirection,
  Justify,
} from "yoga-layout";
import type { AlignItems, FlexDirection, JustifyContent } from "../types.js";

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

/** Yoga's flex direction for a prop value; `fallback` when the prop is absent. */
export function toFlexDirection(
  value: FlexDirection | undefined,
  fallback: number,
): number {
  if (value === "row") return YogaFlexDirection.Row;
  if (value === "column") return YogaFlexDirection.Column;
  return fallback;
}

/** Yoga's justify-content for a prop value; `fallback` when the prop is absent. */
export function toJustify(
  value: JustifyContent | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return JUSTIFY_MAP[value] ?? fallback;
}

/** Yoga's align-items for a prop value; `fallback` when the prop is absent. */
export function toAlignItems(
  value: AlignItems | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return ALIGN_ITEMS_MAP[value] ?? fallback;
}
