/**
 * @yagejs-addons/i18n — localization for YAGE.
 *
 * Root entry (no pixi, no React): message descriptors, the `Localization`
 * service contract, the i18next backend, and `LocalizationPlugin`. Localized
 * text classes live on the per-peer subpaths: `./renderer`, `./ui`,
 * `./ui-react`, `./inventory`.
 */
export { msg, isMessage, formatText, formatFallback } from "./core/message.js";
export type {
  Message,
  MessageValue,
  MessageValues,
  MessageResolver,
} from "./core/message.js";
export { LocalizationKey, isRelocalizable } from "./core/Localization.js";
export type { Localization, Relocalizable } from "./core/Localization.js";
export { createLocalization } from "./core/i18next.js";
export type { Catalog, LocalizationOptions } from "./core/i18next.js";
export { LocalizationPlugin } from "./LocalizationPlugin.js";
