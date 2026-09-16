import {
  ServiceKey,
  type Component,
  type EngineContext,
  type Entity,
} from "@yagejs/core";
import {
  formatFallback,
  formatText,
  type Message,
  type MessageResolver,
  type MessageValues,
} from "./message.js";

/**
 * The service every localized class resolves text through. Implement it over
 * any translation library, or use {@link createLocalization} for the bundled
 * i18next backend. `LocalizationPlugin` registers one under
 * {@link LocalizationKey}.
 */
export interface Localization {
  /** Current locale tag, e.g. `"en"` or `"pt-BR"`. */
  readonly locale: string;
  /**
   * Display text for `text` in the current locale. A {@link Message} is looked
   * up by key, falling back to its `fallback`; `values` interpolate over
   * `message.values`. A plain string is interpolated only.
   */
  resolve(text: Message | string, values?: MessageValues): string;
  /** Switch locale. Notifies subscribers when the locale actually changed. */
  setLocale(locale: string): void;
  /** Called after each locale change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const LocalizationKey = new ServiceKey<Localization>("localization");

/**
 * The service a localized class holds when no `LocalizationPlugin` is
 * installed: every message shows its fallback, the locale is `"und"`
 * (undetermined), and `setLocale` throws.
 */
export const fallbackLocalization: Localization = Object.freeze({
  locale: "und",
  resolve: (text: Message | string, values?: MessageValues): string =>
    typeof text === "string"
      ? formatText(text, values)
      : formatFallback(text, values),
  setLocale: (locale: string): never => {
    throw new Error(
      `Localization.setLocale: no LocalizationPlugin is installed, so "${locale}" cannot be applied.`,
    );
  },
  subscribe: (): (() => void) => () => undefined,
});

/** The service registered in `context`, or {@link fallbackLocalization}. */
export function localizationOf(
  context: EngineContext | undefined,
): Localization {
  return context?.tryResolve(LocalizationKey) ?? fallbackLocalization;
}

/**
 * The service for a component: its scene's, or {@link fallbackLocalization}
 * before the component is bound to an entity in a scene (`Entity.add` assigns
 * `entity` after construction).
 */
export function localizationFor(component: Component): Localization {
  const entity = component.entity as Entity | undefined;
  return localizationOf(entity?.tryScene?.context);
}

/**
 * Anything that holds messages and can redraw them for a new locale. The
 * plugin's update pass calls `relocalize` on every component that implements
 * it, on every entity of every scene; the localized UI surface does the same
 * for its element tree. A game component that renders its own messages
 * implements this to take part.
 */
export interface Relocalizable {
  relocalize(resolve: MessageResolver): void;
}

export function isRelocalizable(value: unknown): value is Relocalizable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Relocalizable).relocalize === "function"
  );
}
