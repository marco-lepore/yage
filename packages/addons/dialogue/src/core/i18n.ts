/**
 * i18n seam. The runtime never reaches for a translation library directly —
 * it asks an {@link I18nAdapter}. The identity adapter (authored text plus
 * `{param}` interpolation) runs by default. `@yagejs-addons/i18n`'s service
 * satisfies the interface as is and is picked up automatically when its
 * plugin is installed; any other library fits behind a ~10-line adapter.
 */

/**
 * A translatable piece of script text: the catalog `key`, the authored
 * `fallback` (shown when no catalog has the key), and optional interpolation
 * `values`. The same shape as `@yagejs-addons/i18n`'s `Message`, so a `msg()`
 * call can be written straight into a script.
 */
export interface DialogueMessage {
  readonly key: string;
  readonly fallback: string;
  readonly values?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Script text: an authored string, or a {@link DialogueMessage}. */
export type DialogueText = string | DialogueMessage;

export interface I18nAdapter {
  /** Current locale tag, e.g. "en", "fr-CA". Informational. */
  readonly locale: string;
  /**
   * Localized, markup-bearing text for `text`, with `{token}`s interpolated
   * from `values` (a message's own `values` first, then `values`). A string is
   * the authored literal; a message is looked up by key and falls back to its
   * `fallback`.
   */
  resolve(
    text: DialogueText,
    values?: Readonly<Record<string, unknown>>,
  ): string;
  /**
   * Optional locale-change notification. When present, the controller
   * subscribes and re-presents the line and choice menu on screen in place on
   * each call, without advancing or firing events. Absent: the next line
   * picks up the new locale.
   */
  subscribe?(listener: () => void): () => void;
}

/** Whether `value` has the {@link DialogueMessage} shape. */
export function isDialogueMessage(value: unknown): value is DialogueMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    typeof candidate.fallback === "string" &&
    (candidate.values === undefined ||
      (typeof candidate.values === "object" &&
        candidate.values !== null &&
        !Array.isArray(candidate.values)))
  );
}

/** Whether `value` is a string or a {@link DialogueMessage}. */
export function isDialogueText(value: unknown): value is DialogueText {
  return typeof value === "string" || isDialogueMessage(value);
}

/** The authored text: a string as is, a message's `fallback`. */
export function dialogueTextFallback(text: DialogueText): string {
  return typeof text === "string" ? text : text.fallback;
}

/**
 * No-op adapter: returns the authored text, interpolating `{name}` tokens.
 * This is what runs until a real i18n backend is plugged in.
 */
export class IdentityI18n implements I18nAdapter {
  constructor(readonly locale: string = "en") {}

  resolve(
    text: DialogueText,
    values?: Readonly<Record<string, unknown>>,
  ): string {
    if (typeof text === "string") {
      return values ? interpolateDialogueText(text, values) : text;
    }
    return interpolateDialogueText(text.fallback, {
      ...text.values,
      ...values,
    });
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
