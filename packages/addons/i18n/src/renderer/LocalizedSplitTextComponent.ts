import {
  SplitTextComponent,
  type SplitTextComponentOptions,
} from "@yagejs/renderer";
import { localizationFor, type Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface LocalizedSplitTextComponentOptions extends Omit<
  SplitTextComponentOptions,
  "text"
> {
  /** The message to display. */
  message: Message;
}

/**
 * A `SplitTextComponent` whose text follows the current locale. Same
 * behavior as {@link LocalizedTextComponent}; a locale change re-splits the
 * new text, so per-glyph effects restart from the new glyphs.
 */
export class LocalizedSplitTextComponent
  extends SplitTextComponent
  implements Relocalizable
{
  private _message: Message;

  constructor(options: LocalizedSplitTextComponentOptions) {
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
