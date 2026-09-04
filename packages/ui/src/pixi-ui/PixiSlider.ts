import { Slider } from "@pixi/ui";
import type { PixiSliderProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_VALUE = 0;
const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_STEP = 1;

/** Yoga-aware wrapper around @pixi/ui Slider. */
export class PixiSlider extends PixiUIBase<Slider> {
  constructor(props: PixiSliderProps) {
    const view = new Slider({
      bg: resolvePixiView(props.bg),
      fill: resolvePixiView(props.fill),
      slider: resolvePixiView(props.slider),
      min: props.min ?? DEFAULT_MIN,
      max: props.max ?? DEFAULT_MAX,
      step: props.step ?? DEFAULT_STEP,
      value: props.value ?? DEFAULT_VALUE,
      showValue: props.showValue,
      valueTextStyle: props.valueTextStyle,
      fillPaddings: props.fillPaddings,
      nineSliceSprite: props.nineSliceSprite
        ? { bg: props.nineSliceSprite, fill: props.nineSliceSprite }
        : undefined,
    } as ConstructorParameters<typeof Slider>[0]);
    super(view, props);

    this.bridgeSignal(view.onChange, "onChange", "UI onChange", { ...props });
    this.bridgeSignal(view.onUpdate, "onUpdate", "UI onUpdate", { ...props });
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiSliderProps>;

    this.bridgeSignal(this.view.onChange, "onChange", "UI onChange", props);
    this.bridgeSignal(this.view.onUpdate, "onUpdate", "UI onUpdate", props);

    if ("value" in p) this.view.value = p.value ?? DEFAULT_VALUE;
    if ("min" in p) this.view.min = p.min ?? DEFAULT_MIN;
    if ("max" in p) this.view.max = p.max ?? DEFAULT_MAX;
    if ("step" in p) this.view.step = p.step ?? DEFAULT_STEP;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onChange, "onChange");
    this.disconnectBridgedSignal(this.view.onUpdate, "onUpdate");
  }
}
