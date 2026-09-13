import type {
  SplitText as DisplaySplitText,
  SplitBitmapText as DisplaySplitBitmapText,
} from "pixi.js";

type AnySplitText = DisplaySplitText | DisplaySplitBitmapText;

/**
 * Pixi's split of an empty string produces zero line containers, and
 * `AbstractSplitText.split()` then calls `addChild()` with no arguments,
 * which reads `children[0].parent` and throws a `TypeError` naming Pixi
 * internals (pixi.js 8.17). Switching automatic splitting off while the text
 * is empty keeps that call from happening: the segment arrays stay empty,
 * which is what an empty string should produce, and the first non-empty value
 * splits normally.
 *
 * `AbstractSplitText` takes `autoSplit` as a constructor option and exposes no
 * setter for it, so the field is written directly. A Pixi release that renames
 * it would silently restore the crash; the empty-string specs beside the two
 * components are what catches that.
 */
export function setSplitAutoSplit(target: AnySplitText, on: boolean): void {
  (target as unknown as { _autoSplit: boolean })._autoSplit = on;
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
  setSplitAutoSplit(target, autoSplit && text !== "");
  target.text = text;
}
