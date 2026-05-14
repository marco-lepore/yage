import { Text } from "pixi.js";
import type { TextStyleOptions, Container } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { MeasureMode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { UIElement, UITextProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";

const ELLIPSIS = "…";

/** Lightweight wrapper around a PixiJS Text for use in UI panels. */
export class UIText implements UIElement {
  readonly displayObject: Container;
  readonly yogaNode: YogaNode;
  private readonly text: Text;
  private _truncate: "clip" | "ellipsis" | undefined;
  /** Source text — preserved so ellipsis re-truncation has the full string. */
  private _source: string;

  constructor(props: UITextProps) {
    this.yogaNode = createYogaNode();

    const s = props.style ?? {};
    this._source = props.children ?? "";
    this._truncate = props.truncate;
    this.text = new Text({ text: this._source, style: s });
    this.applyTruncateStyle();
    applyLayoutProps(this.yogaNode, props);

    if (props.visible === false) {
      this.text.visible = false;
    }

    this.displayObject = this.text;
    applyConsumeInput(this.text, props.consumeInput);

    this.yogaNode.setMeasureFunc((width, widthMode) => {
      // `clip` / `ellipsis` are single-line, so wordWrap stays off and the
      // text is substring-truncated to fit the slot.
      if (this._truncate === "clip" || this._truncate === "ellipsis") {
        const maxWidth =
          widthMode === MeasureMode.Undefined
            ? Number.POSITIVE_INFINITY
            : width;
        const suffix = this._truncate === "ellipsis" ? ELLIPSIS : "";
        this.applyTruncate(maxWidth, suffix);
        const w = this.text.width;
        const measuredWidth =
          widthMode === MeasureMode.Exactly
            ? width
            : Math.min(w, maxWidth);
        return { width: measuredWidth, height: this.text.height };
      }

      // Default behavior: when Yoga gives a width constraint, enable
      // wordWrap so multi-line text fits and `text.height` reflects the
      // wrapped block. Read height AFTER wordWrap is set.
      if (
        widthMode === MeasureMode.AtMost ||
        widthMode === MeasureMode.Exactly
      ) {
        this.text.style.wordWrap = true;
        this.text.style.wordWrapWidth = width;
      } else {
        this.text.style.wordWrap = false;
      }

      const w = this.text.width;
      const h = this.text.height;

      let measuredWidth = w;
      if (widthMode === MeasureMode.Exactly) {
        measuredWidth = width;
      } else if (widthMode === MeasureMode.AtMost) {
        measuredWidth = Math.min(w, width);
      }

      return { width: measuredWidth, height: h };
    });
  }

  setText(s?: string): void {
    this._source = s ?? "";
    this.text.text = this._source;
    this.yogaNode.markDirty();
  }

  setStyle(s: Partial<TextStyleOptions>): void {
    this.text.style = s;
    this.applyTruncateStyle();
    this.yogaNode.markDirty();
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UITextProps>): void {
    if (p.children !== undefined && p.children !== this._source) {
      this.setText(p.children);
    }
    if (p.style) {
      this.setStyle(p.style);
    }
    // Use `"truncate" in p` rather than `!== undefined` so an explicit
    // `{ truncate: undefined }` payload (e.g. removing the prop in the
    // React reconciler) clears the mode back to default wrap behavior.
    if ("truncate" in p && p.truncate !== this._truncate) {
      this._truncate = p.truncate;
      // Restore source so a previous ellipsis pass doesn't bleed through;
      // the next measure pass re-applies wordWrap / ellipsis based on the
      // new mode.
      this.text.text = this._source;
      this.applyTruncateStyle();
      this.yogaNode.markDirty();
    }
    if (p.consumeInput !== undefined) applyConsumeInput(this.text, p.consumeInput);
    applyLayoutProps(this.yogaNode, p);

    if (p.visible !== undefined) {
      this.visible = p.visible;
    }
  }

  destroy(): void {
    clearConsumeInput(this.text);
    this.yogaNode.free();
    this.text.destroy();
  }

  /**
   * Ensure `wordWrap` matches the current truncate mode. Both `"clip"` and
   * `"ellipsis"` need wordWrap off so the text stays on a single line; the
   * default wrap behavior toggles wordWrap inside the measure callback.
   */
  private applyTruncateStyle(): void {
    if (this._truncate === "clip" || this._truncate === "ellipsis") {
      this.text.style.wordWrap = false;
    }
  }

  /**
   * Truncate `_source` to the longest prefix whose width + `suffix` fits
   * within `maxWidth`, then write the result into `text.text`. Falls back
   * to the full source when it already fits. Uses a binary search since
   * each width measurement traverses the Pixi text pipeline.
   *
   * `"ellipsis"` mode passes `"…"` as the suffix; `"clip"` mode passes the
   * empty string and so simply cuts at the character boundary — the text
   * stays bounded by its yoga slot rather than relying on a parent mask.
   */
  private applyTruncate(maxWidth: number, suffix: string): void {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      this.text.text = this._source;
      return;
    }

    this.text.text = this._source;
    if (this.text.width <= maxWidth) return;

    let lo = 0;
    let hi = this._source.length;
    let best = "";
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = this._source.slice(0, mid) + suffix;
      this.text.text = candidate;
      if (this.text.width <= maxWidth) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Even a single `suffix` char exceeded the width — render it (or an
    // empty string for `"clip"`) so the slot stays clean.
    this.text.text = best === "" ? suffix : best;
  }
}
