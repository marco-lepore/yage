import { UIText, type UITextProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface UILocalizedTextProps extends Omit<UITextProps, "children"> {
  /** The message to display. */
  message: Message;
  /**
   * Resolver for the initial text and later `setMessage` calls. Default: the
   * message's fallback. `LocalizedUISurface` builders pass the scene's
   * service; each locale change replaces it through `relocalize`.
   */
  resolve?: MessageResolver;
}

/**
 * A `UIText` whose content follows the current locale. Found by
 * {@link relocalizeTree} anywhere under a {@link LocalizedUISurface}, so it
 * can sit inside nested panels, buttons, and scroll views.
 */
export class UILocalizedText extends UIText implements Relocalizable {
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: UILocalizedTextProps) {
    const { message, resolve = formatFallback, ...rest } = props;
    super({ ...rest, children: resolve(message) });
    this._message = message;
    this._resolve = resolve;
  }

  /** The message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the message; the text updates immediately for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.setText(this._resolve(message));
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.setText(resolve(this._message));
  }
}
