import { Slider } from "@pixi/ui";
import type { PixiSliderProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";

/** Yoga-aware wrapper around @pixi/ui Slider. */
export class PixiSlider extends PixiUIBase<Slider> {
  constructor(props: PixiSliderProps) {
    const view = new Slider({
      bg: props.bg,
      fill: props.fill,
      slider: props.slider,
      min: props.min ?? 0,
      max: props.max ?? 100,
      step: props.step,
      value: props.value ?? 0,
      showValue: props.showValue,
      valueTextStyle: props.valueTextStyle,
      fillPaddings: props.fillPaddings,
      nineSliceSprite: props.nineSliceSprite
        ? { bg: props.nineSliceSprite, fill: props.nineSliceSprite }
        : undefined,
    } as ConstructorParameters<typeof Slider>[0]);
    super(view, props);

    if (props.onChange) view.onChange.connect(props.onChange);
    if (props.onUpdate) view.onUpdate.connect(props.onUpdate);
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiSliderProps;

    this.bridgeSignal(this.view.onChange, "onChange", props);
    this.bridgeSignal(this.view.onUpdate, "onUpdate", props);

    if (p.value !== undefined) this.view.value = p.value;
    if (p.min !== undefined) this.view.min = p.min;
    if (p.max !== undefined) this.view.max = p.max;
    if (p.step !== undefined) this.view.step = p.step;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const changeCb = this.prevProps.onChange as
      | ((value: number) => void)
      | undefined;
    if (changeCb) this.view.onChange.disconnect(changeCb);

    const updateCb = this.prevProps.onUpdate as
      | ((value: number) => void)
      | undefined;
    if (updateCb) this.view.onUpdate.disconnect(updateCb);
  }
}
