import { FancyButton } from "@pixi/ui";
import type { PixiFancyButtonProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_TEXT = "";
const DEFAULT_TEXT_STYLE = {};
const DEFAULT_DISABLED = false;

/** Yoga-aware wrapper around @pixi/ui FancyButton. */
export class PixiFancyButton extends PixiUIBase<FancyButton> {
  constructor(props: PixiFancyButtonProps) {
    const {
      defaultView,
      hoverView,
      pressedView,
      disabledView,
      text,
      textStyle,
      icon,
      padding,
      scale,
      anchor,
      nineSliceSprite,
      animations,
      textOffset,
    } = props;
    // Cast needed: exactOptionalPropertyTypes makes `T | undefined` incompatible with optional props
    const view = new FancyButton({
      defaultView: resolvePixiView(defaultView),
      hoverView: resolvePixiView(hoverView),
      pressedView: resolvePixiView(pressedView),
      disabledView: resolvePixiView(disabledView),
      text: text ?? DEFAULT_TEXT,
      icon,
      padding,
      scale,
      anchor,
      nineSliceSprite,
      animations,
      textOffset,
    } as unknown as ConstructorParameters<typeof FancyButton>[0]);
    super(view, props);

    // FancyButton has no textStyle constructor option — apply after creation
    if (textStyle && view.textView) {
      view.textView.style = textStyle;
    }
    view.enabled = !(props.disabled ?? DEFAULT_DISABLED);
    this.bridgeSignal(view.onPress, "onClick", "UI onClick", { ...props });
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiFancyButtonProps>;

    this.bridgeSignal(this.view.onPress, "onClick", "UI onClick", props);

    if ("text" in p) this.view.text = p.text ?? DEFAULT_TEXT;
    if ("textStyle" in p && this.view.textView) {
      this.view.textView.style = p.textStyle ?? DEFAULT_TEXT_STYLE;
    }
    if ("disabled" in p) {
      this.view.enabled = !(p.disabled ?? DEFAULT_DISABLED);
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onPress, "onClick");
  }
}
