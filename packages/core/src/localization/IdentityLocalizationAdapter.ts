import type { JsonValue, LocalizationAdapter } from "./types.js";

/** Matches an interpolation token `{name}` (word chars only). */
const TOKEN = /\{(\w+)\}/g;

/**
 * Replace `{token}` with `values.token`; leaves unknown tokens untouched.
 * Own-property check only — `{constructor}`/`{toString}` must not stringify
 * inherited `Object.prototype` members.
 */
export function interpolate(
  text: string,
  values: Readonly<Record<string, JsonValue>>,
): string {
  return text.replace(TOKEN, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

/**
 * Default adapter used when no i18n library is wired. Has no catalog, so every
 * key is "missing": it renders the `fallback` (interpolating `{named}` tokens)
 * or, with no fallback, the `id`. Never throws. Locale-static (`"en"` unless
 * constructed otherwise); no `setLocale`.
 */
export class IdentityLocalizationAdapter implements LocalizationAdapter {
  constructor(readonly locale: string = "en") {}

  t(
    id: string,
    fallback: string | undefined,
    values?: Record<string, JsonValue>,
  ): string {
    const text = fallback ?? id;
    return values ? interpolate(text, values) : text;
  }

  /** No source of change — returns a no-op unsubscribe. */
  subscribe(): () => void {
    return () => {};
  }
}

/** Shared default identity adapter — used to resolve bindings when no
 *  localization plugin is registered. */
export const identityLocalizationAdapter = new IdentityLocalizationAdapter();
