import {
  PixiRadioGroup,
  type PixiCheckboxProps,
  type PixiRadioGroupProps,
} from "@yagejs/ui";
import type { Relocalizable } from "../core/Localization.js";
import {
  formatFallback,
  type Message,
  type MessageResolver,
} from "../core/message.js";

/** One radio row: a `PixiCheckbox` whose label is a message. */
export interface LocalizedRadioItem extends Omit<PixiCheckboxProps, "text"> {
  text: Message;
}

export interface LocalizedPixiRadioGroupProps extends Omit<
  PixiRadioGroupProps,
  "items"
> {
  /** One entry per radio row. */
  items: readonly LocalizedRadioItem[];
  /** Resolver for the initial labels. Default: each message's fallback. */
  resolve?: MessageResolver;
}

/**
 * A `PixiRadioGroup` whose row labels follow the current locale. The selected
 * row survives a locale change.
 */
export class LocalizedPixiRadioGroup
  extends PixiRadioGroup
  implements Relocalizable
{
  private _items: readonly LocalizedRadioItem[];
  private _resolve: MessageResolver;

  constructor(props: LocalizedPixiRadioGroupProps) {
    const { items, resolve = formatFallback, ...rest } = props;
    super({ ...rest, items: resolveItems(items, resolve) });
    this._items = items;
    this._resolve = resolve;
  }

  /** The row labels, in row order. */
  get messages(): readonly Message[] {
    return this._items.map((item) => item.text);
  }

  /**
   * Relabel the rows, one message per row in row order. Each row keeps its
   * views and the selected row is kept. To change the rows themselves, call
   * {@link setItems}.
   */
  setMessages(messages: readonly Message[]): void {
    if (messages.length !== this._items.length) {
      throw new Error(
        `LocalizedPixiRadioGroup.setMessages: expected ${this._items.length} messages, one per row, got ${messages.length}.`,
      );
    }
    this._items = this._items.flatMap((item, row) => {
      const text = messages[row];
      return text ? [{ ...item, text }] : [];
    });
    this.update({ items: resolveItems(this._items, this._resolve) });
  }

  /**
   * Replace the rows, views and all. The selected row is kept, clamped to the
   * new length, unless `selected` names one. {@link setMessages} relabels the
   * rows already there.
   */
  setItems(items: readonly LocalizedRadioItem[], selected?: number): void {
    this._items = items;
    this.update({
      items: resolveItems(items, this._resolve),
      ...(selected === undefined ? {} : { selected }),
    });
  }

  relocalize(resolve: MessageResolver): void {
    this._resolve = resolve;
    this.update({ items: resolveItems(this._items, resolve) });
  }
}

function resolveItems(
  items: readonly LocalizedRadioItem[],
  resolve: MessageResolver,
): PixiCheckboxProps[] {
  return items.map((item) => ({ ...item, text: resolve(item.text) }));
}
