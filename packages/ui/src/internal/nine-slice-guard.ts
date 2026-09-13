import { devWarn, isDev } from "@yagejs/core";

/** The four slice-guide insets of a nine-slice sprite, in source pixels. */
export interface NineSliceInsets {
  leftWidth: number;
  topHeight: number;
  rightWidth: number;
  bottomHeight: number;
}

const warned = new WeakSet<object>();

/**
 * Development-only: warn once per element when a nine-slice box has no room
 * for its own middle row or column. Below `leftWidth + rightWidth` the left
 * and right corners overlap and the art folds in on itself; below
 * `topHeight + bottomHeight` the same happens vertically. It reads as a
 * positioning bug, because the label inside still lands where the layout put
 * it, on top of a carved lip.
 *
 * Warn only. Clamping the box to the insets would silently change where the
 * element sits, and growing it would silently change the layout.
 */
export function warnNineSliceTooSmall(
  owner: object,
  insets: NineSliceInsets,
  width: number,
  height: number,
  context: string,
): void {
  if (!isDev()) return;
  if (warned.has(owner)) return;

  const minWidth = insets.leftWidth + insets.rightWidth;
  const minHeight = insets.topHeight + insets.bottomHeight;
  const tooNarrow = width < minWidth;
  const tooShort = height < minHeight;
  if (!tooNarrow && !tooShort) return;

  warned.add(owner);
  const parts: string[] = [];
  if (tooNarrow) {
    parts.push(
      `width ${width.toFixed(1)}px is under the ${minWidth}px its left and ` +
        `right insets (${insets.leftWidth} + ${insets.rightWidth}) need`,
    );
  }
  if (tooShort) {
    parts.push(
      `height ${height.toFixed(1)}px is under the ${minHeight}px its top and ` +
        `bottom insets (${insets.topHeight} + ${insets.bottomHeight}) need`,
    );
  }
  devWarn(
    `${context}: ${parts.join(", and ")}. The corners overlap and the ` +
      `middle row or column has no room, so the art folds in on itself. ` +
      `Give the element more room, or use art with smaller insets.`,
  );
}
