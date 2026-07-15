import { Input } from "@pixi/ui";
import { LocalizedTextController, resolveStatic } from "@yagejs/core";
import type { PixiInputProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

/**
 * @pixi/ui `Input` keeps its placeholder text node `protected` and exposes no
 * public setter — the only public write is `value`, which is user input. This
 * subclass reaches the placeholder to relocalize it in place, preserving focus
 * and any in-progress editing (reconstructing the widget would drop the DOM
 * input and editing state).
 */
class LocalizedInput extends Input {
  setPlaceholderText(text: string): void {
    if (this.placeholder) this.placeholder.text = text;
  }
}

/** Yoga-aware wrapper around @pixi/ui Input. */
export class PixiInput extends PixiUIBase<LocalizedInput> {
  /** Retains the placeholder binding (if any) and re-resolves it on locale
   *  change. The typed `value` is user input and is never localized. */
  private readonly _placeholderLocalizer: LocalizedTextController;

  constructor(props: PixiInputProps) {
    const view = new LocalizedInput({
      bg: resolvePixiView(props.bg),
      textStyle: props.textStyle,
      placeholder:
        props.placeholder !== undefined
          ? resolveStatic(props.placeholder)
          : undefined,
      value: props.value,
      maxLength: props.maxLength,
      secure: props.secure,
      align: props.align,
      padding: props.padding,
      nineSliceSprite: props.nineSliceSprite,
    } as ConstructorParameters<typeof Input>[0]);
    super(view, props);

    this._placeholderLocalizer = new LocalizedTextController((value) => {
      this.view.setPlaceholderText(value);
    });
    this.localizers.push(this._placeholderLocalizer);
    if (props.placeholder !== undefined) {
      this._placeholderLocalizer.seed(props.placeholder);
    }

    if (props.onChange) view.onChange.connect(props.onChange);
    if (props.onEnter) view.onEnter.connect(props.onEnter);
    this.prevProps = { ...props };
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiInputProps;

    this.bridgeSignal(this.view.onChange, "onChange", props);
    this.bridgeSignal(this.view.onEnter, "onEnter", props);

    if (p.placeholder !== undefined) {
      this._placeholderLocalizer.set(p.placeholder);
    }
    if (p.value !== undefined) this.view.value = p.value;
    if (p.secure !== undefined) this.view.secure = p.secure;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (p.padding !== undefined) (this.view as any).padding = p.padding;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    const changeCb = this.prevProps.onChange as
      | ((value: string) => void)
      | undefined;
    if (changeCb) this.view.onChange.disconnect(changeCb);

    const enterCb = this.prevProps.onEnter as
      | ((value: string) => void)
      | undefined;
    if (enterCb) this.view.onEnter.disconnect(enterCb);
  }
}
