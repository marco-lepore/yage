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

  /** Whether the button refuses the pointer and a confirm press. */
  override get disabled(): boolean {
    return !this.view.enabled;
  }

  /**
   * Press the button through the widget's own press signal, so a click and a
   * confirm run the same wrapped `onClick` behind one disabled guard.
   *
   * The widget swaps its view off that signal and lands on the mouse-release
   * face, so the correct face is set afterwards. A callback that destroyed
   * the button leaves nothing to repaint.
   */
  activate(): void {
    if (this.disabled) return;
    this.view.onPress.emit();
    if (!this.view.destroyed) this.view.setState(this.faceState());
  }

  protected override setPressed(): void {
    this.view.setState(this.faceState());
  }

  /**
   * The face the button belongs on: disabled outranks a press held by any
   * device, which outranks hover, which outranks the default face.
   */
  private faceState(): "default" | "hover" | "pressed" | "disabled" {
    if (this.disabled) return "disabled";
    if (this.pressed) return "pressed";
    return this.hovered ? "hover" : "default";
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiFancyButtonProps>;

    this.bridgeSignal(this.view.onPress, "onClick", "UI onClick", props);

    if ("text" in p) {
      this.view.text = p.text ?? DEFAULT_TEXT;
      this.invalidateSize();
    }
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
