import { TextComponent, type TextComponentOptions } from "@yagejs/renderer";
import { localizationFor, type Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface LocalizedTextComponentOptions extends Omit<
  TextComponentOptions,
  "text"
> {
  /** The message to display. */
  message: Message;
}

/**
 * A `TextComponent` whose text follows the current locale. Resolves its
 * message when added to a scene and again on every locale change through
 * the plugin's update pass, which reaches inactive entities too. Without a
 * `LocalizationPlugin` it shows the message's fallback.
 */
export class LocalizedTextComponent
  extends TextComponent
  implements Relocalizable
{
  private _message: Message;

  constructor(options: LocalizedTextComponentOptions) {
    const { message, ...rest } = options;
    super({ ...rest, text: formatFallback(message) });
    this._message = message;
  }

  /** The message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the message; the text updates immediately for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.setText(localizationFor(this).resolve(message));
  }

  relocalize(resolve: MessageResolver): void {
    this.setText(resolve(this._message));
  }

  override onAdd(): void {
    super.onAdd();
    this.setText(localizationFor(this).resolve(this._message));
  }
}
