import { ScrollBox } from "@pixi/ui";
import type { PixiScrollBoxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";

/** Yoga-aware wrapper around @pixi/ui ScrollBox. Yoga leaf — children managed by @pixi/ui. */
export class PixiScrollBox extends PixiUIBase<ScrollBox> {
  constructor(props: PixiScrollBoxProps) {
    const view = new ScrollBox({
      width: props.scrollWidth,
      height: props.scrollHeight,
      background: props.background,
      radius: props.radius,
      type: props.type ?? "vertical",
      elementsMargin: props.elementsMargin,
      globalScroll: props.globalScroll,
    } as ConstructorParameters<typeof ScrollBox>[0]);
    super(view, props);

    if (props.onScroll) view.onScroll.connect(props.onScroll);
    this.prevProps = { ...props };
  }

  /** Expose addItem for imperative usage. */
  addItem(...items: import("pixi.js").Container[]): void {
    this.view.addItem(...items);
  }

  /** Remove all items from the scroll box. */
  removeItems(): void {
    this.view.removeItems();
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiScrollBoxProps;

    this.bridgeSignal(this.view.onScroll, "onScroll", props);

    if (p.background !== undefined) this.view.setBackground(p.background);

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onScroll as
      | ((value: number | import("pixi.js").PointData) => void)
      | undefined;
    if (cb) this.view.onScroll.disconnect(cb);
  }
}
