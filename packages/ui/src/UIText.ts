import { devWarn } from "@yagejs/core";
import { buildTextOptions, resolveTextStyle } from "@yagejs/renderer";
import type { DisplayContainer, TextStyle } from "@yagejs/renderer";
import { getUIDefaultTextStyle } from "./text-defaults.js";
import { BitmapText, Text } from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { MeasureMode } from "yoga-layout";
import { Display } from "yoga-layout";
import type { UITextProps } from "./types.js";
import { UIElementBase } from "./UIElementBase.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";
import { FocusOutline, layoutBox } from "./internal/focus-outline.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
} from "./focus/pointer-request.js";

const DEFAULT_ELLIPSIS = "…";

/** Lightweight wrapper around a PixiJS Text for use in UI panels. */
export class UIText extends UIElementBase {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  private readonly text: Text | BitmapText;
  private _truncate: "clip" | "ellipsis" | undefined;
  private _truncateWith: string;
  /**
   * Whether the measure callback ran during the layout just computed. It runs
   * only when Yoga has an axis left to measure, and it is where wrap and
   * truncation are applied for every text Yoga does measure. `applyLayout`
   * reads it to tell the two cases apart.
   */
  private _measured = false;
  /**
   * Computed width the wrap flag and the truncated string were last built
   * from. `NaN` never equals a computed width, so writing it forces the next
   * `applyLayout` to rebuild them even though the width has not moved.
   */
  private _appliedWidth = Number.NaN;
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
  private readonly _focus: FocusState;
  private readonly _focusOutline: FocusOutline;
  private _destroyed = false;

