import { CheckBox, RadioGroup } from "@pixi/ui";
import type { PixiRadioGroupProps, PixiCheckboxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";

/** Build a @pixi/ui CheckBox from our PixiCheckboxProps shape. */
function makeCheckBox(p: PixiCheckboxProps): CheckBox {
  return new CheckBox({
    style: {
      checked: p.checkedView,
      unchecked: p.uncheckedView,
      text: p.textStyle,
      textOffset: p.textOffset,
    },
    text: p.text,
    checked: p.checked ?? false,
  } as ConstructorParameters<typeof CheckBox>[0]);
}

/** Yoga-aware wrapper around @pixi/ui RadioGroup. */
export class PixiRadioGroup extends PixiUIBase<RadioGroup> {
  constructor(props: PixiRadioGroupProps) {
    const checkboxes = props.items.map(makeCheckBox);

    const view = new RadioGroup({
      items: checkboxes,
      type: props.type,
      elementsMargin: props.elementsMargin,
      selectedItem: props.selected,
    } as ConstructorParameters<typeof RadioGroup>[0]);
    super(view, props);

    if (props.onChange) view.onChange.connect(props.onChange);
    this.prevProps = { ...props };
  }

  /** RadioGroup is a composite (multiple CheckBoxes). Setting container.width/height
   *  changes scale and distorts the layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiRadioGroupProps;

    this.bridgeSignal(this.view.onChange, "onChange", props);

    if (p.selected !== undefined) this.view.selectItem(p.selected);

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onChange as
      | ((selectedIndex: number, selectedValue: string) => void)
      | undefined;
    if (cb) this.view.onChange.disconnect(cb);
  }
}
