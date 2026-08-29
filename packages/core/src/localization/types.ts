/**
 * Localization contract — the plain-data + adapter surface YAGE owns while the
 * game brings the i18n library. YAGE writes no resolver: key lookup, plurals,
 * ICU/interpolation and locale fallback live behind {@link LocalizationAdapter}.
 * What YAGE owns is the reactive binding that re-renders text on locale change.
 */

/** JSON-safe value. Interpolation `values` must be serialisable so descriptors
 *  round-trip through save/load unchanged. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Plain, serialisable descriptor of a translatable string: a catalog `id`,
 * optional interpolation `values`, and an optional authored `default` used as
 * the fallback when the key is missing. Built by {@link msg}; resolved to a
 * concrete string by a {@link LocalizationAdapter} (through the plugin), never
 * by construction.
 *
 * Treat bindings as immutable — to change `values`, build a new binding.
 * Setters that dedupe by equality drop in-place mutations.
 */
export interface LocalizedBinding {
  /** Catalog key, e.g. `"hud.score"` or a dialogue line id. */
  id: string;
  /** Interpolation arguments, JSON-safe. */
  values?: Record<string, JsonValue>;
  /** Authored literal used when the key is missing. */
  default?: string;
}

/**
 * Thin boundary over a translation backend (i18next / FormatJS / Fluent /
 * `Intl` / a plain table). The game supplies one; YAGE calls it.
 */
export interface LocalizationAdapter {
  /** Current locale tag, e.g. `"en"`, `"fr-CA"`. */
  readonly locale: string;
  /**
   * Resolve `id` to a string. `values` feed interpolation.
   *
   * Resolution order the adapter is expected to honor: the active locale, then
   * the locale's parent (e.g. `fr-CA` → `fr`), then any fallback locales the
   * adapter is configured with, then the authored `fallback` literal, and
   * finally the `id` itself. So `fallback` is the last resort *before* the id —
   * an adapter must not prefer it over a parent/fallback locale that has the
   * key. `values` feed interpolation. Should not throw — but callers wrap it so
   * a throw can't break the render loop.
   */
  t(
    id: string,
    fallback: string | undefined,
    values?: Record<string, JsonValue>,
  ): string;
  /**
   * Subscribe to change. Fires after `t()` may return new output AND the
   * backing resources for the new locale are ready. Returns an unsubscribe.
   */
  subscribe(onChange: () => void): () => void;
  /**
   * Switch locale. Resolves only once `next` is loaded and active. Optional —
   * an adapter without it (e.g. the identity adapter) is locale-static.
   */
  setLocale?(next: string): void | Promise<void>;
}

/**
 * Consumer-facing localization surface, resolved via {@link LocalizationKey}.
 * Owns the reactive locale + revision; `subscribe` fires on every revision
 * bump (locale switch or lazy catalog load) so text sinks can re-resolve.
 */
export interface Localization {
  /** Active locale tag. */
  readonly locale: string;
  /** Monotonic revision; bumps whenever resolved output may have changed. */
  revision(): number;
  /** Subscribe to revision bumps; returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** Resolve a binding to a string, never throwing (see the plugin). */
  resolve(binding: LocalizedBinding): string;
  /** Atomic locale switch — see {@link LocalizationPlugin.setLocale}. */
  setLocale(next: string): Promise<void>;
}

/**
 * Build a {@link LocalizedBinding}. Does NOT resolve — resolution happens at
 * render time against the active adapter.
 *
 * Argument order matches {@link LocalizationAdapter.t}: the authored fallback
 * comes before the interpolation values, so the common "id plus authored text"
 * call needs no placeholder.
 *
 * @example
 * title.setText(msg("hud.title", "Play"));
 * scoreText.setText(msg("hud.score", "Score: {n}", { n: 0 }));
 */
export function msg(
  id: string,
  defaultText?: string,
  values?: Record<string, JsonValue>,
): LocalizedBinding {
  const binding: LocalizedBinding = { id };
  if (defaultText !== undefined) binding.default = defaultText;
  if (values !== undefined) binding.values = values;
  return binding;
}
