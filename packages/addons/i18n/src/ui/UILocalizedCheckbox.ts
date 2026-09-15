import { UICheckbox, type UICheckboxProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface UILocalizedCheckboxProps extends Omit<
  UICheckboxProps,
  "label"
> {
  /** The label message. */
  label: Message;
  /** Resolver for the initial label. Default: the message's fallback. */
  resolve?: MessageResolver;
}

/** A `UICheckbox` whose label follows the current locale. */
export class UILocalizedCheckbox extends UICheckbox implements Relocalizable {
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: UILocalizedCheckboxProps) {
    const { label, resolve = formatFallback, ...rest } = props;
    super({ ...rest, label: resolve(label) });
    this._message = label;
    this._resolve = resolve;
  }

  /** The label message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the label message; the text updates for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.update({ label: this._resolve(message) });
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.update({ label: resolve(this._message) });
  }
}
