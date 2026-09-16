import { PixiInput, type PixiInputProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface LocalizedPixiInputProps extends Omit<
  PixiInputProps,
  "placeholder"
> {
  /** The placeholder message, shown while the field is empty. */
  placeholder: Message;
  /** Resolver for the initial placeholder. Default: the message's fallback. */
  resolve?: MessageResolver;
}

/**
 * A `PixiInput` whose placeholder follows the current locale. Text the player
 * has typed is untouched, and a locale change during editing keeps the
 * placeholder hidden.
 */
export class LocalizedPixiInput extends PixiInput implements Relocalizable {
  private _message: Message;
  private _resolve: MessageResolver;

  constructor(props: LocalizedPixiInputProps) {
    const { placeholder, resolve = formatFallback, ...rest } = props;
    super({ ...rest, placeholder: resolve(placeholder) });
    this._message = placeholder;
    this._resolve = resolve;
  }

  /** The placeholder message currently displayed. */
  get message(): Message {
    return this._message;
  }

  /** Replace the placeholder message; it updates for the current locale. */
  setMessage(message: Message): void {
    this._message = message;
    this.update({ placeholder: this._resolve(message) });
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.update({ placeholder: resolve(this._message) });
  }
}
