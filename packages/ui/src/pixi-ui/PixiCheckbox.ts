import { CheckBox } from "@pixi/ui";
import { LocalizedTextController, resolveStatic } from "@yagejs/core";
import type { PixiCheckboxProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/** Yoga-aware wrapper around @pixi/ui CheckBox. */
export class PixiCheckbox extends PixiUIBase<CheckBox> {
  /** Retains the label binding (if any) and re-resolves it on locale change. */
  private readonly _textLocalizer: LocalizedTextController;

  constructor(props: PixiCheckboxProps) {
    const view = new CheckBox({
      style: {
        checked: resolvePixiView(props.checkedView),
        unchecked: resolvePixiView(props.uncheckedView),
        text: props.textStyle,
        textOffset: props.textOffset,
      },
      text: props.text !== undefined ? resolveStatic(props.text) : undefined,
      checked: props.checked ?? false,
    } as ConstructorParameters<typeof CheckBox>[0]);
    super(view, props);

    this._textLocalizer = new LocalizedTextController((value) => {
      this.view.text = value;
    });
    this.localizers.push(this._textLocalizer);
    if (props.text !== undefined) this._textLocalizer.seed(props.text);

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
    if (p.text !== undefined) this._textLocalizer.set(p.text);

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const cb = this.prevProps.onChange as
      | ((checked: boolean) => void)
      | undefined;
    if (cb) this.view.onCheck.disconnect(cb);
  }
}
