import { CheckBox } from "@pixi/ui";
import type { PixiCheckboxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_CHECKED = false;
const DEFAULT_TEXT = "";

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
      text: props.text ?? DEFAULT_TEXT,
      checked: props.checked ?? DEFAULT_CHECKED,
    } as ConstructorParameters<typeof CheckBox>[0]);
    super(view, props);

    this.bridgeSignal(view.onCheck, "onChange", "UI onChange", { ...props });
    this.prevProps = { ...props };
  }

  /** CheckBox is a composite (icon + label). Setting container.width/height
   *  changes scale and distorts the square icon, so we skip resizing. */
  override applyLayout(): void {
    // position only — no resize
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiCheckboxProps>;

    this.bridgeSignal(this.view.onCheck, "onChange", "UI onChange", props);

    if ("checked" in p) this.view.forceCheck(p.checked ?? DEFAULT_CHECKED);
    if ("text" in p) this.view.text = p.text ?? DEFAULT_TEXT;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    this.disconnectBridgedSignal(this.view.onCheck, "onChange");
  }
}
