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
   * Press the button. The click path and the focus scope's confirm both end
   * at the widget's own press signal, so both run the bridged, error-boundary
   * wrapped `onClick` behind one disabled guard.
   *
   * The widget hangs its own view swapping off that same signal and lands on
   * the face a mouse release leaves behind, so the face it belongs on is set
   * here afterwards: with no pointer over the button, nothing else would ever
   * take that face away. A callback that tore the button down leaves nothing
   * to repaint, and one that disabled it keeps the disabled face.
   */
  activate(): void {
    if (this.disabled) return;
    this.view.onPress.emit();
    if (!this.view.destroyed) this.view.setState(this.faceState());
  }

  /**
   * Show the widget's own pressed art while a device holds the button, and
   * hand the face back once every device has let go.
   */
  protected override setPressed(): void {
    this.view.setState(this.faceState());
  }

  /**
   * The face the button belongs on right now. Disabled outranks everything,
   * a press held by any device outranks hover, and hover outranks the default
   * face — so running the button's action while the player's mouse is still
   * down leaves the press showing.
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
