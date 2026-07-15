export type {
  JsonValue,
  LocalizedBinding,
  LocalizationAdapter,
  Localization,
} from "./types.js";
export { msg } from "./types.js";

export {
  IdentityLocalizationAdapter,
  identityLocalizationAdapter,
  interpolate,
} from "./IdentityLocalizationAdapter.js";

export {
  LocalizationKey,
  LocalizationPlugin,
  resolveLocalized,
} from "./LocalizationPlugin.js";
export type { LocalizationPluginOptions } from "./LocalizationPlugin.js";
