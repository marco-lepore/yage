import { CheckBox, RadioGroup } from "@pixi/ui";
import { LocalizedTextController, resolveStatic } from "@yagejs/core";
import type { PixiRadioGroupProps, PixiCheckboxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Build a @pixi/ui CheckBox from our PixiCheckboxProps shape. */
function makeCheckBox(p: PixiCheckboxProps): CheckBox {
  return new CheckBox({
    style: {
      checked: resolvePixiView(p.checkedView),
      unchecked: resolvePixiView(p.uncheckedView),
      text: p.textStyle,
      textOffset: p.textOffset,
    },
    text: p.text !== undefined ? resolveStatic(p.text) : undefined,
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

    // One localizer per item label — each re-resolves its CheckBox's text on
    // locale change, leaving selection and layout untouched.
    props.items.forEach((item, i) => {
      const box = checkboxes[i];
      if (!box) return;
      const localizer = new LocalizedTextController((value) => {
        box.text = value;
        // A longer label grows the checkbox — re-arrange the internal List so
        // siblings don't overlap, then re-measure the Yoga leaf.
        this.view.innerView?.arrangeChildren();
        this.invalidateMeasure();
      });
      this.localizers.push(localizer);
      if (item.text !== undefined) localizer.seed(item.text);
    });

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
