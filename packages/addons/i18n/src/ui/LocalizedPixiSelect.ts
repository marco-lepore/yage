import { PixiSelect, type PixiSelectProps } from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

export interface LocalizedPixiSelectProps extends Omit<
  PixiSelectProps,
  "items"
> {
  /** One message per dropdown row. */
  items: readonly Message[];
  /** Resolver for the initial labels. Default: each message's fallback. */
  resolve?: MessageResolver;
}

/**
 * A `PixiSelect` whose row labels follow the current locale. Relocalizing
 * keeps the selected row. Found by {@link relocalizeTree} under a
 * {@link LocalizedUISurface}.
 */
export class LocalizedPixiSelect extends PixiSelect implements Relocalizable {
  private _messages: readonly Message[];
  private _resolve: MessageResolver;

  constructor(props: LocalizedPixiSelectProps) {
    const { items, resolve = formatFallback, ...rest } = props;
    super({ ...rest, items: items.map((m) => resolve(m)) });
    this._messages = items;
    this._resolve = resolve;
  }

  /** The row messages, in row order. */
  get messages(): readonly Message[] {
    return this._messages;
  }

  /**
   * Replace the rows. The selected row is kept, clamped to the new length,
   * unless `selected` names one.
   */
  setMessages(messages: readonly Message[], selected?: number): void {
    this._messages = messages;
    this.update({
      items: messages.map((m) => this._resolve(m)),
      ...(selected === undefined ? {} : { selected }),
    });
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.setMessages(this._messages);
  }
}
