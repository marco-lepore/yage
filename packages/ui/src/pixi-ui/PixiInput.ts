import { Input } from "@pixi/ui";
import type { PixiInputProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Yoga-aware wrapper around @pixi/ui Input. */
export class PixiInput extends PixiUIBase<Input> {
  constructor(props: PixiInputProps) {
    const view = new Input({
      bg: resolvePixiView(props.bg),
      textStyle: props.textStyle,
      placeholder: props.placeholder,
      value: props.value,
      maxLength: props.maxLength,
      secure: props.secure,
      align: props.align,
      padding: props.padding,
      nineSliceSprite: props.nineSliceSprite,
    } as ConstructorParameters<typeof Input>[0]);
    super(view, props);

    if (props.onChange) view.onChange.connect(props.onChange);
    if (props.onEnter) view.onEnter.connect(props.onEnter);
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiInputProps;

    this.bridgeSignal(this.view.onChange, "onChange", props);
    this.bridgeSignal(this.view.onEnter, "onEnter", props);

    if (p.value !== undefined) this.view.value = p.value;
    if (p.secure !== undefined) this.view.secure = p.secure;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (p.padding !== undefined) (this.view as any).padding = p.padding;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const changeCb = this.prevProps.onChange as
      | ((value: string) => void)
      | undefined;
    if (changeCb) this.view.onChange.disconnect(changeCb);

    const enterCb = this.prevProps.onEnter as
      | ((value: string) => void)
      | undefined;
    if (enterCb) this.view.onEnter.disconnect(enterCb);
  }
}
