import { Input } from "@pixi/ui";
import type { PixiInputProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_VALUE = "";
const DEFAULT_SECURE = false;
const DEFAULT_PADDING = 0;

/** Yoga-aware wrapper around @pixi/ui Input. */
export class PixiInput extends PixiUIBase<Input> {
  constructor(props: PixiInputProps) {
    const view = new Input({
      bg: resolvePixiView(props.bg),
      textStyle: props.textStyle,
      placeholder: props.placeholder,
      value: props.value ?? DEFAULT_VALUE,
      maxLength: props.maxLength,
      secure: props.secure ?? DEFAULT_SECURE,
      align: props.align,
      padding: props.padding ?? DEFAULT_PADDING,
      nineSliceSprite: props.nineSliceSprite,
    } as ConstructorParameters<typeof Input>[0]);
    super(view, props);

    this.bridgeSignal(view.onChange, "onChange", "UI onChange", { ...props });
    this.bridgeSignal(view.onEnter, "onEnter", "UI onEnter", { ...props });
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiInputProps>;

    this.bridgeSignal(this.view.onChange, "onChange", "UI onChange", props);
    this.bridgeSignal(this.view.onEnter, "onEnter", "UI onEnter", props);

    if ("value" in p) this.view.value = p.value ?? DEFAULT_VALUE;
    if ("secure" in p) this.view.secure = p.secure ?? DEFAULT_SECURE;
    if ("padding" in p) {
      this.view.padding = (p.padding ?? DEFAULT_PADDING) as Input["padding"];
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onChange, "onChange");
    this.disconnectBridgedSignal(this.view.onEnter, "onEnter");
  }
}
