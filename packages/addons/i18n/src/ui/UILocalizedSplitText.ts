import { UISplitText, type UISplitTextProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface UILocalizedSplitTextProps extends Omit<
  UISplitTextProps,
  "children"
> {
  /** The message to display. */
  message: Message;
  /** Resolver for the initial text. Default: the message's fallback. */
  resolve?: MessageResolver;
}

/**
 * A `UISplitText` whose content follows the current locale. Each locale change
 * re-splits, so segment references taken from `segments` or an `onSplit`
 * listener are replaced; take them again from the listener.
 */
export class UILocalizedSplitText extends UISplitText implements Relocalizable {
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: UILocalizedSplitTextProps) {
    const { message, resolve = formatFallback, ...rest } = props;
    super({ ...rest, children: resolve(message) });
    this._message = message;
    this._resolve = resolve;
  }

  /** The message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the message; the text re-splits for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.setText(this._resolve(message));
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.setText(resolve(this._message));
  }
}
