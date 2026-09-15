import type { Scene } from "@yagejs/core";
import {
  fallbackLocalization,
  localizationOf,
  type Localization,
} from "../core/Localization.js";
import { msg, type Message, type MessageResolver } from "../core/message.js";

/**
 * How inventory text maps to catalog keys. The authored strings stay in the
 * item and action definitions and the controller's `title`; they are the
 * fallbacks. Each function receives the definition id.
 */
export interface InventoryMessageKeys {
  /** Catalog key for an item's name (`ItemDef.name` is the fallback). */
  readonly item: (itemId: string) => string;
  /** Catalog key for an item's description. Omit to leave descriptions as authored. */
  readonly description?: (itemId: string) => string;
  /** Catalog key for an action-menu label (`ItemActionDef.label` is the fallback). */
  readonly action?: (actionId: string) => string;
  /** Catalog key for the header title (the controller's `title` is the fallback). */
  readonly title?: string;
}

/** Shared by the wrappers: the scene's service, found at mount, and the
 *  subscription that re-presents on each locale change. */
export class LocalizedPresenterState {
  private localization: Localization = fallbackLocalization;
  private unsubscribe: (() => void) | undefined;

  readonly resolve: MessageResolver = (message, values) =>
    this.localization.resolve(message, values);

  /** Text for `key` with `fallback`, in the current locale. */
  text(key: string, fallback: string): string {
    return this.resolve(msg(key, fallback));
  }

  mount(scene: Scene, onChange: () => void): void {
    this.unmount();
    this.localization = localizationOf(scene.context);
    this.unsubscribe = this.localization.subscribe(onChange);
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.localization = fallbackLocalization;
  }
}

/** The message for an item name, for a game that renders names itself. */
export function itemNameMessage(
  keys: InventoryMessageKeys,
  itemId: string,
  name: string,
): Message {
  return msg(keys.item(itemId), name);
}
