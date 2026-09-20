import { CheckBox, RadioGroup } from "@pixi/ui";
import type {
  FocusDirection,
  PixiRadioGroupProps,
  PixiCheckboxProps,
} from "../types.js";
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
  /**
   * How many rows the group holds. `selectItem` reads its row with no bounds
   * check, so a step has to clamp against this before calling it.
   */
  get itemCount(): number {
    return this.items.length;
  }

  /** Whether the group stacks its rows down the screen rather than across. */
  get vertical(): boolean {
    return this.options.type !== "horizontal";
  }

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
export class PixiRadioGroup extends PixiUIBase<MutableRadioGroup> {
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

  /** A composite that places its own checkboxes, so it keeps its own size. */
  protected override sizedByLayout(): boolean {
    return false;
  }

  /** A radio group is stepped, not pressed. */
  activate(): void {}

  /**
   * Step the selection along the group's own axis, which fires `onChange`.
   * The other axis and either end of the list are left alone, so a player can
   * always move focus out of the group.
   */
  protected override adjust(direction: FocusDirection): boolean {
    const forward = this.view.vertical ? "down" : "right";
    const backward = this.view.vertical ? "up" : "left";
    if (direction !== forward && direction !== backward) return false;
    const next = this.view.selected + (direction === forward ? 1 : -1);
    if (next < 0 || next >= this.view.itemCount) return false;
    this.view.selectItem(next);
    return true;
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
      this.view.replaceItems(items, selected);
      this.invalidateSize();
    } else if ("selected" in p) {
      this.view.selectItem(p.selected ?? DEFAULT_SELECTED);
    }

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onChange, "onChange");
  }
}
