import { Select } from "@pixi/ui";
import type { PixiSelectProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Yoga-aware wrapper around @pixi/ui Select (dropdown). */
export class PixiSelect extends PixiUIBase<Select> {
  constructor(props: PixiSelectProps) {
    const view = new Select({
      closedBG: resolvePixiView(props.closedBG),
      openBG: resolvePixiView(props.openBG),
      textStyle: props.textStyle,
      selected: props.selected,
      scrollBoxOffset: props.scrollBoxOffset,
      visibleItems: props.visibleItems,
      items: {
        items: props.items,
        backgroundColor: props.itemBG ?? 0x000000,
        width: props.itemWidth ?? 200,
        height: props.itemHeight ?? 40,
        hoverColor: props.itemHoverBG,
        textStyle: props.itemTextStyle ?? props.textStyle,
        radius: 0,
      },
    } as ConstructorParameters<typeof Select>[0]);
    super(view, props);

    if (props.onSelect) view.onSelect.connect(props.onSelect);
    this.prevProps = { ...props };
  }

  /** Select is a composite (FancyButton + ScrollBox). Setting container.width/height
   *  changes scale and breaks the internal layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiSelectProps;

    this.bridgeSignal(this.view.onSelect, "onSelect", props);

    if (p.selected !== undefined) this.view.value = p.selected;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onSelect as
      | ((index: number, text: string) => void)
      | undefined;
    if (cb) this.view.onSelect.disconnect(cb);
  }
}
