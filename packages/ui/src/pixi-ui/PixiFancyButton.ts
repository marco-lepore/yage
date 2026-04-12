import { FancyButton } from "@pixi/ui";
import type { PixiFancyButtonProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Yoga-aware wrapper around @pixi/ui FancyButton. */
export class PixiFancyButton extends PixiUIBase<FancyButton> {
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
      text, icon, padding, scale, anchor, nineSliceSprite, animations, textOffset,
    } as unknown as ConstructorParameters<typeof FancyButton>[0]);
    super(view, props);

    // FancyButton has no textStyle constructor option — apply after creation
    if (textStyle && view.textView) {
      view.textView.style = textStyle;
    }
    if (props.disabled) view.enabled = false;
    if (props.onClick) view.onPress.connect(props.onClick);
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiFancyButtonProps;

    this.bridgeSignal(this.view.onPress, "onClick", props);

    if (p.text !== undefined) this.view.text = p.text;
    if (p.textStyle !== undefined && this.view.textView) {
      this.view.textView.style = p.textStyle;
    }
    if (p.disabled !== undefined) this.view.enabled = !p.disabled;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onClick as (() => void) | undefined;
    if (cb) this.view.onPress.disconnect(cb);
  }
}
