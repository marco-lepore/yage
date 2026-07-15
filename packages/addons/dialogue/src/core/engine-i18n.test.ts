import { describe, expect, it } from "vitest";
import type { Localization, LocalizedBinding } from "@yagejs/core";
import { engineI18nAdapter } from "./engine-i18n.js";

function fakeLocalization(
  resolve: (binding: LocalizedBinding) => string,
  locale = "en",
): Localization {
  return {
    locale,
    revision: () => 0,
    subscribe: () => () => {},
    resolve,
    setLocale: async () => {},
  };
}

describe("engineI18nAdapter", () => {
  it("reads the current locale from the service", () => {
    const adapter = engineI18nAdapter(
      fakeLocalization((b) => b.default ?? b.id, "it"),
    );
    expect(adapter.locale).toBe("it");
  });

  it("resolves a keyed line through the catalog", () => {
    const seen: LocalizedBinding[] = [];
    const adapter = engineI18nAdapter(
      fakeLocalization((b) => {
        seen.push(b);
        return b.id === "greet" ? "Ciao" : (b.default ?? b.id);
      }),
    );
    expect(adapter.t("greet", "Hello")).toBe("Ciao");
    expect(seen[0]).toEqual({ id: "greet", default: "Hello" });
  });

  it("uses the authored text as id + fallback when there is no key", () => {
    const seen: LocalizedBinding[] = [];
    const adapter = engineI18nAdapter(
      fakeLocalization((b) => {
        seen.push(b);
        return b.default ?? b.id;
      }),
    );
    expect(adapter.t(undefined, "Plain text")).toBe("Plain text");
    expect(seen[0]).toEqual({ id: "Plain text", default: "Plain text" });
  });

  it("passes interpolation params as binding values", () => {
    let received: LocalizedBinding | undefined;
    const adapter = engineI18nAdapter(
      fakeLocalization((b) => {
        received = b;
        return b.default ?? b.id;
      }),
    );
    adapter.t("score", "Score: {n}", { n: 5 });
    expect(received?.values).toEqual({ n: 5 });
  });
});
