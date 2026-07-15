import type { JsonValue, Localization } from "@yagejs/core";
import type { I18nAdapter } from "./i18n.js";

/**
 * Bridge the engine's {@link Localization} service to the dialogue
 * {@link I18nAdapter} seam. A line's `#line:id` key drives the catalog lookup;
 * the authored text is the fallback; dialogue vars interpolate. Wire it by
 * passing `i18n: true` to the {@link DialogueController} (which resolves the
 * registered plugin), or construct it directly for a custom presenter.
 *
 * Resolution is at present time — new lines resolve in the current locale. A
 * live locale switch does not retro-update a line already on screen (that needs
 * a text-channel retranslate seam, deferred).
 */
export function engineI18nAdapter(localization: Localization): I18nAdapter {
  return {
    get locale(): string {
      return localization.locale;
    },
    t(
      key: string | undefined,
      fallback: string,
      params?: Readonly<Record<string, unknown>>,
    ): string {
      // No key → use the authored text as the id; the catalog misses and the
      // adapter renders the interpolated fallback (matching IdentityI18n).
      const id = key ?? fallback;
      // Dialogue vars are JSON-safe (string/number/boolean/null), so the values
      // are effectively JsonValue; the cast documents that assumption.
      return localization.resolve(
        params !== undefined
          ? { id, default: fallback, values: { ...params } as Record<string, JsonValue> }
          : { id, default: fallback },
      );
    },
  };
}
