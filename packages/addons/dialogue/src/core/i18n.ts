/**
 * i18n seam. The runtime never reaches for a translation library directly —
 * it asks an {@link I18nAdapter}. Ship the identity adapter (literal text +
 * `{param}` interpolation) by default; wrap i18next / FormatJS / your own
 * string table in a ~10-line adapter to localise without touching the engine.
 */

export interface I18nAdapter {
  /** Current locale tag, e.g. "en", "fr-CA". Informational. */
  readonly locale: string;
  /**
   * Resolve a string. `key` is the translation key when the script provides
   * one; `fallback` is the authored literal text. `params` feed interpolation.
   * Implementations should return localised markup-bearing text.
   */
  t(
    key: string | undefined,
    fallback: string,
    params?: Readonly<Record<string, unknown>>,
  ): string;
}

/**
 * No-op adapter: returns the authored literal, interpolating `{name}` tokens
 * from `params`. This is what runs until a real i18n backend is plugged in.
 */
export class IdentityI18n implements I18nAdapter {
  constructor(readonly locale: string = "en") {}

  t(
    _key: string | undefined,
    fallback: string,
    params?: Readonly<Record<string, unknown>>,
  ): string {
    return params ? interpolateDialogueText(fallback, params) : fallback;
  }
}

/** Matches an interpolation token `{name}` (word chars only). */
const TOKEN = /\{(\w+)\}/g;

/** Replace `{token}` with `params.token`; leaves unknown tokens untouched.
 *  Own-property check only — `{constructor}`/`{toString}` must not stringify
 *  inherited Object.prototype members. */
export function interpolateDialogueText(
  text: string,
  params: Readonly<Record<string, unknown>>,
): string {
  return text.replace(TOKEN, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** Distinct `{token}` names in `text` — used by load-time validation to check
 *  every interpolation target resolves to a declared var/external. */
export function tokensIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(TOKEN)) names.add(m[1]!);
  return [...names];
}
