import i18next, { type i18n, type TFunction } from "i18next";
import type { Localization } from "./Localization.js";
import { formatText, type Message, type MessageValues } from "./message.js";

/** One locale's strings. Nested objects are allowed; keys join with `.`. */
export type Catalog = Readonly<Record<string, unknown>>;

export interface LocalizationOptions {
  /** Locale active at start. Must have a catalog, or share one with its parent tag (`pt-BR` → `pt`). */
  readonly locale: string;
  /** Locale looked up when the active one lacks a key. Must have a catalog. */
  readonly fallbackLocale: string;
  /** Catalogs keyed by locale tag. */
  readonly catalogs: Readonly<Record<string, Catalog>>;
}

function hasCatalog(
  catalogs: Readonly<Record<string, Catalog>>,
  locale: string,
): boolean {
  // One trailing subtag at a time, the way i18next resolves: "zh-Hant-HK"
  // finds a "zh-Hant" catalog, then a "zh" one.
  let tag = locale;
  for (;;) {
    if (Object.hasOwn(catalogs, tag)) return true;
    const separator = tag.lastIndexOf("-");
    if (separator <= 0) return false;
    tag = tag.slice(0, separator);
  }
}

class I18nextLocalization implements Localization {
  private readonly listeners = new Set<() => void>();
  private translator: TFunction;
  private _locale: string;

  constructor(
    private readonly backend: i18n,
    private readonly catalogs: Readonly<Record<string, Catalog>>,
    locale: string,
  ) {
    this._locale = locale;
    this.translator = backend.getFixedT(locale);
  }

  get locale(): string {
    return this._locale;
  }

  resolve(text: Message | string, values?: MessageValues): string {
    if (typeof text === "string") return formatText(text, values);
    const merged = { ...text.values, ...values };
    // i18next picks the catalog entry and plural form; interpolation runs in
    // formatText so `{name}` tokens behave the same for every backend and a
    // value named like an i18next option (`lng`, `ns`) stays plain data.
    const translated = this.translator(text.key, {
      lng: this._locale,
      ns: "translation",
      defaultValue: text.fallback,
      ...(typeof merged.count === "number" ? { count: merged.count } : {}),
      skipInterpolation: true,
    });
    if (typeof translated !== "string") {
      throw new Error(
        `Localization: key "${text.key}" resolved to a ${typeof translated}, not a string.`,
      );
    }
    return formatText(translated, merged);
  }

  setLocale(locale: string): void {
    if (locale === this._locale) return;
    if (!hasCatalog(this.catalogs, locale)) {
      throw new Error(
        `Localization.setLocale: unsupported locale "${locale}".`,
      );
    }
    this.translator = this.backend.getFixedT(locale);
    this._locale = locale;
    for (const listener of [...this.listeners]) {
      if (this.listeners.has(listener)) listener();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * Create the bundled i18next-backed {@link Localization}. Catalogs are
 * preloaded; nothing is fetched at runtime. Plural forms use i18next's
 * `key_one` / `key_other` suffixes driven by a numeric `count` value.
 */
export async function createLocalization(
  options: LocalizationOptions,
): Promise<Localization> {
  const { catalogs, locale, fallbackLocale } = options;
  if (Object.keys(catalogs).length === 0) {
    throw new Error(
      "createLocalization: catalogs must contain at least one locale.",
    );
  }
  if (!hasCatalog(catalogs, locale)) {
    throw new Error(`createLocalization: no catalog for locale "${locale}".`);
  }
  if (!Object.hasOwn(catalogs, fallbackLocale)) {
    throw new Error(
      `createLocalization: no catalog for fallbackLocale "${fallbackLocale}".`,
    );
  }
  const backend = i18next.createInstance();
  await backend.init({
    lng: locale,
    fallbackLng: fallbackLocale,
    // One namespace holds every catalog, so a key containing ':' (a Yarn
    // Spinner line id such as "line:abc123") is a key, not a namespace prefix.
    nsSeparator: false,
    resources: Object.fromEntries(
      Object.entries(catalogs).map(([tag, catalog]) => [
        tag,
        { translation: catalog },
      ]),
    ),
    initImmediate: false,
  });
  return new I18nextLocalization(backend, catalogs, locale);
}
