/**
 * Shared choice-row helpers for the renderer-backed choice presenters
 * (list / bubble / radial). Disabled-row dimming, labelling, initial-highlight
 * selection, and the clamp + active-tint highlight loop live here once so the
 * three presenters stay consistent.
 */

import type { TextComponent } from "@yagejs/renderer";

/** Opacity applied to a disabled (non-selectable) choice row, so the default
 *  presenters grey it out without needing a dedicated theme colour. */
export const DISABLED_CHOICE_ALPHA = 0.4;

/**
 * A choice row's display text: the label, plus its `disabledReason` in
 * parentheses when the row is disabled and carries one. Parens (not an em-dash)
 * keep it renderable on baked bitmap-font atlases that may omit punctuation
 * glyphs. Used by the single-line list/bubble presenters; the radial wheel has
 * no room for a reason and shows the bare label.
 */
export function choiceRowLabel(choice: {
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
}): string {
  return choice.disabled && choice.disabledReason
    ? `${choice.label} (${choice.disabledReason})`
    : choice.label;
}

/** Display position of the first selectable (non-disabled) row, or 0 when every
 *  row is disabled — a case the runner prevents by skipping a zero-enabled step,
 *  so the 0 is only a defensive fallback. Shared by all three choice presenters
 *  to seed the initial highlight. */
export function firstEnabledIndex(
  rows: readonly { readonly disabled?: boolean | undefined }[],
): number {
  const i = rows.findIndex((r) => !r.disabled);
  return i < 0 ? 0 : i;
}

/** Clamp a requested highlight position into `[0, count)` (callers guard the
 *  empty list before calling). */
export function clampSelection(position: number, count: number): number {
  return Math.min(Math.max(position, 0), count - 1);
}

/**
 * Paint the per-row fill + disabled dimming for a choice presenter's highlight
 * loop: the row at `selected` (when enabled) takes `selectedColor`, every other
 * enabled row `color`, and a disabled row dims to {@link DISABLED_CHOICE_ALPHA}.
 * The shared body of each presenter's `highlight()`; the presenter still draws
 * its own highlight bar / hub (and the radial scales its selected spoke).
 */
export function applyChoiceTint(
  rows: readonly { readonly comp: TextComponent; readonly disabled: boolean }[],
  selected: number,
  color: number,
  selectedColor: number,
): void {
  rows.forEach((row, i) => {
    const active = i === selected && !row.disabled;
    row.comp.text.style.fill = active ? selectedColor : color;
    row.comp.text.alpha = row.disabled ? DISABLED_CHOICE_ALPHA : 1;
  });
}
