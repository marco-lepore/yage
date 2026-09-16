import { PixiCheckbox, type PixiCheckboxProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface LocalizedPixiCheckboxProps extends Omit<
  PixiCheckboxProps,
  "text"
> {
  /** The label message. */
  text: Message;
  /** Resolver for the initial label. Default: the message's fallback. */
  resolve?: MessageResolver;
}

/** A `PixiCheckbox` whose label follows the current locale. Checked state is untouched. */
export class LocalizedPixiCheckbox
  extends PixiCheckbox
  implements Relocalizable
{
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: LocalizedPixiCheckboxProps) {
    const { text, resolve = formatFallback, ...rest } = props;
    super({ ...rest, text: resolve(text) });
    this._message = text;
    this._resolve = resolve;
  }

  /** The label message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the label message; the text updates for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.update({ text: this._resolve(message) });
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.update({ text: resolve(this._message) });
  }
}