  constructor(props: UITextProps) {
    super();
    this.yogaNode = createYogaNode();

    this._source = props.children ?? "";
    this._truncate = props.truncate;
    this._truncateWith = props.truncateWith ?? DEFAULT_ELLIPSIS;
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
    this.applyTransformProps(props);
    applyConsumeInput(this.text, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.text, props);

    // Out of focus navigation until a game asks for it with `focusable`.
    // Asked for, the label carries focus like every other focusable element,
    // and a press on it brings the keyboard here.
    this._focusOutline = new FocusOutline({
      container: this.text,
      box: () => layoutBox(this.yogaNode),
    });
    this._focusOutline.set(props);
    this._focus = new FocusState(this, props, {
      focusableByDefault: false,
      paint: (focused) => this._focusOutline.setFocused(focused),
    });
    this.text.on("pointerover", () => {
      requestHoverFocus(this);
    });
    this.text.on("pointerdown", () => {
      requestPressFocus(this);
    });

    this.yogaNode.setMeasureFunc((width, widthMode) => {
      this._measured = true;

      // `clip` / `ellipsis` are single-line, so wordWrap stays off and the
      // text is substring-truncated to fit the slot.
      if (this._truncate === "clip" || this._truncate === "ellipsis") {
        const maxWidth =
          widthMode === MeasureMode.Undefined
            ? Number.POSITIVE_INFINITY
            : width;
        const suffix = this._truncate === "ellipsis" ? this._truncateWith : "";
        this.applyTruncate(maxWidth, suffix);
        const w = this.text.width;
        const measuredWidth =
          widthMode === MeasureMode.Exactly ? width : Math.min(w, maxWidth);
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
    this._appliedWidth = Number.NaN;
    this.yogaNode.markDirty();
  }

  /**
   * Wrap — or truncate — a text Yoga laid out without measuring. Yoga calls a
   * measure function only when an axis is left to measure, and that callback
   * is the only other place word wrap is switched on and the truncated string
   * is built. Both axes pinned leaves nothing to measure, and so does one
   * pinned axis with the other filled by the default stretch alignment, which
   * is what a plain panel does. Without this such a text renders one long
   * unbroken line, and a truncating one renders its whole source past the
   * slot edge.
   *
   * Runs only when the computed width moved, because truncation
   * binary-searches the text width and Pixi re-measures the block on every
   * style write.
   */
  applyLayout(): void {
    this._focusOutline.refresh();
    const width = this.yogaNode.getComputedWidth();
    if (this._measured) {
      // The callback already wrapped or truncated this text to the constraint
      // it was given. Record the width it produced so the next pass, which
      // Yoga serves from its layout cache without measuring anything, leaves
      // that work in place.
      this._measured = false;
      this._appliedWidth = width;
      return;
    }
    if (width === this._appliedWidth) return;
    this._appliedWidth = width;

    // `clip` / `ellipsis` are single-line: `applyTruncateStyle` keeps wrap
    // off and the string is cut to the slot instead.
    if (this._truncate === "clip" || this._truncate === "ellipsis") {
      const suffix = this._truncate === "ellipsis" ? this._truncateWith : "";
      this.applyTruncate(width, suffix);
      return;
    }

    this.text.style.wordWrap = true;
    this.text.style.wordWrapWidth = width;
  }

  /**
   * Replace the text style. Unset properties fall back to the engine + UI
   * defaults (then Pixi's), so this is a full replace, not a patch — to
   * change a few properties while keeping the rest, use {@link mergeStyle}.
   */
  setStyle(s: Partial<TextStyle>): void {
    // Re-resolve against engine + UI defaults: the raw style carries neither,
    // so an omitted prop would otherwise drop to Pixi's bare default.
    // The whole style object goes, so any wrap `applyLayout` had switched on
    // goes with it.
    this.text.style = resolveTextStyle(s, getUIDefaultTextStyle()) ?? s;
    this._styleOptions = { ...s };
    this._appliedWidth = Number.NaN;
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
    // Use `"truncateWith" in p` rather than `!== undefined` so an explicit
    // `{ truncateWith: undefined }` payload (e.g. removing the prop in the
    // React reconciler) restores the default ellipsis. A suffix equal to the
    // one in force leaves the applied truncation in place: the reconciler
    // passes every current prop on each commit, and re-truncating
    // binary-searches the text width.
    if ("truncateWith" in p) {
      const next = p.truncateWith ?? DEFAULT_ELLIPSIS;
      if (next !== this._truncateWith) {
        this._truncateWith = next;
        if (this._truncate === "ellipsis") {
          this.text.text = this._source;
          this._appliedWidth = Number.NaN;
          this.yogaNode.markDirty();
        }
      }
    }
    if ("truncate" in p && p.truncate !== this._truncate) {
      this._truncate = p.truncate;
      // Restore source so a previous ellipsis pass doesn't bleed through;
      // the next measure or layout pass re-applies wordWrap / ellipsis based
      // on the new mode.
      this.text.text = this._source;
      this._appliedWidth = Number.NaN;
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
    this._focus.set(p);
    this._focusOutline.set(p);
    applyLayoutProps(this.yogaNode, p);
    this.applyTransformProps(p);

    if ("visible" in p) {
      this.visible = p.visible ?? true;
    }
  }

  /**
   * What the Inspector reports for this label: whether it takes part in
   * focus navigation, which is off unless the game asked for it, and whether
   * it holds focus right now. A test reads this instead of a screenshot.
   * @internal
   */
  _inspectState(): { focused: boolean; focusable: boolean } {
    return { focused: this._focus.focused, focusable: this._focus.focusable };
  }

  /** Idempotent — a second call is a no-op. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._focus.destroy();
    this._focusOutline.destroy();
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
   * within `maxWidth`, then write the result into `text.text`. A non-finite
   * width means the text is unconstrained, so it renders whole, as it does
   * when it already fits. Uses a binary search since each width measurement
   * traverses the Pixi text pipeline.
   *
   * `"ellipsis"` mode passes `"…"` as the suffix; `"clip"` mode passes the
   * empty string and so simply cuts at the character boundary — the text
   * stays bounded by its yoga slot rather than relying on a parent mask.
   */
  private applyTruncate(maxWidth: number, suffix: string): void {
    if (!Number.isFinite(maxWidth)) {
      this.text.text = this._source;
      return;
    }
    // A slot with no room gets what the search settles on when not even one
    // character fits: the suffix, which is empty for `"clip"`.
    if (maxWidth <= 0) {
      this.text.text = suffix;
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
