import { CheckBox, RadioGroup } from "@pixi/ui";
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
    text: p.text,
    checked: p.checked ?? false,
  } as ConstructorParameters<typeof CheckBox>[0]);
}

const DEFAULT_SELECTED = 0;

function selectedForItems(requested: number, itemCount: number): number {
  if (itemCount === 0) return DEFAULT_SELECTED;
  return Math.min(Math.max(requested, 0), itemCount - 1);
}

class MutableRadioGroup extends RadioGroup {
  replaceItems(items: CheckBox[], selected: number): void {
    const previousItems = [...this.items];
    this.removeItems(this.items.map((_, index) => index).reverse());
    for (const item of previousItems) item.destroy();
    this.options = { ...this.options, items, selectedItem: selected };
    this.selected = selected;
    this.addItems(items);
    if (items.length === 0) {
      this.value = "";
      return;
    }
    this.selectItem(selected);
  }
}

/** Yoga-aware wrapper around @pixi/ui RadioGroup. */
export class PixiRadioGroup extends PixiUIBase<RadioGroup> {
  constructor(props: PixiRadioGroupProps) {
    const checkboxes = props.items.map(makeCheckBox);

    const view = new MutableRadioGroup({
      items: checkboxes,
      type: props.type,
      elementsMargin: props.elementsMargin,
      selectedItem: props.selected ?? DEFAULT_SELECTED,
    } as ConstructorParameters<typeof RadioGroup>[0]);
    super(view, props);

    this.bridgeSignal(view.onChange, "onChange", "UI onChange", { ...props });
    this.prevProps = { ...props };
  }

  /** RadioGroup is a composite (multiple CheckBoxes). Setting container.width/height
   *  changes scale and distorts the layout, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiRadioGroupProps>;

    this.bridgeSignal(this.view.onChange, "onChange", "UI onChange", props);

    if ("items" in p) {
      const items = p.items?.map(makeCheckBox) ?? [];
      const requested =
        "selected" in p
          ? (p.selected ?? DEFAULT_SELECTED)
          : (this.view.selected ?? DEFAULT_SELECTED);
      const selected = selectedForItems(requested, items.length);
      (this.view as MutableRadioGroup).replaceItems(items, selected);
    } else if ("selected" in p) {
      this.view.selectItem(p.selected ?? DEFAULT_SELECTED);
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onChange, "onChange");
  }
}
