import { devWarn } from "@yagejs/core";
import { buildTextOptions, resolveTextStyle } from "@yagejs/renderer";
import type { DisplayContainer, TextStyle } from "@yagejs/renderer";
import { getUIDefaultTextStyle } from "./text-defaults.js";
import { BitmapText, Text } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { MeasureMode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { UIElement, UITextProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";

const ELLIPSIS = "…";

/** Lightweight wrapper around a PixiJS Text for use in UI panels. */
export class UIText implements UIElement {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  private readonly text: Text | BitmapText;
  private _truncate: "clip" | "ellipsis" | undefined;
  /** Source text — preserved so ellipsis re-truncation has the full string. */
  private _source: string;
  // Raw style options, kept so `mergeStyle()` can patch over the current
  // style instead of replacing it.
  private _styleOptions: TextStyle | undefined;
  // `bitmap` / `resolution` are construction-only (Pixi v8 can't morph
  // Text↔BitmapText or change resolution in place). Cached so `update()`
  // can detect — and warn about — a change it cannot honor.
  private readonly _bitmap: boolean | undefined;
  private readonly _resolution: number | undefined;
  private readonly pointerEvents: PointerEvents;
  private _destroyed = false;

  constructor(props: UITextProps) {
    this.yogaNode = createYogaNode();

    this._source = props.children ?? "";
    this._truncate = props.truncate;
    if (props.style) this._styleOptions = { ...props.style };
    this._bitmap = props.bitmap;
    this._resolution = props.resolution;

    const { options, bitmap } = buildTextOptions(
      this._source,
      props.style,
      props.bitmap,
      props.resolution,
      getUIDefaultTextStyle(),
    );
    this.text = bitmap ? new BitmapText(options) : new Text(options);
    this.applyTruncateStyle();
    applyLayoutProps(this.yogaNode, props);

    if (props.visible === false) {
      this.text.visible = false;
    }

    this.displayObject = this.text;
    applyConsumeInput(this.text, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.text, props);

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

  /**
   * Replace the text style. Unset properties fall back to the engine + UI
   * defaults (then Pixi's), so this is a full replace, not a patch — to
   * change a few properties while keeping the rest, use {@link mergeStyle}.
   */
  setStyle(s: Partial<TextStyle>): void {
    // Re-resolve against engine + UI defaults: the raw style carries neither,
    // so an omitted prop would otherwise drop to Pixi's bare default.
    this.text.style = resolveTextStyle(s, getUIDefaultTextStyle()) ?? s;
    this._styleOptions = { ...s };
    this.applyTruncateStyle();
    this.yogaNode.markDirty();
  }

  /**
   * Patch the current style: merge `s` over the properties already set
   * (construction or a prior `setStyle`/`mergeStyle`) and re-apply. Unlike
   * {@link setStyle}, properties you don't pass are preserved — handy for an
   * imperative recolour (`mergeStyle({ fill })`) that keeps the font, size,
   * weight, etc.
   */
  mergeStyle(s: Partial<TextStyle>): void {
    this.setStyle({ ...this._styleOptions, ...s });
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UITextProps>): void {
    if ("children" in p) {
      const next = p.children ?? "";
      if (next !== this._source) this.setText(next);
    }
    if ("style" in p) {
      this.setStyle(p.style ?? {});
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
    // `bitmap` / `resolution` are baked into the Pixi object at construction
    // and cannot be applied in place (Pixi v8 has no Text↔BitmapText morph,
    // and `resolution` is a constructor-only option). Surface the dropped
    // change instead of silently ignoring it so the React reconciler path
    // doesn't fail mysteriously.
    // `false` and `undefined` both mean "canvas text", so coalesce before
    // comparing to avoid a spurious change on first mount of `bitmap={false}`.
    const bitmapChanged =
      "bitmap" in p && (p.bitmap ?? false) !== (this._bitmap ?? false);
    if (
      bitmapChanged ||
      ("resolution" in p && p.resolution !== this._resolution)
    ) {
      devWarn(
        "UIText: `bitmap` / `resolution` are construction-only and were " +
          "ignored on update(). Pixi v8 can't morph Text↔BitmapText or " +
          "change resolution in place — remount the element (e.g. change " +
          "its React `key`) to switch bitmap font or resolution.",
      );
    }
    if ("consumeInput" in p) applyConsumeInput(this.text, p.consumeInput);
    this.pointerEvents.set(p);
    applyLayoutProps(this.yogaNode, p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
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
