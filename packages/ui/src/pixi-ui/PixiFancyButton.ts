import { FancyButton } from "@pixi/ui";
import { LocalizedTextController, resolveStatic } from "@yagejs/core";
import type { PixiFancyButtonProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/**
 * Force @pixi/ui `FancyButton` to re-fit its text after the label changed.
 * `FancyButton.set text` mutates an existing text view but skips the fit +
 * recenter pass (only `createTextView` runs it), so a longer/shorter
 * translation would overflow the button or sit off-center. Re-assigning
 * `textOffset` is the cheapest public trigger for that pass.
 */
export function refitButtonText(btn: FancyButton): void {
  const offset = btn.textOffset;
  btn.textOffset = offset;
}

/** Yoga-aware wrapper around @pixi/ui FancyButton. */
export class PixiFancyButton extends PixiUIBase<FancyButton> {
  /** Retains the label binding (if any) and re-resolves it on locale change. */
  private readonly _textLocalizer: LocalizedTextController;
  /** The label style, re-applied whenever @pixi/ui rebuilds the text view. */
  private _textStyle: PixiFancyButtonProps["textStyle"];

  constructor(props: PixiFancyButtonProps) {
    const {
      defaultView, hoverView, pressedView, disabledView,
      text, textStyle, icon, padding, scale, anchor, nineSliceSprite, animations, textOffset,
    } = props;
    // Cast needed: exactOptionalPropertyTypes makes `T | undefined` incompatible with optional props
    const view = new FancyButton({
      defaultView: resolvePixiView(defaultView),
      hoverView: resolvePixiView(hoverView),
      pressedView: resolvePixiView(pressedView),
      disabledView: resolvePixiView(disabledView),
      text: text !== undefined ? resolveStatic(text) : undefined,
      icon, padding, scale, anchor, nineSliceSprite, animations, textOffset,
    } as unknown as ConstructorParameters<typeof FancyButton>[0]);
    super(view, props);

    this._textStyle = textStyle;
    this._textLocalizer = new LocalizedTextController((value) => {
      this.view.text = value;
      // @pixi/ui drops the whole text view on an empty string and builds a
      // fresh, unstyled one for the next non-empty value — so re-apply the
      // style every time rather than only at construction.
      this.applyTextStyle();
      // Setting `.text` alone leaves the previous label's fit scale — re-fit so
      // a longer translation doesn't overflow.
      refitButtonText(this.view);
      // A relabelled button can change footprint — re-measure the Yoga leaf so
      // siblings reflow (matches PixiCheckbox / PixiRadioGroup).
      this.invalidateMeasure();
    });
    this.localizers.push(this._textLocalizer);
    if (text !== undefined) this._textLocalizer.seed(text);

    // FancyButton has no textStyle constructor option — apply after creation
    this.applyTextStyle();
    if (props.disabled) view.enabled = false;
    if (props.onClick) view.onPress.connect(props.onClick);
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiFancyButtonProps;

    this.bridgeSignal(this.view.onPress, "onClick", props);

    // Present-but-undefined means "reset" per the reconciler contract — clear
    // the label and drop its binding rather than leaving stale text bound.
    // Take the new style first so the text set below applies it to a rebuilt
    // text view. Present-but-undefined means "reset" per the reconciler
    // contract, so a removed prop drops the retained style rather than
    // re-applying it to every later label.
    const styleChanged = "textStyle" in props;
    if (styleChanged) this._textStyle = p.textStyle;
    if ("text" in props) this._textLocalizer.set(p.text ?? "");
    else if (styleChanged) this.applyTextStyle();
    if (p.disabled !== undefined) this.view.enabled = !p.disabled;

    this.updateBase(props);
  }

  /** Push the retained style onto the current text view, if there is one. */
  private applyTextStyle(): void {
    if (this._textStyle && this.view.textView) {
      this.view.textView.style = this._textStyle;
    }
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onClick as (() => void) | undefined;
    if (cb) this.view.onPress.disconnect(cb);
  }
}
