import type {
  DisplaySplitBitmapText,
  DisplaySplitText,
} from "../public-types.js";

type AnySplitText = DisplaySplitText | DisplaySplitBitmapText;

/**
 * Pixi's split of an empty string produces zero line containers, and
 * `AbstractSplitText.split()` then calls `addChild()` with no arguments,
 * which reads `children[0].parent` and throws a `TypeError` naming Pixi
 * internals (pixi.js 8.17). Every function here keeps that call from
 * happening while the text is empty: the segment arrays stay empty, which is
 * what an empty string should produce, and the first non-empty value splits
 * normally.
 *
 * `AbstractSplitText` takes `autoSplit` as a constructor option and exposes no
 * setter for it, so the field is written directly. A Pixi release that renames
 * it would silently restore the crash; the empty-string specs beside the two
 * components are what catches that.
 */
function setAutoSplit(target: AnySplitText, on: boolean): void {
  (target as unknown as { _autoSplit: boolean })._autoSplit = on;
}

/**
 * The `autoSplit` constructor option for a split text built with `text`.
 * `autoSplit` is what the caller asked for.
 */
export function initialAutoSplit(autoSplit: boolean, text: string): boolean {
  return autoSplit && text !== "";
}

/**
 * Assign `text` and keep automatic splitting on only while there is something
 * to split. `autoSplit` is what the caller asked for.
 */
export function setSplitText(
  target: AnySplitText,
  text: string,
  autoSplit: boolean,
): void {
  setAutoSplit(target, initialAutoSplit(autoSplit, text));
  target.text = text;
}

/**
 * Split now, unless the text is empty. Reports whether it split, so a caller
 * can skip the work that only makes sense around fresh segments.
 */
export function splitIfNotEmpty(target: AnySplitText): boolean {
  if (target.text === "") return false;
  target.split();
  return true;
}
