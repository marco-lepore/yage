import { CheckBox } from "@pixi/ui";
import type { PixiCheckboxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Yoga-aware wrapper around @pixi/ui CheckBox. */
export class PixiCheckbox extends PixiUIBase<CheckBox> {
  constructor(props: PixiCheckboxProps) {
    const view = new CheckBox({
      style: {
        checked: resolvePixiView(props.checkedView),
        unchecked: resolvePixiView(props.uncheckedView),
        text: props.textStyle,
        textOffset: props.textOffset,
      },
      text: props.text,
      checked: props.checked ?? false,
    } as ConstructorParameters<typeof CheckBox>[0]);
    super(view, props);

    if (props.onChange) view.onCheck.connect(props.onChange);
    this.prevProps = { ...props };
  }

  /** CheckBox is a composite (icon + label). Setting container.width/height
   *  changes scale and distorts the square icon, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiCheckboxProps;

    this.bridgeSignal(this.view.onCheck, "onChange", props);

    if (p.checked !== undefined) this.view.forceCheck(p.checked);
    if (p.text !== undefined) this.view.text = p.text;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onChange as
      | ((checked: boolean) => void)
      | undefined;
    if (cb) this.view.onCheck.disconnect(cb);
  }
}
