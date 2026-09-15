import { describe, expect, it, vi } from "vitest";
import { createLocalization } from "./i18next.js";
import { msg } from "./message.js";

const catalogs = {
  en: {
    hello: "Hello {name}",
    empty: "",
    apples_one: "{count} apple",
    apples_other: "{count} apples",
    reserved: "{lng} {ns} {defaultValue} {context}",
    reserved_formal: "wrong contextual variant",
    nested: { title: "Nested title" },
  },
  it: {
    hello: "Ciao {name}",
    apples_one: "{count} mela",
    apples_other: "{count} mele",
  },
};

describe("createLocalization (i18next)", () => {
  it("resolves catalog entries, fallback locale, fallback text, plurals, and plain strings", async () => {
    const l10n = await createLocalization({
      locale: "it",
      fallbackLocale: "en",
      catalogs,
    });
    expect(l10n.locale).toBe("it");
    expect(l10n.resolve(msg("hello", "Hi {name}"), { name: "Mina" })).toBe(
      "Ciao Mina",
    );
    expect(l10n.resolve(msg("hello", "Hi {name}", { name: "Ari" }))).toBe(
      "Ciao Ari",
    );
    expect(l10n.resolve(msg("empty", "Fallback"))).toBe("");
    expect(l10n.resolve(msg("nested.title", "x"))).toBe("Nested title");
    expect(
      l10n.resolve(msg("missing", "Fallback {name}"), { name: "Mina" }),
    ).toBe("Fallback Mina");
    expect(l10n.resolve(msg("apples", "{count} apples", { count: 1 }))).toBe(
      "1 mela",
    );
    expect(l10n.resolve(msg("apples", "{count} apples"), { count: 2 })).toBe(
      "2 mele",
    );
    expect(l10n.resolve("plain {name}", { name: "Mina" })).toBe("plain Mina");
  });

  it("switches locale, notifies once per change, and rejects unsupported locales before changing", async () => {
    const l10n = await createLocalization({
      locale: "en",
      fallbackLocale: "en",
      catalogs,
    });
    const listener = vi.fn();
    const unsubscribe = l10n.subscribe(listener);
    l10n.setLocale("it");
    l10n.setLocale("it");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(l10n.resolve(msg("hello", "Hi"), { name: "Mina" })).toBe(
      "Ciao Mina",
    );
    expect(() => l10n.setLocale("fr")).toThrow('unsupported locale "fr"');
    expect(l10n.locale).toBe("it");
    unsubscribe();
    l10n.setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("accepts a regional tag whose parent has a catalog", async () => {
    const l10n = await createLocalization({
      locale: "it-IT",
      fallbackLocale: "en",
      catalogs,
    });
    expect(l10n.resolve(msg("hello", "Hi"), { name: "Mina" })).toBe(
      "Ciao Mina",
    );
    l10n.setLocale("en-GB");
    expect(l10n.locale).toBe("en-GB");
    expect(l10n.resolve(msg("hello", "Hi"), { name: "Mina" })).toBe(
      "Hello Mina",
    );
  });

  it("skips a listener removed earlier in the same notification", async () => {
    const l10n = await createLocalization({
      locale: "en",
      fallbackLocale: "en",
      catalogs,
    });
    const removed = vi.fn();
    let unsubscribe = (): void => undefined;
    l10n.subscribe(() => unsubscribe());
    unsubscribe = l10n.subscribe(removed);
    l10n.setLocale("it");
    expect(removed).not.toHaveBeenCalled();
  });

  it("keeps values named like backend options as plain data", async () => {
    const l10n = await createLocalization({
      locale: "en",
      fallbackLocale: "en",
      catalogs,
    });
    expect(
      l10n.resolve(msg("reserved", "fallback"), {
        lng: "it",
        ns: "game",
        defaultValue: "Default",
        context: "formal",
      }),
    ).toBe("it game Default formal");
  });

  it("validates catalogs at creation", async () => {
    await expect(
      createLocalization({ locale: "en", fallbackLocale: "en", catalogs: {} }),
    ).rejects.toThrow("at least one");
    await expect(
      createLocalization({ locale: "fr", fallbackLocale: "en", catalogs }),
    ).rejects.toThrow('locale "fr"');
    await expect(
      createLocalization({ locale: "en", fallbackLocale: "fr", catalogs }),
    ).rejects.toThrow('fallbackLocale "fr"');
  });
});
