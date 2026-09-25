import { Slider } from "@pixi/ui";
import type {
  FocusDirection,
  PixiSliderProps,
  UIFocusOutlineBox,
} from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_VALUE = 0;
const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_STEP = 1;

/**
 * `Slider.change()` is the only thing that emits `onChange`, and it is
 * protected, so a keyboard or gamepad step reaches it through a subclass.
 */
class SteppableSlider extends Slider {
  /** Publish the settled value, as releasing a drag does. */
  commit(): void {
    this.change();
  }

  /**
   * The box the track and the knob's whole sweep occupy, in the slider's own
   * space. It is the same at every value.
   *
   * The knob's container sits on the track's mid-line at
   * `value / max * trackWidth - containerWidth / 2`, so the sweep is the art's
   * box widened by half the container's width at each end. The art's offset
   * inside the container depends on the view (a `Sprite` is centred, other
   * views keep their origin), so it is read from the container's local bounds.
   */
  travelBox(): { x: number; y: number; width: number; height: number } {
    const trackWidth = this.bg.width;
    const trackHeight = this.bg.height;
    const knob = this.slider1;
    if (!knob) {
      return { x: 0, y: 0, width: trackWidth, height: trackHeight };
    }
    const bounds = knob.getLocalBounds();
    const half = knob.width / 2;
    const left = bounds.x - half;
    const right = bounds.x + bounds.width + trackWidth - half;
    const top = trackHeight / 2 + bounds.y;
    const bottom = top + bounds.height;
    const x = Math.min(0, left);
    const y = Math.min(0, top);
    return {
      x,
      y,
      width: Math.max(trackWidth, right) - x,
      height: Math.max(trackHeight, bottom) - y,
    };
  }
}

/** Yoga-aware wrapper around @pixi/ui Slider. */
export class PixiSlider extends PixiUIBase<SteppableSlider> {
  constructor(props: PixiSliderProps) {
    const view = new SteppableSlider({
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

  /** A slider is stepped, not pressed. */
  activate(): void {}

  /**
   * Outline the track together with the knob's whole travel. The knob
   * overhangs the layout box, and a box measured from what is drawn would
   * move with the value.
   */
  protected override focusOutlineBox(): UIFocusOutlineBox {
    return this.fromViewSpace(this.view.travelBox());
  }

  /**
   * Step the value on left and right. Setting `value` reports the move and
   * the commit settles it, the order a drag produces. At either end the press
   * is not consumed, so focus leaves the slider.
   */
  protected override adjust(direction: FocusDirection): boolean {
    if (direction !== "left" && direction !== "right") return false;
    const step = direction === "right" ? 1 : -1;
    if (step > 0 && this.view.value >= this.view.max) return false;
    if (step < 0 && this.view.value <= this.view.min) return false;
    this.view.value = this.view.value + step * this.view.step;
    this.view.commit();
    return true;
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
