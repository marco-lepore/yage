import type { Scene } from "@yagejs/core";
import type { TextStyle } from "@yagejs/renderer";
import {
  attachTooltip,
  UIPanel,
  type AttachTooltipOptions,
  type BackgroundOptions,
  type Padding,
  type TooltipHandle,
  type UIElement,
} from "@yagejs/ui";
import { localizationOf } from "../core/Localization.js";
import type { Message, MessageResolver } from "../core/message.js";
import { UILocalizedText } from "./UILocalizedText.js";

export interface LocalizedTooltipOptions extends Omit<
  AttachTooltipOptions,
  "content"
> {
  /** Text style of the bubble's label. */
  style?: Partial<TextStyle>;
  /** Bubble background. Default: dark rounded panel. */
  background?: BackgroundOptions;
  /** Bubble padding. Default `8`. */
  padding?: Padding;
}

const DEFAULT_BACKGROUND: BackgroundOptions = {
  color: 0x1e1e2e,
  alpha: 0.95,
  radius: 4,
};

/**
 * A tooltip bubble showing one message, following the current locale. Built
 * on `attachTooltip`, so activation is yours (`anchor.update({ onHover:
 * tip.setActive })`). The bubble sits on the scene's floating overlay, outside
 * any surface tree, so it subscribes to the scene's localization service
 * itself and unsubscribes on `dispose` or when the anchor is destroyed.
 */
export function localizedTooltip(
  anchor: UIElement,
  scene: Scene,
  message: Message,
  opts: LocalizedTooltipOptions = {},
): TooltipHandle {
  const localization = localizationOf(scene.context);
  const resolve: MessageResolver = (m, v) => localization.resolve(m, v);
  const { style, background, padding, ...tooltipOpts } = opts;
  const label = new UILocalizedText({
    message,
    resolve,
    ...(style ? { style } : {}),
  });
  const handle = attachTooltip(anchor, scene, {
    ...tooltipOpts,
    content: () => {
      const panel = new UIPanel({
        background: background ?? DEFAULT_BACKGROUND,
        padding: padding ?? 8,
      });
      panel.addElement(label);
      return panel;
    },
  });
  const unsubscribe = localization.subscribe(() => label.relocalize(resolve));
  anchor.displayObject.once("destroyed", unsubscribe);
  return {
    setActive: (active) => handle.setActive(active),
    dispose: () => {
      anchor.displayObject.off("destroyed", unsubscribe);
      unsubscribe();
      handle.dispose();
    },
  };
}
