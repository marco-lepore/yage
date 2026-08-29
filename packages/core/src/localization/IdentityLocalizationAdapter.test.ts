import { describe, it, expect } from "vitest";
import {
  IdentityLocalizationAdapter,
  identityLocalizationAdapter,
  interpolate,
} from "./IdentityLocalizationAdapter.js";

describe("interpolate", () => {
  it("replaces {token} from own properties", () => {
    expect(interpolate("{n} coins", { n: 3 })).toBe("3 coins");
  });

  it("leaves unknown tokens untouched", () => {
    expect(interpolate("{a} {b}", { a: 1 })).toBe("1 {b}");
  });

  it("ignores inherited Object.prototype members", () => {
    // `{constructor}` must not stringify Object.prototype.constructor.
    expect(interpolate("{constructor}", {})).toBe("{constructor}");
  });

  it("stringifies non-string values", () => {
    expect(interpolate("{a}-{b}", { a: true, b: null })).toBe("true-null");
  });

  it("leaves the token intact when String() would throw, never throwing", () => {
    // `{ toString: null }` is a valid JsonValue object but has no primitive
    // conversion — String() throws. The identity adapter must not.
    expect(interpolate("{a}", { a: { toString: null } })).toBe("{a}");
  });
});

describe("IdentityLocalizationAdapter", () => {
  it("defaults to the 'en' locale", () => {
    expect(new IdentityLocalizationAdapter().locale).toBe("en");
    expect(new IdentityLocalizationAdapter("fr-CA").locale).toBe("fr-CA");
  });

  it("renders the fallback, interpolating tokens", () => {
    const a = new IdentityLocalizationAdapter();
    expect(a.t("hud.score", "Score: {n}", { n: 5 })).toBe("Score: 5");
  });

  it("renders the fallback verbatim when no values are given", () => {
    const a = new IdentityLocalizationAdapter();
    expect(a.t("greeting", "Hello")).toBe("Hello");
  });

  it("renders the id when the fallback is missing", () => {
    const a = new IdentityLocalizationAdapter();
    expect(a.t("hud.score", undefined)).toBe("hud.score");
    expect(a.t("hud.score", undefined, { n: 5 })).toBe("hud.score");
  });

  it("subscribe is a no-op returning an unsubscribe", () => {
    const unsubscribe = identityLocalizationAdapter.subscribe();
    expect(typeof unsubscribe).toBe("function");
    // Idempotent no-op — calling it does nothing and does not throw.
    expect(() => unsubscribe()).not.toThrow();
  });
});
