import {
  PixiSelect,
  Text,
  type PixiSelectReactProps,
  type TextProps,
} from "@yagejs/ui-react";
import type { JSX } from "react";
import type { Message, MessageValues } from "../core/message.js";
import { useLocalization } from "./useLocalization.js";

export interface TransProps extends Omit<TextProps, "children"> {
  /** The message to display. */
  message: Message;
  /** Interpolation values applied over the message's own. */
  values?: MessageValues;
}

/** A `<Text>` whose content follows the current locale. Accepts every `Text` prop. */
export function Trans(props: TransProps): JSX.Element {
  const { message, values, ...rest } = props;
  const { t } = useLocalization();
  return <Text {...rest}>{t(message, values)}</Text>;
}

export interface LocalizedPixiSelectProps extends Omit<
  PixiSelectReactProps,
  "items"
> {
  /** One message per dropdown row. */
  items: readonly Message[];
}

/**
 * A `<PixiSelect>` whose row labels follow the current locale. The player's
 * row survives a locale change; pass `selected` to control it from outside.
 */
export function LocalizedPixiSelect(
  props: LocalizedPixiSelectProps,
): JSX.Element {
  const { items, ...rest } = props;
  const { t } = useLocalization();
  return <PixiSelect {...rest} items={items.map((m) => t(m))} />;
}
