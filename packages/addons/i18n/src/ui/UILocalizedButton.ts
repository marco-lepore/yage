import { UIButton, type UIButtonProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface UILocalizedButtonProps extends Omit<
  UIButtonProps,
  "children"
> {
  /** The label message. */
  message: Message;
  /** Resolver for the initial label. Default: the message's fallback. */
  resolve?: MessageResolver;
}

/**
 * A `UIButton` whose label follows the current locale. The label keeps the
 * button's own `textStyle`, `bitmap` and `truncate`, because it is the
 * button's internal label rather than a child element.
 */
export class UILocalizedButton extends UIButton implements Relocalizable {
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: UILocalizedButtonProps) {
    const { message, resolve = formatFallback, ...rest } = props;
    super({ ...rest, children: resolve(message) });
    this._message = message;
    this._resolve = resolve;
  }

  /** The message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the message; the label updates immediately for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.setText(this._resolve(message));
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.setText(resolve(this._message));
  }
}
